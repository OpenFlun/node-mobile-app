# 变更日志
## [2.0.6] - 2026-09-28 14:57
### 更新
- 更新 `@flun/nodejs-mobile-react-native` 依赖;

## [2.0.5] - 2026-09-28 11:50
### 优化
优化了部分细节;

## [2.0.4] - 2026-09-27 21:50
### 更新
- 依赖包 '@flun/nodejs-mobile-react-native' 更新为 v2.0.2;
- 优化了 'README.md' 和 'server.js' 一些细节;

## [2.0.3] - 2026-09-25 21:33
### 修复

- **`template/metro.config.js` 排除配置更新**：原来的 `blacklistRE` 在 Metro 0.86+ 已完全移除，`metro-config/src/defaults/exclusionList.js` 的深层导入路径在 Metro 0.83 起也不再暴露，会导致新版本 RN 项目加载 Metro 配置失败。改为：
  - `blacklistRE` -> `blockList`
  - 导入路径改为 `metro-config/private/defaults/exclusionList`（不带 `.js` 后缀，经 `.default` 取值）
  - 正则改为 `/[/\\]nodejs-assets[/\\].*/` 形式，避免字符串转义在跨平台下出错

### 更新
- 更新 `@flun/nodejs-mobile-react-native` 依赖;

---
## [2.0.2] - 2026-09-23 20:25

### 修复

- **`syncTemplateDependencies` 计数不准确**：`src/copy.js` 里 `_comment` 字段的移除被一并计入 `updated`，导致日志里打印的"已同步 N 个依赖版本"比实际多 1。拆分为 `depsUpdated`（仅统计真正变化的依赖）和 `needWrite`（是否需要写文件），`_comment` 仍会被移除，但不再计入。

---

## [2.0.1] - 2026-09-23 19:53
### 更新
- 升级了有bug的 `@flun/nodejs-mobile-react-native` v1.0.1版本到v1.0.3

## [2.0.0] - 2026-09-23 16:30

> **这是一次 major 版本升级**。用户 API 未变，但底层依赖被整体替换，风险等级和官方 CJS 版本不是一个量级。

### 重大变更（Breaking）

- **更换底层 runtime**：`nodejs-mobile-react-native` → **`@flun/nodejs-mobile-react-native`**（flun fork）
  - 内部全量 ESM 化
  - `rn-bridge` 保持 CJS（改为 `index.cjs`），兼容 CJS / ESM 项目
  - 依赖升级：`tar@^6` → `^7`、`glob@^10` → `^13`、`make-fetch-happen@^13` → `^16`
  - 删除 `xcode` 依赖（RN 0.60 autolinking 前的遗留）
  - `react-native` peer 标为 optional，避免重复安装
- **更换原生模块编译工具**：`nodejs-mobile-gyp` → **`@flun/nodejs-mobile-gyp`**（flun fork）
  - 上游停更、依赖 `tar@6` / `glob@10` 触发 deprecated 与安全审计警告
  - fork 后升级 `tar@^7`、`glob@^13`、`make-fetch-happen@^16`，0 vulnerabilities
  - 支持 **Visual Studio 2026**（版本号 18，toolset `v145`）
  - 强制走 **MSVC** 工具集（不再使用 ClangCL），关闭 LTO
    - 避免 `MSB8020: 无法找到 ClangCL 的生成工具`
    - 避免 `LNK1117: 选项"opt:lldltojobs=2"中的语法错误`

### 用户影响

**无需修改任何配置或代码**。`mobileAppConfig.js` 格式、`npx node-mobile-app test / build` 命令、生成的 APK 行为均不变。

但底层 runtime 换了维护主体，若升级后遇到问题，请优先在 `@flun/node-mobile-app` 仓库反馈。

### 新增

- **模板依赖版本自动同步**：`template/package.json` 里声明的依赖版本，由 CLI 在 `copyTemplate` 阶段自动从主包 `package.json` 的 `dependencies` 同步。
  - 单一数据源：升级依赖只需改主包一处，模板自动跟上
  - 缺声明会报错：模板里声明但主包未声明的依赖，构建时直接抛错中断，避免模板里的 `"*"` 占位值被误用
  - 实现：`src/copy.js` 新增 `syncTemplateDependencies(pkgRoot, buildDir)`
- **原生模块自动检测**：CLI 自动判断用户项目依赖里是否含原生模块（带 `binding.gyp` 的包，如 `bcrypt`、`sqlite3`），决定是否编译原生代码。
  - 移除配置字段 `android.buildNativeModules`——用户无需手动配置
  - 检测范围：用户根 `package.json` 的 `dependencies` 里，逐个查 `userProjectDir/node_modules/<name>/binding.gyp`
  - 检测结果纳入依赖哈希：装/卸原生模块自动触发重装重编
  - 新增环境变量 `NODE_MOBILE_FORCE_REBUILD=1`：特殊场景（如换了 `libnode.so` 但依赖未变）下强制重装重编
  - 平台限制：Windows 上 nodejs-mobile 无法编译原生模块（上游限制），此功能仅 Linux / macOS 可用
  - 实现：`src/install.js` 的 `hasNativeModules`、`installUserDeps`、`hashDeps`

### 修复

- **主包 `main.js` 生成逻辑适配 rn-bridge**：`generate.js` 生成的 `main.js` 改用 `require('rn-bridge')`（配合 rn-bridge 的 `.cjs`），避免 `await import` 绕过 native binding 的 CJS loader 路径导致崩溃
- **`@flun/nodejs-mobile-react-native` 插件路径适配**：`src/install.js`、`src/fingerprint.js`、`src/commands/clean.js` 中对插件目录的探测，从 `node_modules/nodejs-mobile-react-native` 改为 `node_modules/@flun/nodejs-mobile-react-native`
- **模板依赖清理**：
  - 删除 `template/package.json` 里冗余的 `react-native-safe-area-context`（模板代码零引用）
  - 删除 `template/@types/nodejs-mobile-react-native/`（源包 `index.d.ts` 已覆盖，且 `package.json` 加了 `types` 字段指向它）
  - 修正 `template/package.json` 里 `@flun/nodejs-mobile-react-native` 的版本号（旧值 `^18.20.4-flun.1` 在 npm 上不存在）

### 依赖调整

- `dependencies` 里的 `nodejs-mobile-react-native` 换成 `@flun/nodejs-mobile-react-native: ^1.0.1`
- 该 fork 内部再依赖 `@flun/nodejs-mobile-gyp: ^1.0.1`
- 依赖树彻底干净，`npm ls tar glob uuid` 无停更包，0 vulnerabilities

### 验证

- Windows + VS2026 BuildTools + Python 3.14 + Node 26.8.1 环境下：
  - `npx node-mobile-app test` 全链路通过（Gradle 编译 + 部署到真机 + Metro 热更新）
  - `npx node-mobile-app build` / `build --release` 生成 APK 正常
  - App 启动正常，Node 服务正常监听端口
  - 模板依赖版本自动同步经独立测试验证（改假版本号 → CLI 覆盖为真实版本）
- iOS：保留对 Node 18 的支持（未在 macOS 上实测）
### 文档同步

**预编译二进制改为自动下载**相关的文档改动：

- `README.md`：
  - 新增 Q 段落「`libnode.so` 和 `NodeMobile.xcframework` 是怎么来的？」，说明 postinstall 自动下载机制、环境变量、失败处理
  - 原「如何替换自定义的 `libnode.so`？」改为「如何替换成自定义编译的 `libnode.so`？」，明确适用于自编译 v22+ 场景
- `Android 构建指南.md`：
  - 新增 2.0 章节「预编译二进制怎么来的」
  - 2.1 标题从「默认随包带」改为「默认自动下载」
- `自定义libnode指南.md`：
  - 章节二开头加提示：默认 v18 由 postinstall 自动下载，本节仅服务 v22+ 自编译场景
- **清理 `nodejs-assets/` 相关说明**：`@flun/nodejs-mobile-react-native` 1.0.1 起，宿主项目依赖 `@flun/node-mobile-app` 时不再复制 `nodejs-assets/`，因此：
  - `README.md`：删除项目根目录树里的 `nodejs-assets/`、删除「两个 nodejs-assets 的区别」整段、删除 Q 段落「nodejs-assets 一直出现在你的项目根」
  - `mobileAppConfig.js`：`excludeFiles` 里 `nodejs-assets/` 的注释改为「旧版插件残留；防止误打包」
- **原生模块自动检测**相关的文档改动：
  - `README.md`：删除配置字段表里的 `buildNativeModules` 行
  - `Android 构建指南.md`：1.4 章节从「原生模块编译开关（Windows）」改为「原生模块编译（自动检测）」，说明自动识别 `binding.gyp`、`NODE_MOBILE_FORCE_REBUILD` 手动强制、Windows 平台限制
  - `自定义libnode指南.md`：2.6 章节从「重编原生模块（仅当用到 `bcrypt` 等）」改为「重编原生模块（仅当项目含原生模块）」，说明默认自动处理、手动触发方式；迁移清单与常见坑表格同步

背景：`@flun/nodejs-mobile-react-native` 1.0.1 起，`android-libnode.zip`（约 52 MB）与 `ios-nodemobile.zip`（约 47 MB）不再随 npm 包分发，改为 postinstall 阶段从 Gitee / GitHub Release 自动拉取。npm tarball 从 107 MB 降到 1.2 MB。

---

## [1.0.2] - 2026-09-21 08:24

### 修复
- **依赖树瘦身**：删除主包里未使用的 6 个依赖（`@babel/preset-env`、`@babel/runtime`、`@react-native/jest-preset`、`@react-native/new-app-screen`、`@react-native/typescript-config`、`react-native-safe-area-context`），安装体积与安装耗时下降
- **消除旧依赖链**：移除 `@react-native/eslint-config`，改为内置自写 ESLint flat config（`src/utils.js` 的 `buildEslintConfigSource()`，构建时覆写到 `node-mobile-app-build/eslint.config.js`）。随之消失的旧包：`inflight@1.0.6`、`rimraf@3.0.2`、`glob@7.2.3`、`@humanwhocodes/config-array`、`@humanwhocodes/object-schema`
- **ESLint 升级到 9**：统一使用 `eslint@^9`，不再出现 eslint 8 / 9 两份并存
- **模板 lint 清理**：修复 `template/App.tsx` 中逗号表达式触发的 `@typescript-eslint/no-unused-expressions` 报错，模板现在默认 `npx eslint` 零 error 零 warning

### 文档
- `mobileAppConfig.js` 与 `README.md` 更正签名说明：`build --release` **不配置 `android.signing` 也能出包**，默认沿用模板自带的 debug keystore 签名（可安装、可本地测试，不可上架）；需要上架时再填 `keystore` / `storePassword` / `keyAlias` / `keyPassword`

## [1.0.1] - 2026-09-20 11:52
### 首发
- 发布将 Node.js 项目一键打包为 Android / iOS 移动应用（基于 nodejs-mobile-react-native）;