import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadConfig, validateConfig } from '../config.js';
import {
  getBuildDir, copyTemplate, copyUserProject, writeLocalProperties, ensureUserEntry, ensureUserConfig, patchAndroidAbi,
  patchExtraRnDependencies
} from '../copy.js';
import { installUserDeps, patchNodejsMobilePlugin, patchWebViewSsl } from '../install.js';
import { generateMainJs, generateRuntime } from '../generate.js';
import { checkAndResetCache } from '../fingerprint.js';
import { patchAppConfig, patchAndroidConfig, patchSigning, patchIcon, patchIosConfig, patchIosIcon } from '../patcher.js';
import { ensureMac, checkIosTools, podInstall } from '../platform-ios.js';
import { run, runSilent, findAdb, ensureDir, findHermesc } from '../utils.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  runTest = async flags => {
    const userProjectDir = process.cwd(), isIos = !!flags.ios;
    console.log(`\n=== node-mobile-app test (${isIos ? 'iOS' : 'Android'}) ===\n`), console.log('用户项目:', userProjectDir);

    if (isIos) ensureMac(), checkIosTools();
    console.log('\n[0/9] 检查用户配置与入口文件'), ensureUserConfig(userProjectDir, PKG_ROOT);

    const config = await loadConfig(userProjectDir);
    ensureUserEntry(userProjectDir, config, PKG_ROOT), validateConfig(config, userProjectDir);

    const buildDir = getBuildDir(userProjectDir);
    console.log('\n[1/9] 重置 RN 工程模板');
    copyTemplate(PKG_ROOT, buildDir, config);
    patchAndroidAbi(buildDir, config);
    patchExtraRnDependencies(buildDir, userProjectDir, config);
    patchAppConfig(buildDir, userProjectDir, config);
    patchAndroidConfig(buildDir, config);
    patchSigning(buildDir, userProjectDir, config);
    await patchIcon(buildDir, userProjectDir, config);
    patchIosConfig(buildDir, userProjectDir, config);
    await patchIosIcon(buildDir, userProjectDir, config);

    console.log('\n[2/9] 检查缓存指纹'), checkAndResetCache(buildDir, userProjectDir, config, PKG_ROOT);
    console.log('\n[3/9] 复制用户项目');
    const { moduleType, targetDir } = copyUserProject(userProjectDir, buildDir, config);

    console.log('\n[4/9] 安装依赖'), installUserDeps(targetDir, userProjectDir, config);
    patchNodejsMobilePlugin(userProjectDir, config);
    patchWebViewSsl(userProjectDir, config);
    writeLocalProperties(buildDir, config);

    console.log('\n[5/9] 生成桥接文件');
    generateMainJs(targetDir, config, moduleType), generateRuntime(buildDir, config);

    if (isIos) {
      console.log('\n[6/9] pod install'), podInstall(path.join(buildDir, 'ios'));
      console.log('\n[7/9] 生成 JS bundle + Hermes 字节码（由 Xcode Run Script 自动）');
      const bundlePath = path.join(buildDir, 'ios', 'main.jsbundle');
      runSilent('npx', [
        'react-native', 'bundle',
        '--platform', 'ios',
        '--dev', 'false',
        '--entry-file', 'index.js',
        '--bundle-output', bundlePath,
      ], { cwd: buildDir });
      console.log('  ✓ bundle 已生成');

      console.log('\n[8/9] 编译并安装到模拟器/设备');
      const args = ['react-native', 'run-ios'];
      if (flags.device) args.push('--device', flags.device);
      // FORCE_BUNDLING=1：即使 Debug+模拟器也把 main.jsbundle 打进 App
      const env = { ...process.env, FORCE_BUNDLING: '1' };
      run('npx', args, { cwd: buildDir, env });
    } else {
      console.log('\n[6/9] 生成 JS bundle（离线可用）');
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
      console.log('  ✓ bundle 已生成');

      console.log('\n[7/9] 编译 Hermes 字节码（加速离线启动）');
      const hermesc = findHermesc(userProjectDir);
      if (hermesc) {
        const hbcPath = bundlePath + '.hbc';
        runSilent(hermesc, ['-emit-binary', '-out', hbcPath, bundlePath]);
        fs.copyFileSync(hbcPath, bundlePath), fs.unlinkSync(hbcPath);
        console.log('  ✓ 已替换为 Hermes 字节码');
      }
      else console.warn('  ⚠️  未找到 hermesc，跳过字节码编译（离线启动会较慢）');

      console.log('\n[8/9] 配置 adb 端口转发');
      const adb = findAdb(config);
      console.log('  adb:', adb), run(adb, ['reverse', 'tcp:8081', 'tcp:8081']);

      console.log('\n[9/9] 编译并安装到设备');
      const args = ['react-native', 'run-android'];
      if (flags.device) args.push('--deviceId', flags.device);
      run('npx', args, { cwd: buildDir });
    }
  };

export { runTest };