import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { loadConfig, validateConfig } from '../config.js';
import {
  getBuildDir, copyTemplate, copyUserProject, writeLocalProperties, ensureUserEntry, ensureUserConfig, patchAndroidAbi,
  patchExtraRnDependencies
} from '../copy.js';
import { installUserDeps, patchNodejsMobilePlugin, patchWebViewSsl } from '../install.js';
import { markVerified } from '../optimize-node-modules.js';
import { generateMainJs, generateRuntime } from '../generate.js';
import { checkAndResetCache } from '../fingerprint.js';
import {
  patchAppConfig, patchAndroidConfig, patchSigning, patchIcon, patchIosConfig, patchIosIcon, resolveAppName
} from '../patcher.js';
import { ensureMac, checkIosTools, podInstall, xcodebuildArchive, xcodebuildExport } from '../platform-ios.js';
import { run, ensureDir, sanitizeFileName } from '../utils.js';
import chalk from 'chalk';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  runBuild = async (flags) => {
    const userProjectDir = process.cwd(), release = !!flags.release, isIos = !!flags.ios, total = isIos ? 8 : 7;

    console.log(chalk.cyan(`\n=== node-mobile-app build (${isIos ? 'iOS' : 'Android'}, ${release ? 'release' : 'debug'}) ===\n`));
    console.log(chalk.gray('用户项目: ' + userProjectDir));
    if (isIos) ensureMac(), checkIosTools();
    console.log(chalk.cyan(`\n[1/${total}] 检查用户配置与入口文件`)), ensureUserConfig(userProjectDir, PKG_ROOT);

    const config = await loadConfig(userProjectDir);
    ensureUserEntry(userProjectDir, config, PKG_ROOT), validateConfig(config, userProjectDir);

    const buildDir = getBuildDir(userProjectDir);
    console.log(chalk.cyan(`\n[2/${total}] 重置 RN 工程模板`));
    copyTemplate(PKG_ROOT, buildDir, config);
    patchAndroidAbi(buildDir, config);
    patchExtraRnDependencies(buildDir, userProjectDir, config);
    patchAppConfig(buildDir, userProjectDir, config);
    patchAndroidConfig(buildDir, config);
    patchSigning(buildDir, userProjectDir, config);
    await patchIcon(buildDir, userProjectDir, config);
    patchIosConfig(buildDir, userProjectDir, config);
    await patchIosIcon(buildDir, userProjectDir, config);

    console.log(chalk.cyan(`\n[3/${total}] 检查缓存指纹`)), checkAndResetCache(buildDir, userProjectDir, config, PKG_ROOT);
    console.log(chalk.cyan(`\n[4/${total}] 复制用户项目`));
    const { moduleType, targetDir } = copyUserProject(userProjectDir, buildDir, config);
    console.log(chalk.cyan(`\n[5/${total}] 安装依赖与编译优化`));
    await installUserDeps(targetDir, userProjectDir, config, buildDir, isIos ? 'ios' : 'android');
    patchNodejsMobilePlugin(userProjectDir, config);
    patchWebViewSsl(userProjectDir, config);
    writeLocalProperties(buildDir, config);

    console.log(chalk.cyan(`\n[6/${total}] 生成桥接文件`));
    generateMainJs(targetDir, config, moduleType), generateRuntime(buildDir, config);

    const appName = resolveAppName(userProjectDir, config), safeName = sanitizeFileName(appName),
      outDir = path.resolve(userProjectDir, config.outputDir || './out');
    ensureDir(outDir);

    if (isIos) {
      console.log(chalk.cyan(`\n[7/${total}] pod install`)), podInstall(path.join(buildDir, 'ios'));
      console.log(chalk.cyan(`\n[8/${total}] xcodebuild archive + export`)), xcodebuildArchive(buildDir, config, release, userProjectDir);

      const ipaPath = xcodebuildExport(buildDir, config, release, outDir, userProjectDir),
        dstName = `${safeName}-${config.versionName}-${release ? 'release' : 'debug'}.ipa`, dst = path.join(outDir, dstName);
      fs.copyFileSync(ipaPath, dst), console.log(chalk.green('\n✅ 打包完成'));

      const mb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
      console.log(chalk.gray(`  ${dst}  (${mb} MB)`));
      await markVerified(buildDir);
      return;
    }

    console.log(chalk.cyan(`\n[7/${total}] 打包 APK`));
    if (!process.env.OPTIMIZE_DEBUG) console.log(chalk.gray('  打包进行中...'));
    const assetsDir = path.join(buildDir, 'android', 'app', 'src', 'main', 'assets'),
      resDir = path.join(buildDir, 'android', 'app', 'src', 'main', 'res');

    ensureDir(assetsDir);
    run('npx', [
      'react-native', 'bundle',
      '--platform', 'android',
      '--dev', release ? 'false' : 'true',
      '--entry-file', 'index.js',
      '--bundle-output', path.join(assetsDir, 'index.android.bundle'),
      '--assets-dest', resDir,
    ], { cwd: buildDir, quiet: true });

    const task = release ? 'assembleRelease' : 'assembleDebug', gradleArgs = [task];
    if (flags.arch) gradleArgs.push(`-PreactNativeArchitectures=${flags.arch}`);

    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    run(gradlew, gradleArgs, { cwd: path.join(buildDir, 'android'), quiet: true });

    const apkDir = path.join(buildDir, 'android', 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
    console.log(chalk.green('\n✅ 打包完成'));

    if (fs.existsSync(apkDir)) {
      const apks = fs.readdirSync(apkDir).filter((f) => f.endsWith('.apk'));
      if (apks.length === 0) console.log(chalk.yellow('  ⚠️  未找到 APK'));

      for (const f of apks) {
        const src = path.join(apkDir, f), dstName = `${safeName}-${config.versionName}-${release ? 'release' : 'debug'}.apk`,
          dst = path.join(outDir, dstName);

        fs.copyFileSync(src, dst);
        const mb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
        console.log(chalk.gray(`  ${dst}  (${mb} MB)`));
      }
    }
    else console.log(chalk.yellow('  ⚠️  未找到 APK 输出目录: ' + apkDir));
    await markVerified(buildDir);
  }

export { runBuild };
