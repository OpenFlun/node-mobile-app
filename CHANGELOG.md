# 变更日志
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

## [3.1.4] - 2026-10-17 11:32
### 修复
- **修复 `react-native bundle` 报 `Cannot resolve @react-native/metro-config`**:个别场景下用户根 `node_modules` 中缺失该包(如历史安装残留,依赖布局异常),RN CLI 从其自身位置向上解析不到,导致 `test` / `build` 的 bundle 阶段中断;现由 `copyTemplate` 调用新增的 `linkNestedDeps`:遍历主包 `node_modules` 顶层全部条目(含 `@scope/` 子项,不列举包名),对从用户根解析不到的条目,在用户根 `node_modules` 下建 Junction(Windows)/ symlink(macOS/Linux)指向主包物理路径;用户根已能解析的条目跳过,不改 `package.json` / `package-lock.json`,建链接失败即中断;

### 变更
- **Android 模板仓库增加阿里云镜像兜底**:`settings.gradle` 的 `pluginManagement.repositories` 与 `build.gradle` 的 `buildscript.repositories` 在 `google()` / `mavenCentral()` 之前插入阿里云镜像(gradle-plugin / google / public),改善国内网络拉取 `react-android`,`hermes-android` 等 AAR 时卡在官方源的问题;镜像在前,官方源在后,海外网络镜像不命中会自动回退官方源,仅多一次往返,不影响功能;不写死镜像为唯一源,镜像故障时仍可由官方源兜住;

## [3.1.3] - 2026-10-15 23:10
### 修复
- **删除 `scripts` 字段的范围扩大**:原仅对被合并的包删除 `package.json` 的 `scripts`;跳过的包(如原生模块,JS 较少的包)仍保留,其安装期脚本会被 Gradle `npm rebuild` 触发,若脚本文件已被清理则报 `Cannot find module`,构建失败;现改为**对所有非原生包删除**(原生模块包保留,其 scripts 是编译必需);
