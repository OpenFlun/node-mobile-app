# 变更日志
## [3.1.4] - 2026-10-17 11:32
### 修复
- **修复 `react-native bundle` 报 `Cannot resolve @react-native/metro-config`**：个别场景下用户根 `node_modules` 中缺失该包（如历史安装残留、依赖布局异常），RN CLI 从其自身位置向上解析不到，导致 `test` / `build` 的 bundle 阶段中断；现由 `copyTemplate` 调用新增的 `linkNestedDeps`：遍历主包 `node_modules` 顶层全部条目（含 `@scope/` 子项，不列举包名），对从用户根解析不到的条目，在用户根 `node_modules` 下建 Junction（Windows）/ symlink（macOS/Linux）指向主包物理路径；用户根已能解析的条目跳过、不改 `package.json` / `package-lock.json`、建链接失败即中断；

### 变更
- **Android 模板仓库增加阿里云镜像兜底**：`settings.gradle` 的 `pluginManagement.repositories` 与 `build.gradle` 的 `buildscript.repositories` 在 `google()` / `mavenCentral()` 之前插入阿里云镜像（gradle-plugin / google / public），改善国内网络拉取 `react-android`、`hermes-android` 等 AAR 时卡在官方源的问题；镜像在前、官方源在后，海外网络镜像不命中会自动回退官方源，仅多一次往返，不影响功能；不写死镜像为唯一源，镜像故障时仍可由官方源兜住；

## [3.1.3] - 2026-10-15 23:10
### 修复
- **删除 `scripts` 字段的范围扩大**：原仅对被合并的包删除 `package.json` 的 `scripts`；跳过的包（如原生模块、JS 较少的包）仍保留，其安装期脚本会被 Gradle `npm rebuild` 触发，若脚本文件已被清理则报 `Cannot find module`、构建失败；现改为**对所有非原生包删除**（原生模块包保留，其 scripts 是编译必需）；

## [3.1.2] - 2026-10-15 21:05
### 修复
- 修复了 "src\optimize-node-modules.js" 中 prunePlatform 函数一些边界问题;