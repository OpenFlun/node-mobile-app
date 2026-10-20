import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadConfig, validateConfig } from '../config.js';
import { createHash } from 'crypto';
import http from 'http';
import {
  getBuildDir, copyTemplate, copyUserProject, writeLocalProperties, ensureUserEntry, ensureUserConfig, patchAndroidAbi,
  patchExtraRnDependencies
} from '../copy.js';
import { installUserDeps, patchNodejsMobilePlugin, patchWebViewSsl } from '../install.js';
import { markVerified } from '../optimize-node-modules.js';
import { generateMainJs, generateRuntime } from '../generate.js';
import { checkAndResetCache } from '../fingerprint.js';
import { patchAppConfig, patchAndroidConfig, patchSigning, patchIcon, patchIosConfig, patchIosIcon } from '../patcher.js';
import { ensureMac, checkIosTools, podInstall } from '../platform-ios.js';
import { run, runSilent, runStream, findAdb, ensureDir, findHermesc, ensureInstallable, writeInstallState, spawnCmdAsync } from '../utils.js';
import chalk from 'chalk';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  runTest = async flags => {
    const userProjectDir = process.cwd(), isIos = !!flags.ios, total = isIos ? 9 : 11;

    console.log(chalk.cyan(`\n=== node-mobile-app test (${isIos ? 'iOS' : 'Android'}) ===\n`));
    console.log(chalk.gray('用户项目: ' + userProjectDir));
    if (isIos) ensureMac(), checkIosTools();
    console.log(chalk.cyan(`\n[1/${total}] 检查用户配置与入口文件`)), ensureUserConfig(userProjectDir, PKG_ROOT);

    const config = await loadConfig(userProjectDir);
    ensureUserEntry(userProjectDir, config, PKG_ROOT), validateConfig(config, userProjectDir);

    const buildDir = getBuildDir(userProjectDir);
    console.log(chalk.cyan(`\n[2/${total}] 重置 RN 工程模板`));
    copyTemplate(PKG_ROOT, buildDir, config), patchAndroidAbi(buildDir, config);
    patchExtraRnDependencies(buildDir, userProjectDir, config);
    patchAppConfig(buildDir, userProjectDir, config);
    patchAndroidConfig(buildDir, config), patchSigning(buildDir, userProjectDir, config);
    await patchIcon(buildDir, userProjectDir, config);
    patchIosConfig(buildDir, userProjectDir, config);
    await patchIosIcon(buildDir, userProjectDir, config);

    console.log(chalk.cyan(`\n[3/${total}] 检查缓存指纹`)), checkAndResetCache(buildDir, userProjectDir, config, PKG_ROOT);
    console.log(chalk.cyan(`\n[4/${total}] 复制用户项目`));
    const { moduleType, targetDir } = copyUserProject(userProjectDir, buildDir, config);

    console.log(chalk.cyan(`\n[5/${total}] 安装依赖与编译优化`)), await installUserDeps(targetDir, userProjectDir, config, buildDir, isIos ? 'ios' : 'android');
    patchNodejsMobilePlugin(userProjectDir, config);
    patchWebViewSsl(userProjectDir, config), writeLocalProperties(buildDir, config);

    console.log(chalk.cyan(`\n[6/${total}] 生成桥接文件`));
    generateMainJs(targetDir, config, moduleType), generateRuntime(buildDir, config);

    if (isIos) {
      console.log(chalk.cyan(`\n[7/${total}] pod install`)), podInstall(path.join(buildDir, 'ios'));
      console.log(chalk.cyan(`\n[8/${total}] 生成 JS bundle + Hermes 字节码（由 Xcode Run Script 自动）`));
      const bundlePath = path.join(buildDir, 'ios', 'main.jsbundle');
      runSilent('npx', [
        'react-native', 'bundle',
        '--platform', 'ios',
        '--dev', 'false',
        '--entry-file', 'index.js',
        '--bundle-output', bundlePath,
      ], { cwd: buildDir });
      console.log(chalk.green('    ✓ bundle 已生成'));

      console.log(chalk.cyan(`\n[9/${total}] 编译并安装到模拟器/设备`));
      const args = ['react-native', 'run-ios'];
      if (flags.device) args.push('--device', flags.device);
      // FORCE_BUNDLING=1：即使 Debug+模拟器也把 main.jsbundle 打进 App
      const env = { ...process.env, FORCE_BUNDLING: '1', NODE_MOBILE_MODE: 'test' };
      run('npx', args, { cwd: buildDir, env, inherit: true });
      await markVerified(buildDir);
    } else {
      console.log(chalk.cyan(`\n[7/${total}] 生成 JS bundle（离线可用）`));
      const assetsDir = path.join(buildDir, 'android', 'app', 'src', 'main', 'assets'),
        resDir = path.join(buildDir, 'android', 'app', 'src', 'main', 'res');
      ensureDir(assetsDir);

      const bundlePath = path.join(assetsDir, 'index.android.bundle');
      runSilent('npx', [
        'react-native', 'bundle',
        '--platform', 'android',
        '--dev', 'false',
        '--entry-file', 'index.js',
        '--bundle-output', bundlePath,
        '--assets-dest', resDir,
      ], { cwd: buildDir });
      console.log(chalk.green('    ✓ bundle 已生成'));

      console.log(chalk.cyan(`\n[8/${total}] 编译 Hermes 字节码（加速离线启动）`));
      const hermesc = findHermesc(userProjectDir);
      if (hermesc) {
        const hbcPath = bundlePath + '.hbc';
        runSilent(hermesc, ['-emit-binary', '-out', hbcPath, bundlePath]);
        fs.copyFileSync(hbcPath, bundlePath), fs.unlinkSync(hbcPath);
        console.log(chalk.green('    ✓ 已替换为 Hermes 字节码'));
      }
      else console.warn(chalk.yellow('  ⚠️  未找到 hermesc，跳过字节码编译（离线启动会较慢）'));

      const mergedAsset = path.join(buildDir, 'android', 'app', 'build', 'intermediates', 'assets', 'debug', 'mergeDebugAssets', 'index.android.bundle');
      if (fs.existsSync(mergedAsset)) {
        const h = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        if (h(bundlePath) !== h(mergedAsset)) {
          fs.rmSync(path.dirname(mergedAsset), { recursive: true, force: true });
          console.log(chalk.gray('  bundle 已变化，清理 mergeDebugAssets 缓存'));
        }
      }
      console.log(chalk.cyan(`\n[9/${total}] 配置 adb 端口转发`));
      const adb = findAdb(config);
      console.log(chalk.gray('  adb: ' + adb)), run(adb, ['reverse', 'tcp:8081', 'tcp:8081'], { quiet: true });

      const metroReady = () => new Promise(resolve => {
        const req = http.get('http://localhost:8081/status', r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve(d.includes('packager-status:running')));
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      });
      if (!await metroReady()) {
        console.log(chalk.gray('  启动 Metro...'));
        const metroLog = fs.openSync(path.join(buildDir, '.metro.log'), 'a');
        const metro = spawnCmdAsync('npx', ['react-native', 'start'], {
          cwd: buildDir, detached: true, stdio: ['ignore', metroLog, metroLog]
        });
        metro.unref();
        let ready = false;
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 500));
          if (await metroReady()) { ready = true; console.log(chalk.green('    ✓ Metro 已就绪（后台常驻，支持热更新）')); break; }
        }
        if (!ready) console.log(chalk.yellow('  ⚠️  Metro 30 秒内未就绪，详见 .metro.log；app 将回落到本地 bundle'));
      }
      console.log(chalk.cyan(`\n[10/${total}] 编译 Debug 包`));
      const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
      if (process.env.OPTIMIZE_DEBUG) {
        await runStream(gradlew, ['assembleDebug'], { cwd: path.join(buildDir, 'android'), env: { ...process.env, NODE_MOBILE_MODE: 'test' } });
      } else {
        console.log(chalk.gray('  编译中...'));
        run(gradlew, ['assembleDebug'], { cwd: path.join(buildDir, 'android'), env: { ...process.env, NODE_MOBILE_MODE: 'test' }, quiet: true });
        console.log(chalk.green('    ✓ 编译完成'));
      }

      console.log(chalk.cyan(`\n[11/${total}] 安装到设备`));
      ensureInstallable(adb, config.appId, 'debug', buildDir, flags.device);
      const apkDir = path.join(buildDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
      if (!fs.existsSync(apkDir)) console.error(chalk.red('  [错误] 未找到 APK 输出目录: ' + apkDir)), process.exit(1);
      const apkPath = path.join(apkDir, 'app-debug.apk');
      if (!fs.existsSync(apkPath)) console.error(chalk.red('  [错误] 未找到 app-debug.apk: ' + apkPath)), process.exit(1);
      const devPrefix = flags.device ? ['-s', flags.device] : [];
      run(adb, [...devPrefix, 'install', '-r', apkPath], { quiet: true });
      console.log(chalk.green('    ✓ 已安装到设备'));
      run(adb, [...devPrefix, 'shell', 'monkey', '-p', config.appId, '-c', 'android.intent.category.LAUNCHER', '1'], { quiet: true });
      writeInstallState(buildDir, { appId: config.appId, variant: 'debug', installedAt: new Date().toISOString() });
      await markVerified(buildDir);
    }
  };

export { runTest };
