# 变更日志
## [4.0.4] - 2026-10-21 10:02
### 优化了大量文件细节

## [4.0.3] - 2026-10-21 08:28
### 修复
- **`[3/11]` 提示中清理目标重复**:`depsChanged` 与 `appInfoChanged` 同时为真时,`targets` 数组会推入两次 `Gradle 缓存`,提示显示为"清理 依赖缓存、Gradle 缓存、Gradle 缓存";现用 `[...new Set(targets)]` 去重,提示与清理目标一致;
- **删除依赖快照误用 `removeDir`**:`.deps-snapshot.json` 是文件,原代码调用 `removeDir` 删除;该函数名与实现均针对目录,当前靠 `fs.rmSync` 的兼容性正常工作,但语义错位,一旦 `removeDir` 实现收紧(如增加 `isDirectory` 判断)会静默失效,导致快照残留、`[5/11]` 误判"依赖与环境未变化";现改用 `fs.rmSync(path, { force: true })` 直接删除文件;

## [4.0.2] - 2026-10-20 15:56
### 修复
- **CLI 或插件版本变化时跳过依赖重装,产物沿用旧优化规则**:`[3/11]` 检测到 CLI 版本、插件版本、ABI、libnode、模板文件变化时,原逻辑只清 Gradle 构建目录与插件 CMake 缓存,不清 `nodejs-assets` 与 `.deps-snapshot.json`;`[5/11]` 读到的仍是旧快照,判定"依赖与环境未变化",跳过安装与优化;结果是新版本代码配旧规则产物,原生模块的编译源文件、中间产物、异平台 prebuilds 可能残留;现拆分为 `clearGradleCaches` 与 `clearDepsCaches`,前者清 Gradle 与插件构建目录,后者清 `nodejs-assets` 与依赖快照;版本类变化同时清两者,触发重装、重编、重优化;
- **`[3/11]` 提示与实际清理范围不符**:原提示"清理全部缓存"实际只清 Gradle 构建目录;`depsChanged` / `appInfoChanged` 分支提示"清理 nodejs-assets 缓存 + app/build",但 `nodejs-assets` 从未被清理;现提示按实际清理目标拼接--版本类变化为"清理 Gradle 缓存、CMake 缓存与依赖缓存",依赖变化为"清理依赖缓存、Gradle 缓存",仅应用信息变化为"清理 Gradle 缓存";