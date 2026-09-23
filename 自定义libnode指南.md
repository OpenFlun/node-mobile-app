# 自定义 libnode.so 指南（Android）

本文档讲两件事：

1. **用预编译产物**（推荐，90% 用户）—— 从仓库下载 `android-libnode.zip`，替换，跑 CLI，完事
2. **自己编译**（进阶）—— 用 WSL + NDK 从源码编译带 full-icu 的 v22+

**使用 `@flun/node-mobile-app` 时不需要看这份文档就能打包**——CLI 会自动处理 ABI 配置、缓存清理、原生模块编译。本文档只在**要换 libnode.so** 时才需要。

---

## 一、自定义 libnode.so

`@flun/node-mobile-app` 默认带的是官方 `nodejs-mobile` 的 **v18** 二进制。v18 的限制：

| 限制                           | 影响                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `--with-intl=none`（不带 ICU） | 不能用 `\p{...}` / `\P{...}` Unicode 正则                |
| 无法用 Express 5               | `path-to-regexp@8` 内部用 `\p{ID_Start}`，v18 加载时崩溃 |
| 停更                           | 官方不再更新                                             |

**要跑 Express 5 / 用新特性 / 用完整 Unicode 正则**，需替换为 **v22+ full-icu**。

---

## 二、用预编译产物（推荐）

> **注意**：从 `@flun/nodejs-mobile-react-native` 1.0.1 起，Android 的 `libnode.so` 由 postinstall 脚本从 Release 自动下载（默认 v18.20.4）。
> **本节适用于**：要把自动下载的 v18 换成 **v22+ 自编译版本**（带 full-icu，能跑 Express 5）的场景。
> 若只是用默认 v18，你**不需要**看本节——装包后 `libnode.so` 已就位。


### 2.1 下载地址

**最新版本**：v22.23.2（2026-09-12 发布）

| 平台          | 源码仓库                                                            | Release 页面                                                   | 直链下载                                                                                                        |
| ------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GitHub        | [OpenFlun/nodejs-mobile](https://github.com/OpenFlun/nodejs-mobile) | [Releases](https://github.com/OpenFlun/nodejs-mobile/releases) | [android-libnode.zip](https://github.com/OpenFlun/nodejs-mobile/releases/download/v22.23.2/android-libnode.zip) |
| Gitee（国内） | [OpenFlun/nodejs-mobile](https://gitee.com/OpenFlun/nodejs-mobile)  | [Releases](https://gitee.com/OpenFlun/nodejs-mobile/releases)  | [android-libnode.zip](https://gitee.com/OpenFlun/nodejs-mobile/releases/download/v22.23.2/android-libnode.zip)  |

**文件名说明**：发布名为 `android-libnode.zip`（带 `android-` 前缀），为未来 iOS 等平台扩展预留接口（如 `ios-libnode.zip`）。**内容仍是标准的 `libnode/` 目录**（`bin/` + `include/`）。

### 2.2 支持矩阵

| 架构                         | v18    | v22      | v24  | v26  |
| ---------------------------- | ------ | -------- | ---- | ---- |
| **arm64-v8a**（真机）        | ✓ 官方 | ✓ 预编译 | 计划 | 计划 |
| **x86_64**（模拟器）         | ✓ 官方 | ✓ 预编译 | 计划 | 计划 |
| **armeabi-v7a**（32 位 ARM） | ✓ 官方 | ✗        | ✗    | ✗    |

**当前 v22 下载入口**：
- 双架构（推荐）：`android-libnode.zip`（约 88 MB）
- 单架构 zip 已废弃，不再发布

**armeabi-v7a 为什么放弃**：V8 v22 在 x64 主机上无法交叉编译 32 位 ARM 目标（详见 5.1）。

### 2.3 下载与替换

**解压后的结构**：

```
libnode/
├── bin/
│   ├── arm64-v8a/libnode.so      # 真机（约 113 MB）
│   └── x86_64/libnode.so         # 模拟器（约 118 MB）
└── include/
    └── node/                     # 官方 v22 headers（含 ABI 适配）
```

**替换到你的项目**：

```bash
# 进入插件的 android 目录
cd <你的项目>/node_modules/@flun/nodejs-mobile-react-native/android

# 备份官方 v18（可选，方便回退）
cp -r libnode libnode.bak-v18

# 整体替换
rm -rf libnode
unzip /path/to/android-libnode.zip -d /tmp
mv /tmp/libnode ./libnode
```

**Windows 下用 PowerShell**：

```powershell
$plugin = '<你的项目>\node_modules\@flun\nodejs-mobile-react-native\android'

# 备份
Copy-Item -Recurse "$plugin\libnode" "$plugin\libnode.bak-v18"

# 替换
Remove-Item -Recurse -Force "$plugin\libnode"
Expand-Archive -Path 'D:\path\to\android-libnode.zip' -DestinationPath "$env:TEMP\libnode-new" -Force
Move-Item "$env:TEMP\libnode-new\libnode" "$plugin\libnode"
```

### 2.4 调整 ABI 配置

**如果下载的 `android-libnode.zip` 只含一个架构**（比如只编了 arm64-v8a），在 `mobileAppConfig.js` 里同步：

```js
android: {
  abiFilters: ['arm64-v8a'],       // 只放实际存在的架构
}
```

**如果双架构**（arm64-v8a + x86_64，当前预编译产物即为双架构）：

```js
android: {
  abiFilters: ['arm64-v8a', 'x86_64'],
}
```

### 2.5 跑 CLI（自动完成所有适配）

```bash
npx node-mobile-app test      # 开发调试
# 或
npx node-mobile-app build     # 打包 APK
```

**CLI 会自动**：

| CLI 动作                                                        | 说明                         |
| --------------------------------------------------------------- | ---------------------------- |
| 检测 `libnode.so` 变化                                          | 指纹比对 size / mtime        |
| 清 `.cxx` / `android/build` / `app/build`                       | 避免旧架构的 CMake 中间产物  |
| Patch `app/build.gradle` 的 `ndk.abiFilters`                    | 用 `mobileAppConfig.js` 的值 |
| Patch `android/gradle.properties` 的 `reactNativeArchitectures` | 同步 ABI 列表                |
| Patch 插件 `build.gradle` 的 `abiFilters`                       | 让插件只编指定架构           |
| 重编原生模块（自动检测 `binding.gyp`）                         | 见 2.6                       |

**你不需要手动清任何缓存。**

### 2.6 重编原生模块（仅当项目含原生模块）

Node v18 → v22 后，ABI 变了（`NODE_MODULE_VERSION` 从 108 → 127）。**如果项目里装了带 C++ 代码的 npm 包**（如 `bcrypt`、`sqlite3`、`sharp`），换 v22 的 `libnode.so` 后需要重编才能兼容。

**默认自动处理**：CLI 会扫描 `nodejs-project/node_modules` 下的 `binding.gyp` 判断是否有原生模块，自动决定是否重编，**无需配置**。

**手动强制重编**（特殊场景：换过 `libnode.so` 但依赖没变，检测机制未触发）：

```bash
# Linux / macOS
NODE_MOBILE_FORCE_REBUILD=1 npx node-mobile-app test
```

```powershell
# Windows
$env:NODE_MOBILE_FORCE_REBUILD=1; npx node-mobile-app test
```

**没有原生模块（纯 JS 依赖）**：无需关心，检测会自动跳过。

**切换架构（arm64 ↔ x86_64）**：不需要重编。JS 依赖跨架构，只有少数原生模块分架构。

**Windows 限制**：Windows 上 nodejs-mobile 无法编译原生模块（上游限制）。此功能仅 Linux / macOS 可用。

### 2.7 验证

**看 Node 版本**：

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb logcat -c
& $adb shell am force-stop <你的 appId>
& $adb shell am start -n <你的 appId>/.MainActivity
Start-Sleep -Seconds 5
& $adb logcat -d | Select-String 'NODEJS-MOBILE'
```

**预期**：

```
D nativeloader: Load ... libnodejs-mobile-react-native-native-lib.so ... : ok
I NODEJS-MOBILE: Node.js v22.23.2
```

**验证 full-icu**：临时在 `server.js` 顶部加：

```js
try {
  /^[$_\p{ID_Start}]$/u;
  console.log('=== ICU check: \\p{ID_Start} OK');
} catch (e) {
  console.log('=== ICU check failed:', e.message);
}
```

抓日志：

```powershell
& $adb logcat -c
& $adb shell am start -n <你的 appId>/.MainActivity
Start-Sleep -Seconds 5
& $adb logcat -d | Select-String 'ICU check'
```

预期：`I NODEJS-MOBILE: === ICU check: \p{ID_Start} OK`

若显示 `ICU check failed` → `libnode.so` 不带 full-icu → 见第三章自己编，或回退到 Express 4。

---

## 三、自己编译 libnode.so

**环境要求**：WSL（或 Linux），因为构建脚本依赖 `make` / `sed` / NDK。

### 3.1 准备源码与 NDK

```bash
# 克隆源码（国内推荐 Gitee）
git clone https://gitee.com/OpenFlun/nodejs-mobile.git
cd nodejs-mobile

# 下载 Android NDK r27
cd /mnt/d/nodejs-mobile-build
wget https://dl.google.com/android/repository/android-ndk-r27-linux.zip
unzip android-ndk-r27-linux.zip
```

### 3.2 关键：启用 full-icu

**默认 `--with-intl=none`，必须改成 `full-icu`**，否则 Express 5 跑不了。

```bash
cd /mnt/d/nodejs-mobile-build/nodejs-mobile

# 改前确认
grep with-intl android_configure.py

# 改成 full-icu
sed -i 's/--with-intl=none/--with-intl=full-icu/' android_configure.py

# 改后确认
grep with-intl android_configure.py
```

### 3.3 编译单架构

```bash
NDK=/mnt/d/nodejs-mobile-build/android-ndk-r27
SRC=/mnt/d/nodejs-mobile-build/nodejs-mobile
STRIP=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip

cd $SRC
rm -rf out config.gypi config.mk config.status

# 目标: arm64 或 x86_64
./android-configure $NDK 30 arm64
make -j4

# 剥离符号（必须，否则 .so 会大很多）
cp out/Release/libnode.so out/Release/libnode.so.bak
$STRIP out/Release/libnode.so

# 验证符号表未变
diff <(nm -D out/Release/libnode.so.bak | awk '{print $2, $3}' | sort) \
     <(nm -D out/Release/libnode.so | awk '{print $2, $3}' | sort) \
  && echo "符号表一致"

# 验证 full-icu
strings out/Release/libnode.so | grep -c "icudt78l"
# 应输出几千（约 4300），否则没编进 ICU
```

### 3.4 多架构编译（推荐用脚本）

**一键脚本** `/mnt/d/nodejs-mobile-build/build-all-archs.sh`：

```bash
#!/bin/bash
set -e
NDK=/mnt/d/nodejs-mobile-build/android-ndk-r27
SRC=/mnt/d/nodejs-mobile-build/nodejs-mobile
TMP=/mnt/d/nodejs-mobile-build/libnode-tmp
OUT=$SRC/out_android
STRIP=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip
HEADERS=/mnt/d/nodejs-mobile-build/node-v22.23.2-headers/include/node

# 编译前检查 full-icu
if ! grep -q "with-intl=full-icu" $SRC/android_configure.py; then
    echo "❌ android_configure.py 未启用 full-icu"
    exit 1
fi
echo "✅ full-icu 已启用"

mkdir -p $TMP $OUT

# 逐架构编译，暂存 .so
for ARCH in arm64 x86_64; do
    echo "=== 编译 $ARCH ==="
    cd $SRC
    rm -rf out config.gypi config.mk config.status
    ./android-configure $NDK 30 $ARCH
    make -j4
    $STRIP out/Release/libnode.so
    DIR_NAME=$([ "$ARCH" = "arm64" ] && echo "arm64-v8a" || echo "$ARCH")
    mkdir -p $TMP/$DIR_NAME
    cp out/Release/libnode.so $TMP/$DIR_NAME/libnode.so
    echo "--- ICU 符号数: $(strings $TMP/$DIR_NAME/libnode.so | grep -c 'icudt78l') ---"
done

# 打包 android-libnode.zip
cd /mnt/d/nodejs-mobile-build
rm -rf libnode-package
mkdir -p libnode-package/libnode/bin/arm64-v8a
mkdir -p libnode-package/libnode/bin/x86_64
mkdir -p libnode-package/libnode/include
cp -r $HEADERS libnode-package/libnode/include/node
cp $TMP/arm64-v8a/libnode.so libnode-package/libnode/bin/arm64-v8a/
cp $TMP/x86_64/libnode.so libnode-package/libnode/bin/x86_64/
cd libnode-package && zip -r android-libnode.zip libnode
mv android-libnode.zip $OUT/android-libnode.zip

echo "=== 产物：$OUT/android-libnode.zip ==="
ls -lh $OUT
```

执行：

```bash
chmod +x /mnt/d/nodejs-mobile-build/build-all-archs.sh
/mnt/d/nodejs-mobile-build/build-all-archs.sh
```

### 3.5 多架构编译注意事项

1. **每次切换架构必须清 `out`**：中间文件不能混用，否则奇怪的编译错误。脚本里已经 `rm -rf out`。
2. **切换架构会清空 `out`**：所以脚本编完一个架构立即把 `.so` 复制到 `libnode-tmp/<arch>/` 独立保存。
3. **每次切架构前确认 `--with-intl=full-icu` 还在**：`android_configure.py` 是源码，不会因切换架构被重置——但如果你从 Git 重新 clone 或覆盖过源码，修改会丢，务必再确认。
4. **验证两个架构都带 ICU**：`strings libnode.so | grep -c "icudt78l"` 应输出几千（约 4300），否则该架构没编进 ICU。

---

## 四、产物体积与 Express 版本

### 4.1 体积对照

**官方数据（strip 后）**：

| 版本                    | arm64-v8a     | x86_64        |
| ----------------------- | ------------- | ------------- |
| v18（官方，无 ICU）     | 59.6 MB       | 62.3 MB       |
| v22（自编译，full-icu） | **约 113 MB** | **约 118 MB** |

**zip 后**：`android-libnode.zip`（含两架构 `.so` + headers）约 88 MB。

体积差异约 50 MB，来自三部分：Node v22 核心引擎 + full-icu 数据（约 25–30 MB）+ V8 版本升级。**不是编译出错**。

### 4.2 full-icu 与 Express 版本

| libnode.so            | Node.js | ICU | Express                     |
| --------------------- | ------- | --- | --------------------------- |
| 官方 v18              | v18     | 无  | **必须 4.x**（如 `4.22.2`） |
| 自编译 v22 + full-icu | v22     | 有  | 可用 5.x（如 `5.2.1`）      |

**Express 版本选错的典型崩溃**：

- `number 116 is not a function` → v18 无 ICU 加载 `path-to-regexp@8`
- `Invalid regular expression: /^[$_\p{ID_Start}]$/u` → 同上

**Express 5 路由语法迁移**：

| Express 4                   | Express 5                         |
| --------------------------- | --------------------------------- |
| `app.get('*', handler)`     | `app.get('/{*splat}', handler)`   |
| `app.get('/:id?', handler)` | `app.get('/user{/:id}', handler)` |
| `app.del('/x', handler)`    | `app.delete('/x', handler)`       |
| `res.json(obj, 200)`        | `res.status(200).json(obj)`       |
| `res.send(200, body)`       | `res.status(200).send(body)`      |

**不要用 `@alloc/path-to-regexp` 替换原版**：它的 `exports` 只有 `import` 条件，CJS 下 `require()` 报 `No "exports" main defined`。用原版 `path-to-regexp@8.4.2`。

---

## 五、常见问题

### 5.1 armeabi-v7a 为什么放弃

**结论**：v22+ **放弃 armeabi-v7a（32 位 ARM）**。

**原因**：

1. **V8 官方限制**：x64 主机上交叉编译 32 位 arm 目标时，`deps/v8/include/v8config.h` 第 914 行硬性拒绝：

   ```
   #error Target architecture arm is only supported on arm and ia32 host
   ```

   即使强行绕过，后续 Torque 工具仍报大量 8 字节对齐错误。

2. **实际意义有限**：Android 从 2019 年起要求新应用提供 64 位版本，现代设备几乎全部 arm64-v8a。

**替代**：需 32 位 ARM 支持，用 Node.js v18 或 v20。

### 5.2 x86_64 的说明

x86_64 在 x64 主机上**无交叉编译问题**，与 arm64 流程一致。`android-libnode.zip` 已含 x86_64 产物。

**用途**：Android Studio / 命令行的 x86_64 架构 AVD（模拟器）。

**用模拟器时**：
- `mobileAppConfig.js` 的 `abiFilters` 含 `x86_64`
- `libnode/bin/x86_64/libnode.so` 存在
- 模拟器镜像必须是 x86_64 架构（不是 arm64）

### 5.3 自编译相关坑

| 问题                                                                      | 原因                                                   | 解决                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `number 116 is not a function`                                            | `libnode.so` 无 full-icu                               | 重新用 `--with-intl=full-icu` 编译，或回退 Express 4                                            |
| `\p{...}` 正则报错                                                        | 同上                                                   | 同上                                                                                            |
| `No "exports" main defined`                                               | 用了 `@alloc/path-to-regexp`                           | 撤销 `overrides`，清 `node_modules` + `package-lock.json` 重装                                  |
| `Cannot find module 'rn-bridge'`                                          | Node 20+ 不再把链接绑定暴露给 `require()`              | 需修改 Node.js `lib/internal/modules/cjs/loader.js`，从 `NODE_PATH` 加载 `rn-bridge` 的 JS 包装 |
| `require('rn-bridge')` 返回原生绑定                                       | `loader.js` 补丁未生效                                 | 确认 `rn-bridge.cpp` 保持 `NODE_MODULE_LINKED` 注册宏                                           |
| JNI 编译报 `undefined symbol: v8::Exception::Error`                       | 插件旧头文件（v18 时代）与 v22 `libnode.so` ABI 不匹配 | **用 `android-libnode.zip` 整目录替换**，其 `include/node/` 是 v22 官方 headers                 |
| `NODE_MODULE_VERSION` 不匹配                                              | 原生模块未重编                                         | `NODE_MOBILE_FORCE_REBUILD=1` 后重跑 CLI                                                |
| Windows 下 `Unsupported operating system for nodejs-mobile native builds` | 插件硬编码只支持 macOS/Linux                           | 官方 v22 产物已含 Windows 支持（`windows-x86_64` + `host_os=win32`）                            |
| Gradle 9 报 `Could not find method exec()`                                | Gradle 9 移除 `exec()`                                 | 官方 v22 产物已修复（改用 `providers.exec`）                                                    |

---

## 六、注意事项

1. **插件本身可能不兼容**：`nodejs-mobile-react-native` 的 C++ 胶水代码为特定 Node.js 版本编写。升级到 v22+ 时可能需自行修改插件源码并重编。
2. **依赖库版本**：部分 npm 包限制 Node.js 版本。检查 `package.json` 的 `engines`。
3. **非官方产物**：自编译的 `libnode.so` 未经充分测试，生产环境前充分测试。
4. **多架构建议**：优先保证 `arm64-v8a`，按需补 `x86_64`。`armeabi-v7a` v22+ 已放弃。
5. **full-icu 是 Express 5 的硬前提**：不要图省事用 `--with-intl=none` 编译。
6. **`android-libnode.zip` 是唯一发布物**：与官方 nodejs-mobile 结构一致（`bin/` + `include/`），整目录替换，无需手动改头文件。
7. **CLI 会自动处理缓存**：替换 `libnode.so` 后跑 `test` / `build`，指纹机制检测到变化自动清 `.cxx` / `android/build` / `app/build`，全量重编。**无需手动清任何缓存**。

---

## 相关文档

- [README.md](./README.md) —— 快速开始、配置字段、命令
- [Android 构建指南.md](./Android 构建指南.md) —— 环境准备、libnode.so 对照、Express 版本、调试
- **预编译产物下载**：[GitHub Releases](https://github.com/OpenFlun/nodejs-mobile/releases) / [Gitee Releases](https://gitee.com/OpenFlun/nodejs-mobile/releases)
- **源码仓库**：[GitHub](https://github.com/OpenFlun/nodejs-mobile) / [Gitee](https://gitee.com/OpenFlun/nodejs-mobile)