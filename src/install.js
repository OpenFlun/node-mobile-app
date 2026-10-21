import path from 'path';
import fs from 'fs';
import { run } from './utils.js';
import { clearVerified, optimizeNodeModules, SELF_HASH } from './optimize-node-modules.js';
import { createRequire } from 'module';
import chalk from 'chalk';
import { resolveSdkPath } from './config.js';
import { createHash } from 'crypto';
const
  /**
   * 内部：从 libnode 的 node_version.h 读取运行时 Node 主版本号
   * 读不到直接报错退出（说明 libnode 目录不完整,继续执行必失败）
   */
  resolveRuntimeMajor = (userProjectDir, targetPlatform) => {
    const sub = targetPlatform === 'ios' ? 'ios' : 'android',
      header = path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native',
        sub, 'libnode', 'include', 'node', 'node_version.h');
    if (!fs.existsSync(header)) {
      console.error(chalk.red('  [错误] 未找到 node_version.h: ' + header));
      console.error(chalk.red('         说明 libnode 目录不完整,请重新安装依赖。')), process.exit(1);
    }
    const m = fs.readFileSync(header, 'utf-8').match(/#define\s+NODE_MAJOR_VERSION\s+(\d+)/);
    if (!m) console.error(chalk.red('  [错误] 无法解析 node_version.h 中的 NODE_MAJOR_VERSION')), process.exit(1);
    return m[1];
  },
  /**
   * 内部：判断用户项目的生产依赖里是否含原生模块（binding.gyp）
   * 按用户根 package.json 的 dependencies 键名,去 userProjectDir/node_modules 下逐个查
   * 不用扫 nodejs-project/node_modules：全新构建时它还不存在
   */
  hasNativeModules = userProjectDir => {
    const pkgPath = path.join(userProjectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    let deps = {};
    try {
      deps = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).dependencies || {};
    } catch { return false; }

    const nodeModulesDir = path.join(userProjectDir, 'node_modules');
    for (const name of Object.keys(deps))
      if (fs.existsSync(path.join(nodeModulesDir, name, 'binding.gyp'))) return true;
    return false;
  },
  /**
   * 内部：定位 @flun/nodejs-mobile-react-native 插件目录
   */
  findPluginDir = userProjectDir => {
    const candidates = [path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native')];
    for (const c of candidates) if (fs.existsSync(path.join(c, 'android', 'build.gradle'))) return c;
    return null;
  },
  ABI_MAP = {
    'armeabi-v7a': { arch: 'arm', prefix: 'armv7a-linux-androideabi' },
    'arm64-v8a': { arch: 'arm64', prefix: 'aarch64-linux-android' },
    'x86_64': { arch: 'x64', prefix: 'x86_64-linux-android' }
  },
  resolveNdkVersion = buildDir => {
    const gradle = path.join(buildDir, 'android', 'build.gradle');
    if (!fs.existsSync(gradle)) console.error(chalk.red('  [错误] 未找到 android/build.gradle: ' + gradle)), process.exit(1);
    const m = fs.readFileSync(gradle, 'utf-8').match(/ndkVersion\s*=\s*"([^"]+)"/);
    if (!m) console.error(chalk.red('  [错误] 无法从 android/build.gradle 解析 ndkVersion')), process.exit(1);
    return m[1];
  },
  resolveCompileSdk = buildDir => {
    const gradle = path.join(buildDir, 'android', 'build.gradle'),
      m = fs.readFileSync(gradle, 'utf-8').match(/minSdkVersion\s*=\s*(\d+)/);
    return Math.max(m ? +m[1] : 24, 24);
  },
  findNativePackages = targetDir => {
    const nm = path.join(targetDir, 'node_modules'), result = [];
    if (!fs.existsSync(nm)) return result;
    for (const entry of fs.readdirSync(nm)) {
      if (entry.startsWith('.')) continue;
      const full = path.join(nm, entry);
      if (!fs.statSync(full).isDirectory()) continue;
      if (entry.startsWith('@')) {
        for (const sub of fs.readdirSync(full)) {
          const pkgDir = path.join(full, sub);
          if (fs.statSync(pkgDir).isDirectory() && fs.existsSync(path.join(pkgDir, 'binding.gyp'))) result.push(entry + '/' + sub);
        }
      } else if (fs.existsSync(path.join(full, 'binding.gyp'))) result.push(entry);
    }
    return result;
  },
  compileNativeModules = (targetDir, userProjectDir, config, buildDir, abiFilters) => {
    const sdkPath = resolveSdkPath(config);
    if (!sdkPath) console.error(chalk.red('  [错误] 未找到 Android SDK,无法编译原生模块')), process.exit(1);
    const ndkVersion = resolveNdkVersion(buildDir), compileSdk = resolveCompileSdk(buildDir),
      ndkPath = path.join(sdkPath, 'ndk', ndkVersion);
    if (!fs.existsSync(ndkPath)) console.error(chalk.red('  [错误] 未找到 NDK ' + ndkVersion + ': ' + ndkPath)), process.exit(1);
    const pluginDir = findPluginDir(userProjectDir);
    if (!pluginDir) console.error(chalk.red('  [错误] 未找到 @flun/nodejs-mobile-react-native 插件')), process.exit(1);
    const libnodeDir = path.join(pluginDir, 'android', 'libnode'),
      gypPath = createRequire(path.join(pluginDir, 'package.json')).resolve('@flun/nodejs-mobile-gyp/bin/node-gyp.js'),
      hostTag = { win32: 'windows-x86_64', darwin: 'darwin-x86_64', linux: 'linux-x86_64' }[process.platform],
      hostOs = process.platform === 'darwin' ? 'mac' : 'linux',
      toolSuffix = process.platform === 'win32' ? '.cmd' : '',
      binSuffix = process.platform === 'win32' ? '.exe' : '';
    if (!hostTag) console.error(chalk.red('  [错误] 不支持的操作系统: ' + process.platform)), process.exit(1);
    const toolchain = path.join(ndkPath, 'toolchains', 'llvm', 'prebuilt', hostTag),
      assetsDir = path.dirname(targetDir), gradleProjectDir = path.join(buildDir, 'android');
    const patchScript = path.join(pluginDir, 'scripts', 'patch-package.js');
    if (fs.existsSync(patchScript)) run(process.execPath, [patchScript, path.join(targetDir, 'node_modules')],
      { cwd: targetDir, inherit: true });
    for (const abi of abiFilters) {
      const map = ABI_MAP[abi];
      if (!map) console.error(chalk.red('  [错误] 不支持的 ABI: ' + abi)), process.exit(1);
      const compilerPrefix = map.prefix + compileSdk,
        env = {
          ...process.env,
          npm_config_node_engine: 'v8', npm_config_nodedir: libnodeDir + path.sep,
          npm_config_node_gyp: gypPath, npm_config_arch: map.arch,
          npm_config_platform: 'android', npm_config_format: 'make-android',
          PROJECT_DIR: gradleProjectDir, NODEJS_MOBILE_GYP: gypPath,
          TOOLCHAIN: toolchain,
          AR: path.join(toolchain, 'bin', 'llvm-ar' + binSuffix),
          CC: path.join(toolchain, 'bin', compilerPrefix + '-clang' + toolSuffix),
          CXX: path.join(toolchain, 'bin', compilerPrefix + '-clang++' + toolSuffix),
          LINK: path.join(toolchain, 'bin', compilerPrefix + '-clang++' + toolSuffix),
          RANLIB: path.join(toolchain, 'bin', 'llvm-ranlib' + binSuffix),
          GYP_DEFINES: 'target_arch=' + map.arch + ' v8_target_arch=' + map.arch + ' android_target_arch=' + map.arch +
            ' host_os=' + hostOs + ' OS=android android_ndk_path=' + ndkPath.replace(/\\/g, '/'),
          PATH: [path.join(ndkPath, 'prebuilt', hostTag, 'bin'), path.join(toolchain, 'bin'),
          path.join(targetDir, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(path.delimiter)
        };
      console.log(chalk.cyan('  ℹ️  编译原生模块 (' + abi + ')...'));
      try { run('npm', ['rebuild', '--build-from-source', '--no-audit', '--no-fund'], { cwd: targetDir, env, quiet: true }); }
      catch (e) { console.error(chalk.red('  [错误] 原生模块编译失败 (' + abi + '): ' + e.message)), process.exit(1); }
      const missing = findNativePackages(targetDir).filter(name => {
        const pkgDir = path.join(targetDir, 'node_modules', name),
          prebuildDir = path.join(pkgDir, 'prebuilds', 'android-' + map.arch),
          hasPrebuild = fs.existsSync(prebuildDir) && fs.readdirSync(prebuildDir).some(f => f.endsWith('.node')),
          releaseDir = path.join(pkgDir, 'build', 'Release'),
          hasBuild = fs.existsSync(releaseDir) && fs.readdirSync(releaseDir).some(f => f.endsWith('.node'));
        return !hasPrebuild && !hasBuild;
      });
      if (missing.length > 0) {
        console.error(chalk.red('  [错误] 以下原生模块编译后缺少 .node (' + abi + '):'));
        for (const n of missing) console.error(chalk.red('         - ' + n));
        process.exit(1);
      }
      fs.writeFileSync(path.join(assetsDir, '.native-built-' + abi), new Date().toISOString());
      console.log(chalk.green('    ✓ 原生模块编译完成 (' + abi + ')'));
    }
  },
  /**
   * 内部：iOS 的 WebView SSL 补丁
   */
  patchWebViewSslIos = userProjectDir => {
    const file = path.join(userProjectDir, 'node_modules', 'react-native-webview', 'apple', 'RNCWebViewImpl.m');
    if (!fs.existsSync(file)) return;

    let c = fs.readFileSync(file, 'utf-8');
    if (c.includes('LOCALHOST_SSL_BYPASS_IOS')) return console.log(chalk.green('    ✓ iOS WebView SSL 补丁已应用'));

    // 在 "NSString* host = nil;" 那一段之后插入 localhost 放行
    const anchor = '  if ([[challenge protectionSpace] authenticationMethod] == NSURLAuthenticationMethodClientCertificate) {',
      idx = c.indexOf(anchor);
    if (idx === -1) return console.warn(chalk.yellow('  ⚠️  RNCWebViewImpl.m 里未找到锚点,跳过 iOS SSL 补丁'));

    const injected = [
      '  // LOCALHOST_SSL_BYPASS_IOS: 对 localhost/127.0.0.1 放行自签名证书（仅本地测试用）',
      '  if (host != nil && ([host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"])) {',
      '    NSURLCredential *cred = [NSURLCredential credentialForTrust:challenge.protectionSpace.serverTrust];',
      '    completionHandler(NSURLSessionAuthChallengeUseCredential, cred);',
      '    return;',
      '  }',
      '',
    ].join('\n');

    c = c.substring(0, idx) + injected + c.substring(idx);
    fs.writeFileSync(file, c, 'utf-8');
    console.log(chalk.green('    ✓ 已应用 iOS WebView SSL 补丁（允许 localhost 自签证书）'));
  },
  /**
   * 装用户项目的生产依赖到 <buildDir>/nodejs-assets/nodejs-project/
   * 只装 dependencies,不装 devDependencies
   * 依赖 + 环境未变化且上次构建完成时跳过,否则按需重装 / 仅优化
   * 快照记录在 buildDir/.deps-snapshot.json（与桌面版一致）
   */
  installUserDeps = async (targetDir, userProjectDir, config, buildDir, targetPlatform) => {
    const assetsDir = path.dirname(targetDir), bnmFile = path.join(assetsDir, 'BUILD_NATIVE_MODULES.txt'),
      nodeModulesDir = path.join(targetDir, 'node_modules'), snapshotPath = path.join(buildDir, '.deps-snapshot.json'),
      forceRebuild = process.env.NODE_MOBILE_FORCE_REBUILD === '1', hasNative = hasNativeModules(userProjectDir),
      optimizeCfg = config.optimize || {}, thisOptimize = optimizeCfg.enabled !== false,
      abiFilters = [...(config.android.abiFilters || [])].sort(),
      runtimeMajor = resolveRuntimeMajor(userProjectDir, targetPlatform);

    fs.writeFileSync(bnmFile, hasNative ? '1' : '0');
    if (hasNative) console.log(chalk.gray('  ℹ️  检测到原生模块（binding.gyp）'));

    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8')), deps = pkg.dependencies || {},
      sortedDeps = Object.keys(deps).sort().reduce((acc, k) => { acc[k] = deps[k]; return acc; }, {}),
      installerHash = createHash('sha256').update(fs.readFileSync(new URL(import.meta.url), 'utf-8')).digest('hex').slice(0, 16),
      snapshotData = { deps: sortedDeps, type: pkg.type || '', hasNative, forceRebuild };

    let shouldInstall = true, shouldOptimize = thisOptimize, reasons = [];
    if (fs.existsSync(snapshotPath)) {
      const old = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')), verifiedOk = old.verified === true,
        depsSame = JSON.stringify({
          deps: old.deps, type: old.type, hasNative: old.hasNative, forceRebuild: old.forceRebuild
        }) === JSON.stringify(snapshotData),
        envSame = old.platform === targetPlatform && JSON.stringify(old.abiFilters) === JSON.stringify(abiFilters) &&
          old.runtimeMajor === runtimeMajor,
        lastOptimized = old.optimized !== false, selfHashSame = old.optimizeHash === SELF_HASH,
        installerSame = old.installerHash === installerHash, nmExists = fs.existsSync(nodeModulesDir);
      if (!depsSame) reasons.push('依赖清单已变化');
      if (!verifiedOk) reasons.push('上次构建未完成');
      if (!envSame) reasons.push('运行环境已变化');
      if (!nmExists) reasons.push('缓存目录缺失');
      if (lastOptimized && !thisOptimize) reasons.push('优化已由开启转为关闭');
      if (thisOptimize && !selfHashSame && lastOptimized) reasons.push('优化程序已更新');
      if (!installerSame) reasons.push('安装器已更新');
      if (reasons.length > 0) {
        shouldInstall = true, shouldOptimize = thisOptimize;
        console.log(chalk.gray('  ℹ️  ' + (thisOptimize ? '重新安装依赖+优化' : '重新安装依赖') + '(原因: ' + reasons.join(', ') + ')'));
      }
      else if (thisOptimize && !lastOptimized)
        shouldInstall = false, shouldOptimize = true, console.log(chalk.gray('  ℹ️  依赖与环境未变化,仅需优化'));
      else {
        shouldInstall = false, shouldOptimize = false, console.log(chalk.gray('    ✓ 依赖与环境未变化,跳过安装与优化'));
        await clearVerified(buildDir);
        return;
      }
    } else console.log(chalk.gray('  ℹ️  ' + (thisOptimize ? '重新安装依赖+优化' : '重新安装依赖') + '(原因: 缓存快照缺失)'));

    if (shouldInstall) {
      if (fs.existsSync(nodeModulesDir))
        console.log(chalk.cyan('  清理旧 node_modules...')), fs.rmSync(nodeModulesDir, { recursive: true, force: true });

      try { fs.rmSync(snapshotPath, { force: true }); } catch { }
      const env = { ...process.env };
      if (hasNative) env.NODEJS_MOBILE_BUILD_NATIVE_MODULES = '1';
      console.log(chalk.cyan('  安装用户生产依赖（nodejs-assets/nodejs-project）...'));
      run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: targetDir, env, quiet: true });
      const snap = {
        ...snapshotData, platform: targetPlatform, abiFilters, runtimeMajor,
        optimizeHash: SELF_HASH, installerHash, optimized: false, verified: false
      };
      fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));
      console.log(chalk.green('    ✓ 用户依赖安装完成'));
    }

    if (hasNative && targetPlatform === 'android' && shouldInstall)
      compileNativeModules(targetDir, userProjectDir, config, buildDir, abiFilters);
    if (shouldOptimize) {
      console.log(chalk.cyan('  [信息] 正在执行优化...'));
      try {
        await optimizeNodeModules(targetDir, {
          targetPlatform, abiFilters, runtimeMajor, exclude: optimizeCfg.exclude || [], snapshotDir: buildDir
        });
      } catch (err) {
        console.error(chalk.red('  [错误] node_modules 优化失败：' + err.message));
        console.error(chalk.red('  [提示] 可在 mobileAppConfig.js 中设置 optimize: { enabled: false } 关闭优化,'));
        console.error(chalk.red('         或用 optimize: { exclude: ["包名"] } 排除问题包。')), process.exit(1);
      }
    }
  },
  /**
   * 修改 @flun/nodejs-mobile-react-native 插件 build.gradle 的 abiFilters
   */
  patchNodejsMobilePlugin = (userProjectDir, config) => {
    const pluginDir = findPluginDir(userProjectDir);
    if (!pluginDir) return console.warn(chalk.yellow('  ⚠️  未找到 @flun/nodejs-mobile-react-native 插件,跳过 patch'));

    const file = path.join(pluginDir, 'android', 'build.gradle'),
      abiList = config.android.abiFilters.map((x) => `"${x}"`).join(', ');

    let c = fs.readFileSync(file, 'utf-8');
    const before = c;
    c = c.replace(/abiFilters\s*=\s*\[[^\]]*\]/, `abiFilters = [${abiList}]`);

    if (c !== before) fs.writeFileSync(file, c, 'utf-8'), console.log(chalk.green(`  ✓ 已设置插件 abiFilters = [${abiList}]`));
  },
  /**
   * 让 react-native-webview 对 localhost 自签名证书放行
   * Android: patch RNCWebViewClient.java
   * iOS:     patch RNCWebViewImpl.m
   * 仅在 config.webview.allowSelfSignedCert === true 时应用
   * 每次 test/build 都检查（npm 重装 webview 后会覆盖补丁）
   */
  patchWebViewSsl = (userProjectDir, config) => {
    if (!config.webview || config.webview.allowSelfSignedCert !== true) return;

    const file = path.join(
      userProjectDir, 'node_modules', 'react-native-webview', 'android', 'src', 'main', 'java', 'com',
      'reactnativecommunity', 'webview', 'RNCWebViewClient.java'
    );

    if (fs.existsSync(file)) {
      let c = fs.readFileSync(file, 'utf-8');
      if (c.includes('LOCALHOST_SSL_BYPASS')) console.log(chalk.green('    ✓ Android WebView SSL 补丁已应用'));
      else {
        const old = 'handler.cancel();', methodIndex = c.indexOf('onReceivedSslError');
        if (methodIndex !== -1) {
          const cancelIndex = c.indexOf(old, methodIndex);
          if (cancelIndex !== -1) {
            const newCode = [
              '// LOCALHOST_SSL_BYPASS: 对 localhost/127.0.0.1 放行自签名证书（仅本地测试用）',
              '        if (failingUrl != null',
              '            && (failingUrl.startsWith("https://127.0.0.1") || failingUrl.startsWith("https://localhost"))) {',
              '            handler.proceed();',
              '            return;',
              '        }',
              '        handler.cancel();',
            ].join('\n');
            c = c.substring(0, cancelIndex) + newCode + c.substring(cancelIndex + old.length);
            fs.writeFileSync(file, c, 'utf-8');
            console.log(chalk.green('    ✓ 已应用 Android WebView SSL 补丁（允许 localhost 自签证书）'));
          }
        }
      }
    }
    patchWebViewSslIos(userProjectDir); // iOS 分支
  };

export { installUserDeps, patchNodejsMobilePlugin, patchWebViewSsl };