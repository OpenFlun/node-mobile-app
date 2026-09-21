# Android 构建指南

本文档是 [README.md](./README.md) 的**深度附件**。日常使用（`test` / `build`）不需要看——CLI 自动处理。

本文档只讲四件事，都是 README 没细说的：
1. **环境准备**（JDK / SDK / NDK / adb / 原生模块编译）
2. **libnode.so**（v18 vs v22、预编译仓库、替换、full-icu 验证）
3. **Express 版本选择**（踩坑清单）
4. **调试与缓存排查**（logcat 命令、手动清缓存兜底）

---

## 一、环境准备

### 1.1 JDK 17（必须）

Android Gradle Plugin 不支持 JDK 18+。

下载：[Adoptium JDK 17](https://adoptium.net/temurin/releases/?version=17)

**CLI 不读 `JAVA_HOME`**，直接用系统 PATH 里的 `java`。确保 `java -version` 输出是 17。

### 1.2 Android SDK

CLI 自动查找，顺序：

1. `mobileAppConfig.js` 的 `android.sdkPath`
2. 环境变量 `ANDROID_HOME` / `ANDROID_SDK_ROOT`
3. 常见默认路径（Windows：`%LOCALAPPDATA%\Android\Sdk`）

**必需组件**：

| 组件           | 版本                                 |
| -------------- | ------------------------------------ |
| SDK Platform   | 36                                   |
| Build-Tools    | 37.0.0                               |
| Platform-Tools | 最新（含 adb）                       |
| NDK            | 27.1.12297006（libnode.so 编译依赖） |

### 1.3 adb

查找顺序同 SDK。常用命令：

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
```

### 1.4 原生模块编译开关（Windows）

`nodejs-mobile-react-native` 在 Windows 上无法编译原生模块。CLI 首次运行时自动写：

```
<buildDir>/nodejs-assets/BUILD_NATIVE_MODULES.txt   # 内容: 0
```

**例外场景**：用了 v22 的 `libnode.so`，且需要重编原生模块（如 `bcrypt`）。

1. `mobileAppConfig.js` 里设 `android.buildNativeModules: true`
2. 跑 `npx node-mobile-app test`（CLI 写 `1` 并设环境变量 `NODEJS_MOBILE_BUILD_NATIVE_MODULES=1`）
3. 编完后改回 `false`

---

## 二、libnode.so

`nodejs-mobile-react-native` 用它提供 Node.js 运行时。**是否带 full-icu** 决定能跑哪个 Express 版本。

### 2.1 官方 v18（默认随包带）

路径：

```
<你的项目>/node_modules/nodejs-mobile-react-native/android/libnode/bin/<架构>/libnode.so
```

| 架构        | 大小    |
| ----------- | ------- |
| arm64-v8a   | 59.6 MB |
| armeabi-v7a | 56 MB   |
| x86_64      | 62.3 MB |

**特点**：`--with-intl=none`，**不含 ICU**。

- 不能用 `\p{...}` / `\P{...}` Unicode 正则
- **必须 Express 4**

### 2.2 自编译 v22+（推荐）

**官方 v18 已停更**。要跑 Express 5 或新语法，需替换。

**预编译产物仓库**：

- GitHub：https://github.com/OpenFlun/nodejs-mobile
- Gitee（国内）：https://gitee.com/OpenFlun/nodejs-mobile

**当前 Android 支持情况**：

| 架构        | v18 | v22 |
| ----------- | --- | --- |
| arm64-v8a   | ✓   | ✓   |
| x86_64      | ✓   | ✓   |
| armeabi-v7a | ✓   | ✗   |

**未来计划**：v24、v26 逐步适配。

**替换步骤**：

1. 下载 `libnode.zip`（含 `bin/` + `include/`）
2. **整体替换** `你的项目/node_modules/nodejs-mobile-react-native/android/libnode/`
3. `mobileAppConfig.js` 的 `android.abiFilters` 只写实际存在的架构（v22 是 `['arm64-v8a', 'x86_64']`）
4. 跑 `npx node-mobile-app test` 或 `build`

CLI 指纹机制会自动清 `.cxx` / `android/build` / `app/build` 并全量重编——**无需手动清缓存**。

**完整自编译流程**见 `自定义libnode指南.md`。

### 2.3 验证是否带 full-icu

```bash
# Linux / macOS / WSL / Git Bash
strings libnode.so | grep -c icudt78l
```

- 输出几千（约 4300）→ 带 full-icu
- 输出 0 → 不带

**体积对照**（实测，strip 后）：

| 版本                    | arm64-v8a | x86_64   |
| ----------------------- | --------- | -------- |
| v18（官方，无 ICU）     | 59.6 MB   | 62.3 MB  |
| v22（自编译，full-icu） | 112.4 MB  | 117.2 MB |

体积差异约 50 MB，来自三部分：Node v22 核心引擎 + full-icu 数据（约 25–30 MB）+ V8 版本升级。**不是编译出错**。

---

## 三、Express 版本选择（踩坑清单）

**选错版本会在 Node 进程启动时崩溃**，且错误信息极具误导性（如 `number 116 is not a function`）。

### 3.1 版本对照

| libnode.so            | Node.js | ICU | Express                |
| --------------------- | ------- | --- | ---------------------- |
| 官方 v18              | v18     | 无  | **4.x**（如 `4.22.2`） |
| 自编译 v22 + full-icu | v22     | 有  | **5.x**（如 `5.2.1`）  |

### 3.2 场景 A（v18 + Express 4）

`nodejs-project/package.json`：

```json
{
  "dependencies": {
    "express": "4.22.2"
  }
}
```

依赖里如有 `\P{ASCII}` 等 Unicode 正则，改写成 ASCII 等价：

| 原写法      | ASCII 写法     |
| ----------- | -------------- |
| `\P{ASCII}` | `[^\x00-\x7F]` |

### 3.3 场景 B（v22 + full-icu + Express 5）

```json
{
  "dependencies": {
    "express": "5.2.1"
  }
}
```

**三个前提**：

1. `libnode.so` 确实带 full-icu（用 `strings` 验证过）
2. **不要**用 `@alloc/path-to-regexp` 替换原版——它的 `exports` 只有 `import` 条件，CJS 下 `require()` 报 `No "exports" main defined`
3. **不要**加任何 `overrides` 强制替换 `path-to-regexp`

### 3.4 Express 5 路由语法迁移

`app.get('*')` 会抛 `TypeError: Missing parameter name`：

| Express 4                    | Express 5                         |
| ---------------------------- | --------------------------------- |
| `app.get('*', handler)`      | `app.get('/{*splat}', handler)`   |
| `app.get('/:id?', handler)`  | `app.get('/user{/:id}', handler)` |
| `app.get('/:id(\\d+)', ...)` | 中间件校验 `req.params.id`        |
| `app.del('/x', handler)`     | `app.delete('/x', handler)`       |
| `res.json(obj, 200)`         | `res.status(200).json(obj)`       |
| `res.send(200, body)`        | `res.status(200).send(body)`      |

### 3.5 验证依赖树

```powershell
cd node-mobile-app-build\nodejs-assets\nodejs-project
npm ls express --all
npm ls path-to-regexp --all
```

**期望（场景 B）**：

```
express@5.2.1
└─┬ router@2.2.0
  └── path-to-regexp@8.4.2
```

如出现 `@alloc/path-to-regexp`，说明 `package-lock.json` 里有残留 `overrides`。**彻底清理**：

```powershell
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

### 3.6 三个常见误区

- **误区 1**：以为 `@alloc/path-to-regexp` 能解决 ESM 问题 → 它的 `exports` 也是纯 `import`，`require()` 依然失败
- **误区 2**：只改路由语法就想让 Express 5 跑 → 若 `libnode.so` 无 full-icu，加载 `path-to-regexp@8` 时仍崩
- **误区 3**：用 `overrides` 强制替换 `path-to-regexp` → 破坏依赖链，且 `package-lock.json` 会残留解析结果，删掉 `overrides` 也不生效

---

## 四、调试与缓存排查

### 4.1 抓 Node.js 日志

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

# 清空
& $adb logcat -c

# 重启 App
& $adb shell am force-stop com.me.myapp
& $adb shell am start -n com.me.myapp/.MainActivity

# 抓关键日志
& $adb logcat -d | Select-String 'NODEJS-MOBILE|ReactNativeJS'
```

**正常日志**：
```
NODEJS-MOBILE: [node-mobile-app] server URL: http://127.0.0.1:3000
NODEJS-MOBILE: Express started on port 3000
ReactNativeJS: Node started on http://127.0.0.1:3000
```

**失败日志**：
```
NODEJS-MOBILE: [node-mobile-app] failed: Node 服务 5 秒内未启动 -- 请检查 ./server.js 是否调用了 listen()
```

**崩溃日志**：

```powershell
& $adb logcat -c
& $adb logcat | Select-String 'FATAL|AndroidRuntime|NODEJS-MOBILE'
```

### 4.2 手动清缓存（兜底）

**正常情况不需要**——CLI 指纹机制自动清。以下仅当指纹判断失效（如手动改过 `node-mobile-app-build/` 内文件）时用：

```powershell
# 最彻底：删整个 RN 工程
Remove-Item -Recurse -Force D:\你的项目\node-mobile-app-build

# 或删插件 CMake 缓存
Remove-Item -Recurse -Force D:\你的项目\node_modules\nodejs-mobile-react-native\android\.cxx
Remove-Item -Recurse -Force D:\你的项目\node_modules\nodejs-mobile-react-native\android\build

# 或删指纹文件（下次跑 = 首次构建）
Remove-Item -Force D:\你的项目\node-mobile-app-build\.build-fingerprint.json
```

或直接：

```powershell
npx node-mobile-app clean
```

### 4.3 手动端口转发（`test` 会自动做）

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8081 tcp:8081
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse --list
```

### 4.4 模拟器（x86_64）

```powershell
# 列出 AVD
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds

# 启动
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7_API_34
```

**三个必须**：
- `mobileAppConfig.js` 的 `abiFilters` 含 `x86_64`
- `libnode/bin/x86_64/libnode.so` 存在
- 模拟器镜像是 **x86_64 架构**

---

## 相关文档

- [README.md](./README.md) —— 快速开始、配置字段、命令
- [自定义libnode指南.md](./自定义libnode指南.md) —— 自编译 v22 + full-icu 完整流程
- [libnode.so 预编译仓库](https://github.com/OpenFlun/nodejs-mobile)（[Gitee](https://gitee.com/OpenFlun/nodejs-mobile)）
