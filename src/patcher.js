import path from 'path';
import fs from 'fs';
import { writeIfChanged } from './utils.js';

/**
 * 解析最终 appName：
 *   1. config.appName
 *   2. 用户项目 package.json 的 name
 *   3. 'MyApp'
 */
const resolveAppName = (userProjectDir, config) => {
  if (config.appName) return String(config.appName);
  const pkgPath = path.join(userProjectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) return String(pkg.name);
    } catch { }
  }
  return 'MyApp';
},
  /** 通用字符串转义基础：\\, ", \n, \r, \t */
  escapeStringBase = s => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t'),
  /** Kotlin 字符串字面量转义：基础 + 转义 $ */
  escapeKotlinString = s => escapeStringBase(s).replace(/\$/g, '\\$'),
  /** Swift 字符串字面量转义：基础 + 转义 \( */
  escapeSwiftString = s => escapeStringBase(s).replace(/\(/g, '\\('),
  escapeXml = s => {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },
  /**
   * 把 mobileAppConfig.js 里的应用信息写入 buildDir 的 RN 工程
   *   - android/app/build.gradle: namespace / applicationId / versionCode / versionName
   *   - app.json: name / displayName
   *   - res/values/strings.xml: app_name
   *   - MainActivity.kt / MainApplication.kt: package 声明
   */
  patchAppConfig = (buildDir, userProjectDir, config) => {
    const appName = resolveAppName(userProjectDir, config), appId = config.appId,
      versionCode = config.versionCode, versionName = config.versionName,
      gradleFile = path.join(buildDir, 'android', 'app', 'build.gradle'),
      appJsonFile = path.join(buildDir, 'app.json'),
      stringsFile = path.join(buildDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      ktFiles = [
        path.join(buildDir, 'android', 'app', 'src', 'main', 'java', 'com', 'myapp', 'MainActivity.kt'),
        path.join(buildDir, 'android', 'app', 'src', 'main', 'java', 'com', 'myapp', 'MainApplication.kt'),
      ];
    // 1. build.gradle
    if (fs.existsSync(gradleFile)) {
      let c = fs.readFileSync(gradleFile, 'utf-8');
      c = c.replace(/namespace\s+"[^"]+"/, 'namespace "' + appId + '"');
      c = c.replace(/applicationId\s+"[^"]+"/, 'applicationId "' + appId + '"');
      c = c.replace(/versionCode\s+\d+/, 'versionCode ' + versionCode);
      c = c.replace(/versionName\s+"[^"]+"/, 'versionName "' + versionName + '"');
      writeIfChanged(gradleFile, c);
    }
    // 2. app.json
    if (fs.existsSync(appJsonFile)) {
      const obj = { name: appName, displayName: appName };
      writeIfChanged(appJsonFile, JSON.stringify(obj, null, 2) + '\n');
    }
    // 3. strings.xml
    if (fs.existsSync(stringsFile)) {
      let c = fs.readFileSync(stringsFile, 'utf-8');
      c = c.replace(/(<string name="app_name">)[^<]*(<\/string>)/, '$1' + escapeXml(appName) + '$2');
      writeIfChanged(stringsFile, c);
    }
    // 4. MainActivity.kt / MainApplication.kt 的 package 声明
    for (const f of ktFiles) {
      if (!fs.existsSync(f)) continue;
      let c = fs.readFileSync(f, 'utf-8');
      c = c.replace(/^package\s+[\w.]+/m, 'package ' + appId);
      // MainActivity.kt: getMainComponentName 要和 app.json.name 一致
      c = c.replace(
        /(override\s+fun\s+getMainComponentName\(\)\s*:\s*String\s*=\s*)"[^"]*"/, `$1"${escapeKotlinString(appName)}"`
      );
      writeIfChanged(f, c);
    }

    console.log(`  ✓ 应用信息：${appName} (${appId}) v${versionName}(${versionCode})`);
  },
  /**
   * 把 mobileAppConfig.js 里的 Android 编译配置写入 buildDir：
   *   - android/build.gradle 的 ext 块：minSdkVersion / targetSdkVersion / compileSdkVersion / buildToolsVersion
   *   - android/app/build.gradle 的 manifestPlaceholders：usesCleartextTraffic
   *   - AndroidManifest.xml：permissions（去重，始终含 INTERNET）
   */
  patchAndroidConfig = (buildDir, config) => {
    const a = config.android || {}, rootGradle = path.join(buildDir, 'android', 'build.gradle'),
      manifestFile = path.join(buildDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    // 1. 根 build.gradle 的 ext 块
    if (fs.existsSync(rootGradle)) {
      let c = fs.readFileSync(rootGradle, 'utf-8');
      if (Number.isInteger(a.minSdkVersion))
        c = c.replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = ' + a.minSdkVersion);
      if (Number.isInteger(a.targetSdkVersion))
        c = c.replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = ' + a.targetSdkVersion);
      if (Number.isInteger(a.compileSdkVersion))
        c = c.replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = ' + a.compileSdkVersion);
      if (a.buildToolsVersion)
        c = c.replace(/buildToolsVersion\s*=\s*"[^"]+"/, 'buildToolsVersion = "' + a.buildToolsVersion + '"');
      writeIfChanged(rootGradle, c);
    }
    // 2. AndroidManifest.xml: 直接写死 usesCleartextTraffic + tools:replace
    //    不用占位符，因为 AGP release 构建在 targetSdk>=28 时会强制 false
    if (fs.existsSync(manifestFile)) {
      let c = fs.readFileSync(manifestFile, 'utf-8');
      const ct = a.usesCleartextTraffic !== false ? 'true' : 'false';

      // manifest 根标签加 xmlns:tools
      if (!c.includes('xmlns:tools=')) {
        c = c.replace(
          /<manifest\s+xmlns:android="[^"]*"/,
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"'
        );
      }
      // 替换占位符值为实际值
      c = c.replace(/android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/, `android:usesCleartextTraffic="${ct}"`);
      // application 标签加 tools:replace
      if (!/tools:replace="[^"]*android:usesCleartextTraffic/.test(c))
        c = c.replace(/(<application)/, '$1\n    tools:replace="android:usesCleartextTraffic"');

      writeIfChanged(manifestFile, c);
    }
    // 3. AndroidManifest.xml 权限
    if (fs.existsSync(manifestFile)) {
      let c = fs.readFileSync(manifestFile, 'utf-8');
      const perms = new Set(['android.permission.INTERNET']);
      for (const p of a.permissions || []) perms.add(p);

      // 删掉现有的所有 <uses-permission ... /> 行
      c = c.replace(/^\s*<uses-permission[^>]*\/>\s*\r?\n/gm, '');
      // 在 <application 前插入
      const block = Array.from(perms).map((p) => `  <uses-permission android:name="${p}" />`).join('\n');
      c = c.replace(/(\r?\n)(\s*<application)/, `\n${block}\n\n$2`);
      writeIfChanged(manifestFile, c);
    }

    console.log(`  ✓ Android 配置：SDK ${a.minSdkVersion}/${a.targetSdkVersion}/${a.compileSdkVersion},
      权限 ${new Set(['android.permission.INTERNET', ...(a.permissions || [])]).size} 项`);
  },
  /**
   * 处理 Release 签名：
   *   - config.android.signing 有值 → 写 keystore 路径到 gradle.properties，加 signingConfigs.release 块，release buildType 用它
   *   - 没值 → 不动（release 沿用 debug，可装但不可发布）
   *
   * keystore 路径以用户项目根为基准。
   */
  patchSigning = (buildDir, userProjectDir, config) => {
    const signing = config.android && config.android.signing;
    if (!signing || !signing.keystore) return; // 未配置签名 → 保持默认

    const keystoreAbs = path.resolve(userProjectDir, signing.keystore);
    if (!fs.existsSync(keystoreAbs)) return console.warn('  ⚠️  签名 keystore 不存在，跳过签名配置:', keystoreAbs);

    // 1. 写 gradle.properties（追加或覆盖 MYAPP_RELEASE_*）
    const propsFile = path.join(buildDir, 'android', 'gradle.properties');
    if (fs.existsSync(propsFile)) {
      let c = fs.readFileSync(propsFile, 'utf-8');
      // 删掉旧的 4 行
      c = c.replace(/^\s*MYAPP_RELEASE_STORE_FILE=.*\r?\n/gm, '');
      c = c.replace(/^\s*MYAPP_RELEASE_STORE_PASSWORD=.*\r?\n/gm, '');
      c = c.replace(/^\s*MYAPP_RELEASE_KEY_ALIAS=.*\r?\n/gm, '');
      c = c.replace(/^\s*MYAPP_RELEASE_KEY_PASSWORD=.*\r?\n/gm, '');
      // 追加新的
      const esc = keystoreAbs.replace(/\\/g, '/');
      c += `\nMYAPP_RELEASE_STORE_FILE=${esc}\n`;
      c += `MYAPP_RELEASE_STORE_PASSWORD=${signing.storePassword || ''}\n`;
      c += `MYAPP_RELEASE_KEY_ALIAS=${signing.keyAlias || ''}\n`;
      c += `MYAPP_RELEASE_KEY_PASSWORD=${signing.keyPassword || ''}\n`;
      writeIfChanged(propsFile, c);
    }

    // 2. app/build.gradle: 加 signingConfigs.release，并让 buildTypes.release 用它
    const gradleFile = path.join(buildDir, 'android', 'app', 'build.gradle');
    if (fs.existsSync(gradleFile)) {
      let c = fs.readFileSync(gradleFile, 'utf-8');

      // 加 release 签名块（先删旧的，避免重复）
      c = c.replace(/\s*release\s*\{\s*storeFile[\s\S]*?\}\r?\n(\s*\}\s*\r?\n)/, '$1');
      // 在 signingConfigs { 之后插入
      c = c.replace(/(signingConfigs\s*\{)/,
        `$1
        release {
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }`
      );

      // 让 release buildType 用 signingConfigs.release
      // 只替换 release { 之后的第一个 signingConfig signingConfigs.debug
      c = c.replace(/(release\s*\{\s*\n\s*signingConfig\s+)signingConfigs\.debug/, '$1signingConfigs.release');
      writeIfChanged(gradleFile, c);
    }

    console.log('  ✓ Release 签名已配置:', path.basename(keystoreAbs));
  },
  /**
   * 应用图标：把用户提供的 PNG 缩放到 5 个 Android 密度，覆盖各 mipmap 目录下的 ic_launcher 与 ic_launcher_round
   * 未配置或文件不存在时保持默认
   */
  patchIcon = async (buildDir, userProjectDir, config) => {
    const iconPath = config.android && config.android.icon;
    if (!iconPath) return;

    const iconAbs = path.resolve(userProjectDir, iconPath);
    if (!fs.existsSync(iconAbs)) return console.warn('  ⚠️  图标文件不存在，保持默认:', iconAbs);

    const { Jimp } = await import('jimp'),
      densities = [
        { dir: 'mipmap-mdpi', size: 48 },
        { dir: 'mipmap-hdpi', size: 72 },
        { dir: 'mipmap-xhdpi', size: 96 },
        { dir: 'mipmap-xxhdpi', size: 144 },
        { dir: 'mipmap-xxxhdpi', size: 192 }
      ], resDir = path.join(buildDir, 'android', 'app', 'src', 'main', 'res'), source = await Jimp.read(iconAbs);

    for (const { dir, size } of densities) {
      const targetDir = path.join(resDir, dir);
      if (!fs.existsSync(targetDir)) continue;

      const img = source.clone();
      img.resize({ w: size, h: size });
      const buf = await img.getBuffer('image/png');

      fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), buf);
      fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), buf);
    }

    console.log(`  ✓ 图标已应用: ${path.basename(iconAbs)}`);
  },
  /**
   * 写入 iOS 工程配置：
   *   - Info.plist: CFBundleDisplayName
   *   - project.pbxproj: PRODUCT_BUNDLE_IDENTIFIER / MARKETING_VERSION / CURRENT_PROJECT_VERSION / IPHONEOS_DEPLOYMENT_TARGET
   * 只在 buildDir 里存在 ios/ 时执行（其余平台跳过）。
   */
  patchIosConfig = (buildDir, userProjectDir, config) => {
    const iosDir = path.join(buildDir, 'ios');
    if (!fs.existsSync(iosDir)) return;

    const appName = resolveAppName(userProjectDir, config), appId = config.appId, versionName = config.versionName,
      versionCode = config.versionCode, deploymentTarget = (config.ios?.deploymentTarget) || '15.1',
      plist = path.join(iosDir, 'MyApp', 'Info.plist'), pbx = path.join(iosDir, 'MyApp.xcodeproj', 'project.pbxproj'),
      appDelegate = path.join(iosDir, 'MyApp', 'AppDelegate.swift');
    // 1. Info.plist：CFBundleDisplayName + ATS (对应 Android 的 usesCleartextTraffic)
    if (fs.existsSync(plist)) {
      let c = fs.readFileSync(plist, 'utf-8');

      // CFBundleDisplayName
      c = c.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, '$1' + escapeXml(appName) + '$2');
      // ATS: usesCleartextTraffic=true → 放行本地 HTTP; false → 全部禁用
      const allowCleartext = config.android.usesCleartextTraffic !== false, tab = '\t', atsBlock = allowCleartext
        ? [
          '<key>NSAppTransportSecurity</key>',
          tab + '<dict>',
          tab + tab + '<key>NSAllowsArbitraryLoads</key>',
          tab + tab + '<false/>',
          tab + tab + '<key>NSAllowsLocalNetworking</key>',
          tab + tab + '<true/>',
          tab + tab + '<key>NSExceptionDomains</key>',
          tab + tab + '<dict>',
          tab + tab + tab + '<key>localhost</key>',
          tab + tab + tab + '<dict>',
          tab + tab + tab + tab + '<key>NSExceptionAllowsInsecureHTTPLoads</key>',
          tab + tab + tab + tab + '<true/>',
          tab + tab + tab + tab + '<key>NSIncludesSubdomains</key>',
          tab + tab + tab + tab + '<true/>',
          tab + tab + tab + '</dict>',
          tab + tab + tab + '<key>127.0.0.1</key>',
          tab + tab + tab + '<dict>',
          tab + tab + tab + tab + '<key>NSExceptionAllowsInsecureHTTPLoads</key>',
          tab + tab + tab + tab + '<true/>',
          tab + tab + tab + '</dict>',
          tab + tab + '</dict>',
          tab + '</dict>',
        ].join('\n')
        : [
          '<key>NSAppTransportSecurity</key>',
          tab + '<dict>',
          tab + tab + '<key>NSAllowsArbitraryLoads</key>',
          tab + tab + '<false/>',
          tab + tab + '<key>NSAllowsLocalNetworking</key>',
          tab + tab + '<false/>',
          tab + '</dict>',
        ].join('\n');

      c = c.replace(
        /<key>NSAppTransportSecurity<\/key>[\s\S]*?(?=<key>NSLocationWhenInUseUsageDescription<\/key>)/, atsBlock + '\n\t'
      );
      writeIfChanged(plist, c);
    }

    // 2. project.pbxproj
    if (fs.existsSync(pbx)) {
      let c = fs.readFileSync(pbx, 'utf-8');
      c = c.replace(/PRODUCT_BUNDLE_IDENTIFIER = "[^"]+";/g, `PRODUCT_BUNDLE_IDENTIFIER = "${appId}";`);
      c = c.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versionName};`);
      c = c.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`);
      c = c.replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, `IPHONEOS_DEPLOYMENT_TARGET = ${deploymentTarget};`);
      writeIfChanged(pbx, c);
    }

    // 3. AppDelegate.swift: withModuleName 要和 app.json.name 一致
    if (fs.existsSync(appDelegate)) {
      let c = fs.readFileSync(appDelegate, 'utf-8');
      c = c.replace(/(withModuleName:\s*)"[^"]*"/, `$1"${escapeSwiftString(appName)}"`);
      writeIfChanged(appDelegate, c);
    }

    console.log(`  ✓ iOS 配置：${appName} (${appId}) v${versionName}(${versionCode}), target ${deploymentTarget}`);
  },
  /**
   * iOS 应用图标：把用户提供的 PNG 缩放到 9 个尺寸，写入 AppIcon.appiconset
   * 同时改写 Contents.json 加 filename 字段
   * 未配置或文件不存在时保持默认（无图标，Xcode 会用系统占位）
   */
  patchIosIcon = async (buildDir, userProjectDir, config) => {
    const iconPath = config.ios && config.ios.icon;
    if (!iconPath) return;

    const iconAbs = path.resolve(userProjectDir, iconPath);
    if (!fs.existsSync(iconAbs)) return console.warn('  ⚠️  iOS 图标文件不存在，保持默认:', iconAbs);

    const iconDir = path.join(buildDir, 'ios', 'MyApp', 'Images.xcassets', 'AppIcon.appiconset');
    if (!fs.existsSync(iconDir)) return;

    const { Jimp } = await import('jimp'), source = await Jimp.read(iconAbs),
      // Apple 规范：每项 (idiom, size, scale) 对应的像素尺寸与文件名
      variants = [
        { idiom: 'iphone', size: '20x20', scale: '2x', px: 40, name: 'Icon-App-20x20@2x.png' },
        { idiom: 'iphone', size: '20x20', scale: '3x', px: 60, name: 'Icon-App-20x20@3x.png' },
        { idiom: 'iphone', size: '29x29', scale: '2x', px: 58, name: 'Icon-App-29x29@2x.png' },
        { idiom: 'iphone', size: '29x29', scale: '3x', px: 87, name: 'Icon-App-29x29@3x.png' },
        { idiom: 'iphone', size: '40x40', scale: '2x', px: 80, name: 'Icon-App-40x40@2x.png' },
        { idiom: 'iphone', size: '40x40', scale: '3x', px: 120, name: 'Icon-App-40x40@3x.png' },
        { idiom: 'iphone', size: '60x60', scale: '2x', px: 120, name: 'Icon-App-60x60@2x.png' },
        { idiom: 'iphone', size: '60x60', scale: '3x', px: 180, name: 'Icon-App-60x60@3x.png' },
        { idiom: 'ios-marketing', size: '1024x1024', scale: '1x', px: 1024, name: 'Icon-App-1024x1024@1x.png' },
      ], contentsFile = path.join(iconDir, 'Contents.json'),
      contents = {
        images: variants.map(v => ({ idiom: v.idiom, scale: v.scale, size: v.size, filename: v.name, })),
        info: { author: 'xcode', version: 1 }
      };

    for (const v of variants) {
      const img = source.clone();
      img.resize({ w: v.px, h: v.px });
      const buf = await img.getBuffer('image/png');
      fs.writeFileSync(path.join(iconDir, v.name), buf);
    }

    // 改写 Contents.json，给每项加 filename
    writeIfChanged(contentsFile, JSON.stringify(contents, null, 2) + '\n');
    console.log(`  ✓ iOS 图标已应用: ${path.basename(iconAbs)}`);
  }

// ===== 导出 =====
export {
  resolveAppName, escapeKotlinString, escapeSwiftString, patchAppConfig, patchAndroidConfig, patchSigning,
  patchIcon, patchIosConfig, patchIosIcon,
};
