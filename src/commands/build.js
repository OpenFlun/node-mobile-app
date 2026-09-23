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
import {
  patchAppConfig, patchAndroidConfig, patchSigning, patchIcon, patchIosConfig, patchIosIcon, resolveAppName
} from '../patcher.js';
import { ensureMac, checkIosTools, podInstall, xcodebuildArchive, xcodebuildExport } from '../platform-ios.js';
import { run, ensureDir, sanitizeFileName } from '../utils.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  runBuild = async (flags) => {
    const userProjectDir = process.cwd(), release = !!flags.release, isIos = !!flags.ios;
    console.log(`\n=== node-mobile-app build (${isIos ? 'iOS' : 'Android'}, ${release ? 'release' : 'debug'}) ===\n`);
    console.log('用户项目:', userProjectDir);

    if (isIos) ensureMac(), checkIosTools();
    console.log('\n[0/7] 检查用户配置与入口文件'), ensureUserConfig(userProjectDir, PKG_ROOT);

    const config = await loadConfig(userProjectDir);
    ensureUserEntry(userProjectDir, config, PKG_ROOT), validateConfig(config, userProjectDir);

    const buildDir = getBuildDir(userProjectDir);
    console.log('\n[1/7] 重置 RN 工程模板');
    copyTemplate(PKG_ROOT, buildDir, config);
    patchAndroidAbi(buildDir, config);
    patchExtraRnDependencies(buildDir, userProjectDir, config);
    patchAppConfig(buildDir, userProjectDir, config);
    patchAndroidConfig(buildDir, config);
    patchSigning(buildDir, userProjectDir, config);
    await patchIcon(buildDir, userProjectDir, config);
    patchIosConfig(buildDir, userProjectDir, config);
    await patchIosIcon(buildDir, userProjectDir, config);

    console.log('\n[2/7] 检查缓存指纹'), checkAndResetCache(buildDir, userProjectDir, config, PKG_ROOT);
    console.log('\n[3/7] 复制用户项目');
    const { moduleType, targetDir } = copyUserProject(userProjectDir, buildDir, config);
    console.log('\n[4/7] 安装依赖'), installUserDeps(targetDir, userProjectDir, config);
    patchNodejsMobilePlugin(userProjectDir, config);
    patchWebViewSsl(userProjectDir, config);
    writeLocalProperties(buildDir, config);

    console.log('\n[5/7] 生成桥接文件');
    generateMainJs(targetDir, config, moduleType), generateRuntime(buildDir, config);

    const appName = resolveAppName(userProjectDir, config), safeName = sanitizeFileName(appName),
      outDir = path.resolve(userProjectDir, config.outputDir || './out');
    ensureDir(outDir);

    if (isIos) {
      console.log('\n[6/7] pod install'), podInstall(path.join(buildDir, 'ios'));
      console.log('\n[7/7] xcodebuild archive + export'), xcodebuildArchive(buildDir, config, release, userProjectDir);

      const ipaPath = xcodebuildExport(buildDir, config, release, outDir, userProjectDir),
        dstName = `${safeName}-${config.versionName}-${release ? 'release' : 'debug'}.ipa`, dst = path.join(outDir, dstName);
      fs.copyFileSync(ipaPath, dst), console.log('\n✅ 打包完成');

      const mb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
      console.log(`  ${dst}  (${mb} MB)`);
      return;
    }

    console.log('\n[6/7] 打包 APK');
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
    ], { cwd: buildDir });

    const task = release ? 'assembleRelease' : 'assembleDebug', gradleArgs = [task];
    if (flags.arch) gradleArgs.push(`-PreactNativeArchitectures=${flags.arch}`);

    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    run(gradlew, gradleArgs, { cwd: path.join(buildDir, 'android') });

    const apkDir = path.join(buildDir, 'android', 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
    console.log('\n✅ 打包完成');

    if (fs.existsSync(apkDir)) {
      const apks = fs.readdirSync(apkDir).filter((f) => f.endsWith('.apk'));
      if (apks.length === 0) console.log('  ⚠️  未找到 APK');

      for (const f of apks) {
        const src = path.join(apkDir, f), dstName = `${safeName}-${config.versionName}-${release ? 'release' : 'debug'}.apk`,
          dst = path.join(outDir, dstName);

        fs.copyFileSync(src, dst);
        const mb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
        console.log(`  ${dst}  (${mb} MB)`);
      }
    }
    else console.log('  ⚠️  未找到 APK 输出目录:', apkDir);
  }

export { runBuild };
