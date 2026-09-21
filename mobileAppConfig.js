/**
 * @flun/node-mobile-app 配置文件
 * 放置在用户 Node.js 项目根目录，CLI 会自动读取
 * 如不提供此文件，CLI 使用默认配置
 * 所有路径相对于用户项目根目录
 *
 * ===== 常用命令 =====
 *   npx node-mobile-app test            编译并安装到设备（需连 USB，走 Metro 热更新）
 *   npx node-mobile-app test --ios      iOS 版（仅 macOS）
 *   npx node-mobile-app build           打 debug APK（离线可用）
 *   npx node-mobile-app build --release 打 release APK（默认 debug keystore 签名，可安装；上架需配 android.signing）
 *   npx node-mobile-app build --ios     打 IPA（仅 macOS）
 *   npx node-mobile-app clean           清理构建缓存
 *
 * ===== 服务地址说明 =====
 *   CLI 会自动识别 server.js 实际监听的协议和端口（拦截 listen 调用），
 *   App 使用该地址加载页面，无需在此配置。
 *   若 5 秒内未能识别，App 显示启动失败并可在页面展开详情查看原因。
 *   动态端口（listen(0)）会自动获取系统分配的真实端口。
 */
export default {
  // ===== 必填 =====
  serverPath: './server.js',            // Node.js 启动脚本路径

  // ===== 应用信息 =====
  appName: null,                        // 应用显示名称(默认从 package.json 的 name 读取)
  outputDir: null,                      // APK 输出目录(默认 ./out,相对于用户项目根)
  appId: 'com.example.app',             // 应用唯一标识(反向域名格式,Android/iOS 通用)
  versionCode: 1,                       // 内部版本号(整数,Android versionCode / iOS CFBundleVersion,每次发版递增)
  versionName: '1.0.0',                 // 用户可见版本名(Android versionName / iOS CFBundleShortVersionString)

  // ===== WebView 配置 =====
  webview: {
    showLoading: true,                // 是否显示加载指示器
    loadingText: '正在启动服务...',    // 加载提示文字
    enableJavaScript: true,           // 是否启用 JavaScript
    enableDomStorage: true,           // 是否启用 DOM Storage(localStorage 等)
    allowFileAccess: true,            // 是否允许访问本地文件
    mixedContentMode: 'always',       // 混合内容模式:never / always / compatibility
    // WebView 背景色，支持三种写法：
    //   '#ffffff' / 'white'              固定色
    //   'system'                         跟随系统（内部用默认浅/深色）
    //   { light: '#fff', dark: '#1a1a1a' }  按系统主题切换
    backgroundColor: '#ffffff',
    // 仅影响 HTTPS 场景下 App 是否加载自签证书的页面：
    //   - 用 HTTP：与本开关无关
    //   - 用 HTTPS + 真证书(如 Let's Encrypt)：与本开关无关
    //   - 用 HTTPS + 自签证书 + 已装进设备信任库：与本开关无关
    //   - 用 HTTPS + 自签证书 + 未装设备(本地测试最常见)：必须设为 true
    // ⚠️ 开启后仅对 127.0.0.1 / localhost 放行不受信任的 HTTPS 证书，其他域名仍严格校验
    //    用于本地自签证书测试，生产环境建议关闭
    allowSelfSignedCert: false,
  },

  // ===== Android 平台配置 =====
  android: {
    sdkPath: null,                    // Android SDK 路径(默认自动查找)
    adbPath: null,                    // adb.exe 路径(默认自动查找)
    minSdkVersion: 29,                // 最低 SDK(29=Android 10.0)
    targetSdkVersion: 36,             // 目标 SDK
    compileSdkVersion: 37,            // 编译 SDK
    buildToolsVersion: '37.0.0',      // 构建工具版本
    abiFilters: ['arm64-v8a'],        // 打包架构(真机用 arm64-v8a, 模拟器加 x86_64)
    icon: './build/icon.png',         // 应用图标(建议 512x512 PNG)
    usesCleartextTraffic: true,       // 是否允许明文流量(http)
    buildNativeModules: false,        // 是否在 nodejs-project 里编译原生模块(bcrypt 等)
    permissions: [                    // 额外权限(按需添加)
      // 'android.permission.INTERNET',   // INTERNET 始终包含,不需配置
      // 'android.permission.ACCESS_NETWORK_STATE',
      // 'android.permission.CAMERA',
      // 'android.permission.READ_EXTERNAL_STORAGE',
    ],
    // 签名配置（可选）
    //
    // 不配置也能打 release：模板默认用 debug keystore 签名（可安装、可本地测试，不可上架）。
    // 需要上架时再配置下面任一种：
    //
    // 方式一：Android SDK 自带 debug keystore（本地测试常用）
    //   keystore:       %USERPROFILE%\.android\debug.keystore   (Windows)
    //                   ~/.android/debug.keystore                 (macOS/Linux)
    //   storePassword:  'android'
    //   keyAlias:       'androiddebugkey'
    //   keyPassword:    'android'
    //
    // 自定义签名：取消下面注释，填入你的 keystore 信息
    signing: {
      // keystore: './build/release.keystore',
      // storePassword: '',
      // keyAlias: '',
      // keyPassword: '',
    },
  },

  // ===== iOS 平台配置 =====
  // 说明: 当前仅支持 Node 18;Node 18+ 需自行适配 libnode.so
  ios: {
    deploymentTarget: '15.1',         // 最低 iOS 版本(RN 0.87 要求 15.1+)
    icon: './build/icon.png',         // 应用图标(建议 1024x1024 PNG)
    // 签名配置（仅 macOS，发布时必填）：
    //   teamId              Apple Developer Team ID
    //   provisioningProfile 描述文件路径（写入 exportOptions.plist）
    //   certificate         P12 证书路径（导入临时 keychain 供 xcodebuild 签名用）
    //   certificatePassword P12 密码
    signing: {
      // teamId: '',
      // provisioningProfile: './build/profile.mobileprovision',
      // certificate: './build/cert.p12',
      // certificatePassword: '',
    },
  },

  // ===== 高级选项 =====
  advanced: {
    keepAlive: true,                  // 是否发送心跳保持 Node.js 进程活跃
    heartbeatInterval: 5000,          // 心跳间隔(毫秒)
  },

  // ===== 扩展点 =====
  // 不重置的模板文件（路径相对于 node-mobile-app-build/，如 'android/app/src/main/AndroidManifest.xml'）
  keepFiles: [],
  // 额外 RN 原生依赖包名数组（用于 autolink 识别，含原生模块的包必须在此声明）
  // 安装命令用 --save-dev，这些是开发依赖，不会进移动端 Node 环境
  // 示例: npm install --save-dev react-native-camera
  //       extraRnDependencies: ['react-native-camera']
  // 未安装的包会在 test/build 时中断并提示安装命令
  extraRnDependencies: [],

  // ===== 排除文件/目录(复制到壳工程时排除) =====
  excludeFiles: [
    '.git/',
    '.vscode/',
    '.idea/',
    '.vs/',
    'node_modules/',                  // 如需保留请删除此行
    'sessions/',
    'users.json',
    '.env',
    '*.log',
    '*.md',
    '*.tgz',
    '*.bak',
    '.backup*',
    'dist/',
    'out/',
    'build/',
    'tests/',
    './mobileAppConfig.js',           // 配置文件本身不打包
    'nodejs-assets/',                 // 插件 postinstall 生成的示例骨架
  ],

  // ===== 允许执行安装脚本的包 =====
  allowScripts: {
    'node': true,
    'unrs-resolver': true,
    '@parcel/watcher': true,
    'bcrypt': true,
  },
};
