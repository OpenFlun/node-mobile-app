# 变更日志
## [4.0.1] - 2026-10-20 14:48

### 紧急修复
- **4.0.0 在全新安装时原生模块产物错误,应用无法正常加载**:4.0.0 发布时依赖 `@flun/nodejs-mobile-react-native` 的版本被锁定为 2.0.8,而 2.0.8 缺少配合编译前移的 Gradle 改动;结果 `DeleteIncorrectPrebuilds` 删除前移阶段已编译的 `.node`、`DetectCorrectPrebuilds` 用 prebuild 覆盖已编译结果、`BuildNpmModules` 重复编译,APK 内原生模块缺失或不匹配,应用启动后加载失败;现依赖 `@flun/nodejs-mobile-react-native@^2.1.0`,该版本在标记文件存在时保留 `build/Release/*.node`、跳过 prebuild 替换、跳过重复编译;

### 升级注意事项
- **已装 4.0.0 必须升级**:4.0.0 的锁文件已固定 `nodejs-mobile-react-native@2.0.8`,直接使用会构建失败或运行异常;请安装 4.0.1,或手动执行 `npm update @flun/nodejs-mobile-react-native` 升至 2.1.0;

### 更新
- 同步更新了一些依赖包

## [4.0.0] - 2026-10-20 12:09

### 升级注意事项
- **`test` 步骤由 10 步变为 11 步**:编译与安装拆分为 `[10/11] 编译 Debug 包`(`gradlew assembleDebug`)与 `[11/11] 安装到设备`(`adb install` + 启动);脚本或文档引用原 `[10/10]` 时需同步更新;
- **签名冲突时自动卸载设备应用**:`test` 安装前检测设备已装包的 `DEBUGGABLE` 标志,与待装变体不一致时先 `adb uninstall` 再安装;卸载会清除应用数据(登录态、缓存),切换 debug/release 前请自行备份;
- **原生模块编译前移至优化之前**:`npm install` 后立即交叉编译 Android 原生模块,再由优化阶段清理编译源文件与中间产物;NDK 版本与编译 SDK 从 `android/build.gradle` 的实际值读取,用户自定义 NDK 版本同样生效;

### 新增
- **`installerHash` 纳入快照**:记录 `install.js` 内容哈希,该文件变化时触发重装、重编、重优化;避免流程控制代码更新后仍复用旧缓存;
- **Metro 后台常驻**:`test` 执行前检测 `localhost:8081/status`,未运行则 detached 启动 `react-native start`(日志写入 `.metro.log`),就绪后继续;`run-android` 加 `--no-packager`,命令结束后热更新仍可用;30 秒未就绪打印警告并回落到 APK 内置 bundle;
- **bundle 变化自动失效 Gradle 缓存**:比对 `src/main/assets/index.android.bundle` 与 `mergeDebugAssets` 合并结果的 SHA256,不一致时删除合并目录强制重新合并;避免 Gradle UP-TO-DATE 判定导致装入旧 bundle;
- **编译前执行 `patch-package.js`**:把 `node-gyp-build` 替换为 `node-gyp-build-mobile`,使原生模块走 `@flun/nodejs-mobile-gyp` 而非 npm 自带 `node-gyp`;
- **提示配色与缩进分级**:引入 `chalk`,按「步骤标题 0 空格 / 动作与状态 2 空格 / 结果与完成 4 空格 / 子项详情 8 空格」分级;优化阶段作为步骤子项,标题 4 空格、结果 6 空格;
- **精简与详细双模式**:`run`/`runStream` 支持 `quiet`,默认只输出关键行与结果;`OPTIMIZE_DEBUG=1` 或 `--debug` 时全量输出;

### 修复
- **优化阶段不再依赖包名白名单**:`pruneDevFiles` 移除 `COMPILE_EXTS`、`inNativePkg`、`isSkippedPkg` 保护,编译已在优化前完成,编译源文件无条件清理;解决无 `binding.gyp` 的头文件包(`node-addon-api`、`nan` 等)需靠白名单枚举才不被误删的问题;
- **`prebuilds/<platform>-*` 按目标平台清理**:Android 只保留 `android` 平台目录,`linux`/`darwin`/`win32` 整目录删除;iOS 只保留 `darwin`;`delFile` 支持目录递归删除,此前 `unlinkSync` 对目录静默失败;
- **`PATTERNS` 覆盖完整编译源文件**:扩展名由 `.gyp|gypi`、`.h|c` 扩展为 `.gyp|gypi|h|hh|hpp|c|cc|cpp|cxx|m|mm`(带 `/i`);`.cc` 等此前残留的源文件现可清理;
- **阶段 5 覆盖 node-gyp 中间产物**:增加 `obj.target` 路径判定与 `.o`/`.d`/`.mk`/`.stamp`/`Makefile` 扩展名;源码编译的中间文件不再进入 APK;
- **多设备环境下 `test` 无法安装,报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`**:连接多台 Android 设备、并用 `--device <serial>` 指定目标时,安装前的签名检测未把 `-s <serial>` 传给 adb;adb 无法确定操作哪台设备,返回 `more than one device/emulator`;检测逻辑把非零状态当作"包未安装",跳过卸载;随后 `adb install` 因签名冲突失败;现 `getInstalledVariant`、`ensureInstallable` 增加 `serial` 参数,`test` 传入 `flags.device`,检测与安装操作同一台设备;
- **APK 目录缺失时抛原始 `ENOENT`**:`[11/11]` 先检查目录与 `app-debug.apk` 是否存在,缺失时输出明确错误并退出;
- **Metro 启动触发 `DEP0190` 弃用警告**:改用 `spawnCmdAsync`(Windows 拼单字符串、其它平台 `shell: false`);

### 性能
- **优化后 `node_modules` 体积与文件数下降**:编译前移使优化阶段可无条件清理编译源文件与中间产物,`bcrypt` 编译后仅保留 `build/Release/bcrypt_lib.node`;`prebuilds` 按目标平台裁剪,APK 不再包含异平台二进制;
- **Gradle 增量缓存保持有效**:bundle 哈希一致时不删 `mergeDebugAssets`,连续 `test` 走 UP-TO-DATE;

## [3.1.5] - 2026-10-18 10:04
### 修复
- **修复原生模块编译时 `node-addon-api` 的 gyp / 头文件被误删**:`pruneDevFiles` 原保护条件为 `COMPILE_EXTS && inNativePkg`,而 `node-addon-api` 自身没有 `binding.gyp`,不在原生模块包列表内,其 `node_addon_api.gyp` 与头文件被当作开发文件删除,导致依赖它的原生模块(如 `bcrypt`)在 Gradle `npm rebuild` 时报 `../node-addon-api/node_addon_api.gyp not found`,构建中断;现新增 `isSkippedPkg`,保护条件改为 `COMPILE_EXTS && (inNativePkg || isSkippedPkg)`,仅保留 `SKIP_PKGS` 包内的编译文件(`.gyp`/`.gypi`/`.h`/`.c` 等),`.md`/`.map`/`.ts` 等仍照常清理,不扩大保留范围;

### 变更
- **阶段 4 不再清理 `.d.ts`**:`.d.ts` 已由阶段 6 的 `TS_RE`(`/\.(ts|cts|mts)$/`)覆盖,阶段 4 重复清理属冗余;移除后 `.d.ts` 统一由阶段 6 处理,清理职责不重叠;