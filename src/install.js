import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { run } from './utils.js';

/**
 * 内部：依赖 hash（dependencies + type）
 */
const hashDeps = pkgPath => {
  const h = crypto.createHash('sha256');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      h.update(JSON.stringify(pkg.dependencies || {})), h.update('|'), h.update(pkg.type || '');
    } catch { h.update('read-error') }
  }
  else h.update('no-package');
  return h.digest('hex');
},
  /**
   * 内部：定位 @flun/nodejs-mobile-react-native 插件目录
   */
  findPluginDir = userProjectDir => {
    const candidates = [
      path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native'),
    ];
    for (const c of candidates) if (fs.existsSync(path.join(c, 'android', 'build.gradle'))) return c;
    return null;
  },
  /**
   * 内部：iOS 的 WebView SSL 补丁
   */
  patchWebViewSslIos = userProjectDir => {
    const file = path.join(
      userProjectDir, 'node_modules', 'react-native-webview', 'apple', 'RNCWebViewImpl.m'
    );
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
   * 依赖未变化且 node_modules 存在时跳过（用 .deps-hash 记录）
   */
  installUserDeps = (targetDir, config) => {
    const assetsDir = path.dirname(targetDir), bnmFile = path.join(assetsDir, 'BUILD_NATIVE_MODULES.txt'),
      hashFile = path.join(targetDir, '.deps-hash'), buildNative = !!config.android.buildNativeModules;
    fs.writeFileSync(bnmFile, buildNative ? '1' : '0');

    // 计算当前依赖 hash
    const pkgPath = path.join(targetDir, 'package.json'), currentHash = hashDeps(pkgPath),
      nodeModulesDir = path.join(targetDir, 'node_modules'), hasModules = fs.existsSync(nodeModulesDir);
    let oldHash = null;
    if (fs.existsSync(hashFile)) try { oldHash = fs.readFileSync(hashFile, 'utf-8').trim(); } catch { };
    if (hasModules && oldHash === currentHash) return console.log('  ✓ 依赖无变化，跳过安装');

    const env = { ...process.env };
    if (buildNative) env.NODEJS_MOBILE_BUILD_NATIVE_MODULES = '1';

    console.log('  安装用户生产依赖（nodejs-assets/nodejs-project）...');
    run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: targetDir, env });
    fs.writeFileSync(hashFile, currentHash, 'utf-8');
    console.log('  ✓ 用户依赖安装完成');
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
              '        if (failingUrl != null && (failingUrl.startsWith("https://127.0.0.1") || failingUrl.startsWith("https://localhost"))) {',
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