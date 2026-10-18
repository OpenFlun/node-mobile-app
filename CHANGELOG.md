# 变更日志
## [3.1.5] - 2026-10-18 10:04
### 修复
- **修复原生模块编译时 `node-addon-api` 的 gyp / 头文件被误删**：`pruneDevFiles` 原保护条件为 `COMPILE_EXTS && inNativePkg`，而 `node-addon-api` 自身没有 `binding.gyp`、不在原生模块包列表内，其 `node_addon_api.gyp` 与头文件被当作开发文件删除，导致依赖它的原生模块（如 `bcrypt`）在 Gradle `npm rebuild` 时报 `../node-addon-api/node_addon_api.gyp not found`、构建中断；现新增 `isSkippedPkg`，保护条件改为 `COMPILE_EXTS && (inNativePkg || isSkippedPkg)`，仅保留 `SKIP_PKGS` 包内的编译文件（`.gyp`/`.gypi`/`.h`/`.c` 等），`.md`/`.map`/`.ts` 等仍照常清理，不扩大保留范围；

### 变更
- **阶段 4 不再清理 `.d.ts`**：`.d.ts` 已由阶段 6 的 `TS_RE`（`/\.(ts|cts|mts)$/`）覆盖，阶段 4 重复清理属冗余；移除后 `.d.ts` 统一由阶段 6 处理，清理职责不重叠；

## [3.1.4] - 2026-10-17 11:32
### 修复
- **修复 `react-native bundle` 报 `Cannot resolve @react-native/metro-config`**：个别场景下用户根 `node_modules` 中缺失该包（如历史安装残留、依赖布局异常），RN CLI 从其自身位置向上解析不到，导致 `test` / `build` 的 bundle 阶段中断；现由 `copyTemplate` 调用新增的 `linkNestedDeps`：遍历主包 `node_modules` 顶层全部条目（含 `@scope/` 子项，不列举包名），对从用户根解析不到的条目，在用户根 `node_modules` 下建 Junction（Windows）/ symlink（macOS/Linux）指向主包物理路径；用户根已能解析的条目跳过、不改 `package.json` / `package-lock.json`、建链接失败即中断；

### 变更
- **Android 模板仓库增加阿里云镜像兜底**：`settings.gradle` 的 `pluginManagement.repositories` 与 `build.gradle` 的 `buildscript.repositories` 在 `google()` / `mavenCentral()` 之前插入阿里云镜像（gradle-plugin / google / public），改善国内网络拉取 `react-android`、`hermes-android` 等 AAR 时卡在官方源的问题；镜像在前、官方源在后，海外网络镜像不命中会自动回退官方源，仅多一次往返，不影响功能；不写死镜像为唯一源，镜像故障时仍可由官方源兜住；

## [3.1.3] - 2026-10-15 23:10
### 修复
- **删除 `scripts` 字段的范围扩大**：原仅对被合并的包删除 `package.json` 的 `scripts`；跳过的包（如原生模块、JS 较少的包）仍保留，其安装期脚本会被 Gradle `npm rebuild` 触发，若脚本文件已被清理则报 `Cannot find module`、构建失败；现改为**对所有非原生包删除**（原生模块包保留，其 scripts 是编译必需）；