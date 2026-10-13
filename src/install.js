import path from 'path';
import fs from 'fs';
import { run } from './utils.js';
import { optimizeNodeModules, clearVerified, SELF_HASH } from './optimize-node-modules.js';
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
      console.error('  [错误] 未找到 node_version.h: ' + header);
      console.error('         说明 libnode 目录不完整,请重新安装依赖。'), process.exit(1);
    }
    const m = fs.readFileSync(header, 'utf-8').match(/#define\s+NODE_MAJOR_VERSION\s+(\d+)/);
    if (!m) console.error('  [错误] 无法解析 node_version.h 中的 NODE_MAJOR_VERSION'), process.exit(1);
    return m[1];
  },
  /**
   * 内部：判断用户项目的生产依赖里是否含原生模块（binding.gyp）
   * 按用户根 package.json 的 dependencies 键名，去 userProjectDir/node_modules 下逐个查
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
  /**
   * 内部：iOS 的 WebView SSL 补丁
   */
  patchWebViewSslIos = userProjectDir => {
    const file = path.join(userProjectDir, 'node_modules', 'react-native-webview', 'apple', 'RNCWebViewImpl.m');
    if (!fs.existsSync(file)) return;

    let c = fs.readFileSync(file, 'utf-8');
    if (c.includes('LOCALHOST_SSL_BYPASS_IOS')) return console.log('  ✓ iOS WebView SSL 补丁已应用');

    // 在 "NSString* host = nil;" 那一段之后插入 localhost 放行
    const anchor = '  if ([[challenge protectionSpace] authenticationMethod] == NSURLAuthenticationMethodClientCertificate) {',
      idx = c.indexOf(anchor);
    if (idx === -1) return console.warn('  ⚠️  RNCWebViewImpl.m 里未找到锚点，跳过 iOS SSL 补丁');

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
    console.log('  ✓ 已应用 iOS WebView SSL 补丁（允许 localhost 自签证书）');
  },
  /**
   * 装用户项目的生产依赖到 <buildDir>/nodejs-assets/nodejs-project/
   * 只装 dependencies，不装 devDependencies
   * 依赖 + 环境未变化且上次构建完成时跳过；否则按需重装 / 仅优化
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
    if (hasNative) console.log('  ℹ️  检测到原生模块（binding.gyp）,将编译原生代码');

    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8')), deps = pkg.dependencies || {},
      sortedDeps = Object.keys(deps).sort().reduce((acc, k) => { acc[k] = deps[k]; return acc; }, {}),
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
        nmExists = fs.existsSync(nodeModulesDir);
      if (!depsSame) reasons.push('依赖清单已变化');
      if (!verifiedOk) reasons.push('上次构建未完成');
      if (!envSame) reasons.push('运行环境已变化');
      if (!nmExists) reasons.push('缓存目录缺失');
      if (lastOptimized && !thisOptimize) reasons.push('优化已由开启转为关闭');
      if (thisOptimize && !selfHashSame && lastOptimized) reasons.push('优化程序已更新');
      if (reasons.length > 0) {
        shouldInstall = true, shouldOptimize = thisOptimize;
        console.log('  ℹ️  需要重新安装依赖(原因: ' + reasons.join(', ') + ')');
      }
      else if (thisOptimize && !lastOptimized)
        shouldInstall = false, shouldOptimize = true, console.log('  ℹ️  依赖与环境未变化,仅需优化');
      else {
        shouldInstall = false, shouldOptimize = false, console.log('  ✓ 依赖与环境未变化,跳过安装与优化');
        await clearVerified(buildDir);
        return;
      }
    } else console.log('  ℹ️  需要重新安装依赖(原因: 缓存快照缺失)');

    if (shouldInstall) {
      if (fs.existsSync(nodeModulesDir))
        console.log('  清理旧 node_modules...'), fs.rmSync(nodeModulesDir, { recursive: true, force: true });

      try { fs.rmSync(snapshotPath, { force: true }); } catch { }
      const env = { ...process.env };
      if (hasNative) env.NODEJS_MOBILE_BUILD_NATIVE_MODULES = '1';
      console.log('  安装用户生产依赖（nodejs-assets/nodejs-project）...');
      run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: targetDir, env, inherit: true });
      const snap = {
        ...snapshotData, platform: targetPlatform, abiFilters, runtimeMajor,
        optimizeHash: SELF_HASH, optimized: false, verified: false
      };
      fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));
      console.log('  ✓ 用户依赖安装完成');
    }

    if (shouldOptimize) {
      try {
        await optimizeNodeModules(targetDir, {
          targetPlatform, abiFilters, runtimeMajor, exclude: optimizeCfg.exclude || [], snapshotDir: buildDir
        });
      } catch (err) {
        console.error('  [错误] node_modules 优化失败：' + err.message);
        console.error('  [提示] 可在 mobileAppConfig.js 中设置 optimize: { enabled: false } 关闭优化,');
        console.error('         或用 optimize: { exclude: ["包名"] } 排除问题包。'), process.exit(1);
      }
    }
  },
  /**
   * 修改 @flun/nodejs-mobile-react-native 插件 build.gradle 的 abiFilters
   */
  patchNodejsMobilePlugin = (userProjectDir, config) => {
    const pluginDir = findPluginDir(userProjectDir);
    if (!pluginDir) return console.warn('  ⚠️  未找到 @flun/nodejs-mobile-react-native 插件，跳过 patch');

    const file = path.join(pluginDir, 'android', 'build.gradle'),
      abiList = config.android.abiFilters.map((x) => `"${x}"`).join(', ');

    let c = fs.readFileSync(file, 'utf-8');
    const before = c;
    c = c.replace(/abiFilters\s*=\s*\[[^\]]*\]/, `abiFilters = [${abiList}]`);

    if (c !== before) fs.writeFileSync(file, c, 'utf-8'), console.log(`  ✓ 已设置插件 abiFilters = [${abiList}]`);
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
      if (c.includes('LOCALHOST_SSL_BYPASS')) console.log('  ✓ Android WebView SSL 补丁已应用');
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
            console.log('  ✓ 已应用 Android WebView SSL 补丁（允许 localhost 自签证书）');
          }
        }
      }
    }
    patchWebViewSslIos(userProjectDir); // iOS 分支
  };

export { installUserDeps, patchNodejsMobilePlugin, patchWebViewSsl };