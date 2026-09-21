import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const DEFAULT_CONFIG = {
  serverPath: './server.js',
  appName: null,
  outputDir: null,
  appId: 'com.example.app',
  versionCode: 1,
  versionName: '1.0.0',
  webview: {
    showLoading: true,
    loadingText: '正在启动服务...',
    enableJavaScript: true,
    enableDomStorage: true,
    allowFileAccess: true,
    mixedContentMode: 'always',
    backgroundColor: '#ffffff',
    allowSelfSignedCert: false,
  },
  android: {
    sdkPath: null,
    adbPath: null,
    minSdkVersion: 29,
    targetSdkVersion: 36,
    compileSdkVersion: 37,
    buildToolsVersion: '37.0.0',
    abiFilters: ['arm64-v8a'],
    icon: './build/icon.png',
    usesCleartextTraffic: true,
    permissions: [],
    buildNativeModules: false,
    signing: {},
  },
  ios: {
    deploymentTarget: '15.1',
    icon: './build/icon.png',
    signing: {},
  },
  advanced: {
    keepAlive: true,
    heartbeatInterval: 5000,
  },
  keepFiles: [],
  extraRnDependencies: [],
  excludeFiles: [
    '.git/', '.vscode/', '.idea/', '.vs/',
    'node_modules/', 'sessions/', 'users.json', '.env',
    '*.log', '*.md', '*.tgz', '*.bak', '.backup*', 'dist/', 'out/', 'build/', 'tests/',
    'node-mobile-app-build/', 'nodejs-assets/',
  ],
  allowScripts: {
    'node': true,
  }
},
  merge = (def, user) => {
    const out = { ...def };
    for (const k of Object.keys(user)) {
      if (user[k] && typeof user[k] === 'object' && !Array.isArray(user[k])) out[k] = merge(def[k] || {}, user[k]);
      else if (user[k] !== undefined && user[k] !== null) out[k] = user[k];
    }
    return out;
  },
  loadConfig = async userProjectDir => {
    for (const name of ['mobileAppConfig.js', 'mobileAppConfig.mjs', 'mobileAppConfig.cjs']) {
      const p = path.join(userProjectDir, name);
      if (fs.existsSync(p)) {
        console.log('读取配置:', name);
        const mod = await import(pathToFileURL(p).href);
        return merge(DEFAULT_CONFIG, mod.default || mod);
      }
    }
    console.log('未找到 mobileAppConfig.js，使用默认配置');
    return DEFAULT_CONFIG;
  },
  validateConfig = (config, userProjectDir) => {
    const errors = [], entry = path.join(userProjectDir, config.serverPath);
    if (!fs.existsSync(entry)) errors.push('serverPath 不存在: ' + config.serverPath);

    const pkg = path.join(userProjectDir, 'package.json');
    if (!fs.existsSync(pkg)) errors.push('用户项目缺少 package.json');
    // 极简防呆：至少 2 段、每段非空、只含 [a-zA-Z0-9_-]，不允许首尾点或连续点
    // 具体平台是否合法交给 Gradle / Xcode 报错（Android 不允许 -，iOS 允许）
    if (
      typeof config.appId !== 'string' ||
      !/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(config.appId)
    )
      errors.push('appId 格式不合法（需反向域名格式，如 com.example.app）: ' + config.appId);
    if (!Number.isInteger(config.versionCode) || config.versionCode < 1) errors.push('versionCode 必须是正整数');
    if (!config.android.abiFilters?.length) errors.push('android.abiFilters 不能为空');
    if (errors.length) {
      errors.forEach((e) => console.error('  - ' + e));
      throw new Error('配置校验失败');
    }
    console.log('配置校验通过');
  },
  resolveSdkPath = (config) => {
    if (config.android && config.android.sdkPath) return config.android.sdkPath;
    for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      const base = process.env[env];
      if (base && fs.existsSync(base)) return base;
    }
    const localAppData = process.env.LOCALAPPDATA || '', home = process.env.USERPROFILE || process.env.HOME || '',
      candidates = [path.join(localAppData, 'Android', 'Sdk'), path.join(home, 'Library', 'Android', 'sdk'),
      path.join(home, 'Android', 'Sdk')];

    for (const c of candidates) if (c && fs.existsSync(path.join(c, 'platform-tools'))) return c;
    return null;
  };

export { DEFAULT_CONFIG, loadConfig, validateConfig, resolveSdkPath };