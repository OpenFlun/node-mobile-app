# @flun/node-mobile-app

将 Node.js 项目一键打包为 Android / iOS 移动应用。运行时由 @flun/nodejs-mobile-react-native 提供，无需修改你的 Node 代码;

**核心理念**：你的的 Node 项目保持不变，CLI 负责搬运、编译、打包。所有定制集中在 `mobileAppConfig.js` 一个文件。

- GitHub：https://github.com/OpenFlun/node-mobile-app
- Gitee（国内镜像）：https://gitee.com/OpenFlun/node-mobile-app

---

## 特性

- **零侵入**：Node 项目源码、依赖、配置都不动，CLI 在独立目录里完成构建
- **自动识别服务地址**：拦截 `server.js` 里的 `listen()` 调用，动态获取真实协议和端口
- **失败可见**：5 秒内未启动、加载异常，App 显示错误页并支持展开详情（开发者可查）
- **增量构建**：文件指纹判断缓存，无变化时 10 秒级重跑
- **跨平台**：Android（Windows / macOS / Linux）+ iOS（仅 macOS）
- **离线可用**：`build` 打出的 APK / IPA 内置 JS，无需连电脑也能跑

---

## 环境要求

| 项           | 要求                                                                |
| ------------ | ------------------------------------------------------------------- |
| Node.js      | >= 18.20.4                                                          |
| Android 构建 | JDK **17**、Android SDK（minSdk 29 / targetSdk 36 / compileSdk 37） |
| iOS 构建     | macOS + Xcode + CocoaPods                                           |
| 可选         | watchman（提升 Metro 文件监听性能）                                 |

**JDK 必须是 17**，Android Gradle Plugin 目前不支持更高版本。

---

## 本包目录结构:
```txt
@flun/node-mobile-app/
│
├── bin/
│   └── cli.js                    # CLI 入口（命令分发）
│
├── cli-assets/
│   └── server.js                 # 默认 server 模板（你的项目无 server.js 时复制过去）
│
├── scripts/
│   └── copy-files.js             # postinstall 钩子：在你的项目根生成 mobileAppConfig.js
│
├── src/
│   ├── config.js                 # 配置加载 + 校验（DEFAULT_CONFIG / loadConfig / validateConfig）
│   ├── copy.js                   # 模板复制 / 你的项目复制 / ABI patch / extraRnDependencies 注入
│   ├── fingerprint.js            # 缓存指纹（判断是否需要清理构建缓存）
│   ├── generate.js               # 生成 main.js（桥接）+ mobileApp.runtime.ts（运行时配置）
│   ├── install.js                # 依赖安装 + 插件 abiFilters patch + WebView SSL patch
│   ├── patcher.js                # 应用信息 / Android / iOS 配置 patch
│   ├── platform-ios.js           # iOS 构建（pod install / xcodebuild archive / export）
│   ├── utils.js                  # 通用工具（文件操作 / 进程调用 / adb / hermesc 定位）
│   └── commands/
│       ├── test.js               # `test` 命令
│       ├── build.js              # `build` 命令
│       └── clean.js              # `clean` 命令
│
├── template/                     # RN 工程模板（运行时复制到你的项目的 node-mobile-app-build/）
│   ├── android/                  # Android 原生工程
│   ├── ios/                      # iOS 原生工程
│   ├── @types/
│   │   └── nodejs-mobile-react-native/
│   │       └── index.d.ts        # nodejs-mobile 类型声明
│   ├── App.tsx                   # RN 主界面（WebView + Node 桥接 + 错误页）
│   ├── index.js                  # RN 入口（注册根组件）
│   ├── app.json                  # RN 应用名（CLI 会覆盖）
│   ├── babel.config.js
│   ├── eslint.config.js
│   ├── metro.config.js           # Metro 配置（watchFolders / nodeModulesPaths）
│   ├── mobileApp.runtime.d.ts    # App.tsx 里 import 的类型声明（运行时由 CLI 生成 .ts）
│   ├── package.json              # RN 工程依赖清单
│   ├── .prettierrc.js
│   ├── Gemfile
│   └── .watchmanconfig          # watchman 文件监控配置（详见下方说明）
│
├── mobileAppConfig.js            # 你的配置模板（postinstall 时复制到你的项目根）
├── package.json
├── README.md                     # 本文件
├── Android构建指南.md             # Android 环境配置与踩坑清单
├── 自定义libnode指南.md           # 自编译 libnode.so 的完整流程
└── 其它略...
```

**关键约定**：
- `template/` 是**只读模板**。CLI 每次 `test`/`build` 会把它复制到你的项目的 `node-mobile-app-build/`，你的如手改模板内容会被覆盖
- 你的持久化的自定义项应写进 `mobileAppConfig.js`，或通过 `keepFiles` 保留特定模板文件
- `template/.watchmanconfig` 会在 `copyTemplate` 时复制到 `node-mobile-app-build/.watchmanconfig`，供 Metro 的 watchman 使用

### .watchmanconfig 说明

位于包根目录，配置 watchman 的文件监控行为：

```json
{
  "ignore_dirs": [
    ".git", ".vs", ".vscode", ".idea",
    "android/build", "android/app/build", "android/.gradle", "android/.cxx", "android/.kotlin",
    "ios/build", "ios/Pods",
    "node-mobile-app-build", "nodejs-assets",
    "out", "dist", "dist-apk", "coverage"
  ],
  "settle": 20
}
```

- **`ignore_dirs`**：排除的目录（构建产物、缓存、IDE 配置）。**不要排除 `node_modules`**，Metro 需要监控它来解析依赖
- **`settle`**：防抖延迟（毫秒），短时间内多次文件变更只触发一次重编
- 改完后需 `watchman watch-del-all && watchman shutdown-server` 才生效

---
## 基本配置

### 允许安装脚本执行

本包在安装时可能触发某些依赖包的自动脚本（如 `postinstall` 等）;如果你的 npm 全局配置或项目配置禁止了脚本执行（例如设置了 `ignore-scripts=true`）,可能会导致安装不完整或运行时异常;

推荐在项目根目录的 `package.json` 中添加 `allowScripts` 字段,显式放行本包及其依赖的脚本:

```json
{
  "allowScripts": {
    "@flun/nodejs-mobile-react-native": true,
    "@flun/node-mobile-app": true
  }
}
```

> 如果你信任所有安装包,也可以直接在项目 `.npmrc` 中设置 `allow-scripts = false`（表示关闭脚本拦截,所有脚本均允许执行）,或删除 `ignore-script`字段;

---

## 安装

```bash
npm i --save-dev @flun/node-mobile-app
```

安装完成后，会在你的项目根目录自动生成 `mobileAppConfig.js`（配置文件模板）;
---

## 快速开始

```bash
# 1. 编辑配置
#    打开 mobileAppConfig.js，改 appId / appName / serverPath 等

# 2. 开发调试（需连 USB，走 Metro 热更新,如需用模拟器请在 mobileAppConfig.js文件中显式配置）
npx node-mobile-app test

# 3. 打包发布
npx node-mobile-app build --release
```

---

## 命令说明

| 命令                                  | 用途                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `npx node-mobile-app test`            | 编译并安装到设备（**需连 USB**，走 Metro 热更新）                                  |
| `npx node-mobile-app test --ios`      | iOS 版（仅 macOS）                                                                 |
| `npx node-mobile-app build`           | 打 debug APK（**离线可用**）                                                       |
| `npx node-mobile-app build --release` | 打 release APK（默认用 debug keystore 签名，可安装；上架需配置 `android.signing`） |
| `npx node-mobile-app build --ios`     | 打 IPA（仅 macOS）                                                                 |
| `npx node-mobile-app clean`           | 清理构建缓存                                                                       |

### 常用选项

| 选项            | 用途                                      |
| --------------- | ----------------------------------------- |
| `--ios`         | 目标平台为 iOS（默认 Android）            |
| `--release`     | 打 release 包（仅 `build`）               |
| `--device <id>` | 指定设备（`test`）                        |
| `--arch <abi>`  | 指定 ABI，逗号分隔（`build`，仅 Android） |

### 安装 APK 到手机

`build` 打出的 APK 在 `outputDir`（默认 `./out/`）里。手动装到手机：

```powershell
# Windows PowerShell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb install -r "D:\你的项目\out\<appName>-<versionName>-debug.apk"
```

```bash
# macOS / Linux
adb install -r ./out/<appName>-<versionName>-debug.apk
```

**说明**：
- `-r` = 覆盖安装（保留应用数据）
- 不知道 APK 的确切文件名？看 `build` 命令的末尾输出（会打印完整路径）
- `adb` 找不到？在 `mobileAppConfig.js` 里配 `android.adbPath`
- `test` 命令已自动安装，无需手动

---

## 配置文件 `mobileAppConfig.js`

所有定制集中在这一个文件。**不配置也能跑**（用默认值）。

### 必填

| 字段         | 类型     | 说明                                      |
| ------------ | -------- | ----------------------------------------- |
| `serverPath` | `string` | Node 启动脚本路径（默认 `'./server.js'`） |

### 应用信息

| 字段          | 类型             | 说明                                                                       |
| ------------- | ---------------- | -------------------------------------------------------------------------- |
| `appName`     | `string \| null` | 应用显示名称（默认从 `package.json` 的 `name` 读）                         |
| `outputDir`   | `string \| null` | APK / IPA 输出目录（默认 `./out`）                                         |
| `appId`       | `string`         | 应用唯一标识，反向域名格式（Android `applicationId` / iOS Bundle ID）      |
| `versionCode` | `int`            | 内部版本号（Android `versionCode` / iOS `CFBundleVersion`）                |
| `versionName` | `string`         | 你的可见版本名（Android `versionName` / iOS `CFBundleShortVersionString`） |

### WebView

| 字段                  | 类型      | 默认                | 说明                                                                                        |
| --------------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `showLoading`         | `boolean` | `true`              | 是否显示加载指示器                                                                          |
| `loadingText`         | `string`  | `'正在启动服务...'` | 加载提示文字                                                                                |
| `enableJavaScript`    | `boolean` | `true`              | 是否启用 JavaScript                                                                         |
| `enableDomStorage`    | `boolean` | `true`              | 是否启用 DOM Storage                                                                        |
| `allowFileAccess`     | `boolean` | `true`              | 是否允许访问本地文件                                                                        |
| `mixedContentMode`    | `string`  | `'always'`          | 混合内容模式：`never` / `always` / `compatibility`                                          |
| `backgroundColor`     | 见下      | `'#ffffff'`         | WebView 背景色。支持：固定色 `'#ffffff'` / 跟随系统 `'system'` / 深浅两值 `{ light, dark }` |
| `allowSelfSignedCert` | `boolean` | `false`             | 见下文「HTTPS 自签证书」                                                                    |

### Android

| 字段                    | 类型             | 默认                 | 说明                                                                    |
| ----------------------- | ---------------- | -------------------- | ----------------------------------------------------------------------- |
| `sdkPath`               | `string \| null` | `null`               | Android SDK 路径（默认自动查找）                                        |
| `adbPath`               | `string \| null` | `null`               | adb 路径（默认自动查找）                                                |
| `minSdkVersion`         | `int`            | `29`                 | 最低 SDK（29=Android 10.0）                                             |
| `targetSdkVersion`      | `int`            | `36`                 | 目标 SDK                                                                |
| `compileSdkVersion`     | `int`            | `37`                 | 编译 SDK                                                                |
| `buildToolsVersion`     | `string`         | `'37.0.0'`           | 构建工具版本                                                            |
| `abiFilters`            | `string[]`       | `['arm64-v8a']`      | 打包架构（真机 `arm64-v8a`，模拟器加 `x86_64`）                         |
| `icon`                  | `string`         | `'./build/icon.png'` | 应用图标（建议 512×512 PNG）                                            |
| `usesCleartextTraffic`  | `boolean`        | `true`               | 是否允许明文 HTTP                                                       |
| `permissions`           | `string[]`       | `[]`                 | 额外权限（如 `'android.permission.CAMERA'`）                            |
| `signing.keystore`      | `string`         | —                    | 签名 keystore 路径（相对你的项目根）。不填则用模板自带的 debug keystore |
| `signing.storePassword` | `string`         | —                    | keystore 密码                                                           |
| `signing.keyAlias`      | `string`         | —                    | key 别名                                                                |
| `signing.keyPassword`   | `string`         | —                    | key 密码                                                                |

### iOS

| 字段                          | 类型     | 默认                 | 说明                                                   |
| ----------------------------- | -------- | -------------------- | ------------------------------------------------------ |
| `deploymentTarget`            | `string` | `'15.1'`             | 最低 iOS 版本                                          |
| `icon`                        | `string` | `'./build/icon.png'` | 应用图标（建议 1024×1024 PNG）                         |
| `signing.teamId`              | `string` | —                    | Apple Developer Team ID                                |
| `signing.provisioningProfile` | `string` | —                    | 描述文件路径（写入 `exportOptions.plist`）             |
| `signing.certificate`         | `string` | —                    | P12 证书路径（导入临时 keychain 供 xcodebuild 签名用） |
| `signing.certificatePassword` | `string` | —                    | P12 密码                                               |

### 高级

| 字段                         | 类型      | 默认   | 说明                       |
| ---------------------------- | --------- | ------ | -------------------------- |
| `advanced.keepAlive`         | `boolean` | `true` | 是否发送心跳保持 Node 进程 |
| `advanced.heartbeatInterval` | `int`     | `5000` | 心跳间隔（毫秒）           |

### 扩展点

| 字段                  | 类型       | 默认 | 说明                                                  |
| --------------------- | ---------- | ---- | ----------------------------------------------------- |
| `keepFiles`           | `string[]` | `[]` | 不重置的模板文件（路径相对 `node-mobile-app-build/`） |
| `extraRnDependencies` | `string[]` | `[]` | 额外 RN 原生依赖包名（需先安装在你的开发字段中）      |

### 排除 / 白名单

| 字段           | 说明                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| `excludeFiles` | 复制到 build 目录时跳过的文件/目录（支持 `*.log`、`build/` 等）              |
| `allowScripts` | 移动端 Node 环境里允许跑安装脚本的包（会写入 `nodejs-project/package.json`） |

---

## 服务地址说明

CLI **自动识别 `server.js` 实际监听的协议和端口**——拦截 `net.Server.prototype.listen`，从 `server.address()` 取真实端口，从 `Server` 类型判断 `http` / `https`。

因此 `mobileAppConfig.js` **不需要**配置端口/协议。动态端口（`listen(0)`）会拿到系统分配的真实端口。

**失败场景**：
- `server.js` 加载抛异常 → App 显示"应用启动失败"
- 5 秒内未调用 `listen()` → App 显示"应用启动失败"

你的看到简要提示，开发者点开"▶ 查看详细信息"能看到具体原因。

---

## HTTPS 自签证书

`webview.allowSelfSignedCert` 控制是否放行**不受信任的 HTTPS 证书**：

| 场景                                          | 是否受开关影响      |
| --------------------------------------------- | ------------------- |
| HTTP                                          | 无关                |
| HTTPS + 真证书（Let's Encrypt 等）            | 无关                |
| HTTPS + 自签证书 + 已装进设备信任库           | 无关                |
| HTTPS + 自签证书 + 未装设备（本地测试最常见） | **必须设为 `true`** |

**实现方式**：
- Android：patch `RNCWebViewClient.java`，仅对 `127.0.0.1` / `localhost` 放行
- iOS：patch `RNCWebViewImpl.m`，同上

其他域名仍严格校验。生产环境建议关闭。

---

## Android / iOS 差异

| 项           | Android                           | iOS                                                    |
| ------------ | --------------------------------- | ------------------------------------------------------ |
| 构建环境     | Windows / macOS / Linux           | **仅 macOS**                                           |
| Node.js 版本 | v18（官方）/ v22+（自编译）       | **v18**（官方；v22 需自编译 `NodeMobile.xcframework`） |
| Express 版本 | v18 用 4.x，v22 + full-icu 用 5.x | **v18 必须用 4.x**                                     |
| `test` 离线  | ✓（内置 bundle）                  | ✓（需 `FORCE_BUNDLING=1`）                             |
| 图标尺寸     | 5 个密度（48~192）                | 9 个尺寸（40~1024）                                    |

**iOS Node 版本限制**：`nodejs-mobile` 官方为 iOS 提供的二进制停留在 v18。v22 需自行编译 `NodeMobile.xcframework`，流程与 Android 自编译 `libnode.so` 类似（见 `自定义libnode指南.md`）。

---

## 你的项目结构

运行 CLI 后，你的项目根目录的样子：

```
你的项目/
├── package.json              # 你自己的
├── mobileAppConfig.js        # CLI 生成的配置（可编辑）
├── server.js                 # Node 启动脚本（你写的，或 CLI 生成的示例）
├── node_modules/             # 你的依赖
├── build/                    # 你的资源（图标、keystore 等）
│   ├── icon.png
│   └── release.keystore
│── 你的其它文件/目录...
└── node-mobile-app-build/    # CLI 生成的 RN 工程（可整体删除重建）
    ├── android/  ios/  App.tsx  index.js  ...
    ├── mobileApp.runtime.ts  # CLI 生成，App.tsx 读
    └── nodejs-assets/
        └── nodejs-project/   # 你的 Node 项目副本
            ├── server.js     # 你的源码
            ├── main.js       # CLI 生成，桥接代码
            ├── package.json  # 只保留 dependencies
            └── node_modules/ # 你的生产依赖
```

---

## 常见问题

### Q：`test` 拔掉 USB 后 App 加载慢？

`test` 打的是 debug 版，启动时**先尝试连 Metro**，失败后才 fallback 到内置 bundle。这个"等超时"是 RN debug 版的固有行为。

- 需要**秒开**：用 `npx node-mobile-app build`
- 需要**热更新**：`test` 保持 USB 连接

### Q：`test` 装到手机后拔 USB 就崩？

前提是 APK 里有内置 bundle。`test` 每次都会先 `react-native bundle` 打进 APK。**如果崩，检查 CLI 输出里 `[6/9] 生成 JS bundle` 是否成功**。

### Q：Node 进程启动失败怎么排查？

App 显示"应用启动失败"页 → 点"▶ 查看详细信息" → 看到具体原因（如 `加载 ./server.js 失败 -- ...`）。

进一步用 `adb logcat` 看 Node 日志：

```bash
adb logcat -c
adb shell am force-stop <你的 appId>
adb shell am start -n <你的 appId>/.MainActivity
adb logcat | grep -E "NODEJS-MOBILE|ReactNativeJS"
```

### Q：`npm install` 时提示 `install-scripts not yet covered by allowScripts`？
- 请检查 你的 'package.json' 中 "allowScripts" 字段


### Q：Express 版本怎么选？

- **`libnode.so` 不带 full-icu（官方 v18）** → **必须用 Express 4**（如 `4.22.2`）
- **`libnode.so` 带 full-icu（自编译 v22）** → 可以用 Express 5（如 `5.2.1`）

Express 5 的路由语法与 4 不同（如 `app.get('*')` 要改成 `app.get('/{*splat}')`），迁移时留意。

### Q：`libnode.so` 和 `NodeMobile.xcframework` 是怎么来的？

从 `@flun/nodejs-mobile-react-native` 1.0.1 起，两套预编译二进制**不在 npm 包里**，改为 postinstall 阶段自动从 Gitee / GitHub Release 下载：

| 资源                             | 大小     | 目标位置                                                                    |
| -------------------------------- | -------- | --------------------------------------------------------------------------- |
| `android-libnode.zip`            | 约 52 MB | `node_modules/@flun/nodejs-mobile-react-native/android/libnode/`            |
| `ios-nodemobile.zip`（仅 macOS） | 约 47 MB | `node_modules/@flun/nodejs-mobile-react-native/ios/NodeMobile.xcframework/` |

- 默认下载 v18.20.4 官方二进制
- Gitee 优先，失败自动回退 GitHub
- 已装版本匹配则跳过，不重复下
- 全部源失败时打印下载链接，**不中断 npm 安装**

环境变量：

```bash
NODE_MOBILE_PREBUILT_VERSION=v22.23.2   # 覆盖默认版本
NODE_MOBILE_PREBUILT_SKIP=1             # 跳过全部下载
NODE_MOBILE_PREBUILT_IOS_SKIP=1         # 只跳过 iOS
```

### Q：如何替换成自定义编译的 `libnode.so`？

如果你自编译了带 full-icu 的 v22（或其它版本）`libnode.so`，可手动覆盖自动下载的产物：

1. 把编译好的 `libnode.so` 覆盖到 `android/libnode/bin/<架构>/`（**只放你实际编译的架构**）
2. 如果 `mobileAppConfig.js` 的 `android.abiFilters` 与 libnode 支持的架构不一致，同步调整
3. 跑 `npx node-mobile-app build` 或 `npx node-mobile-app test`

**CLI 会自动处理缓存**：指纹机制检测到 `libnode.so` 或 `abiFilters` 变化，自动清理 `.cxx` / `android/build` / `app/build`，全量重编。**你的无需手动清任何缓存**。

详细流程（自编译 v22 + full-icu）见 `自定义libnode指南.md`。

### Q：iOS 提示 `fallbackSourceURL does not override`？

RN 0.87 的 API 若变动，`AppDelegate.swift` 里的 fallback 可能不生效——不影响"连 Mac + Metro"正常开发，只是拔 Mac 后无法 fallback 到内置 bundle。届时反馈，我们更新适配。

---

## 相关文档

- [Android 构建指南.md](./Android%20构建指南.md) —— Android 环境配置、踩坑清单
- [自定义libnode指南.md](./自定义libnode指南.md) —— 自编译 v22 `libnode.so` 的完整流程

---

## 许可

ISC
