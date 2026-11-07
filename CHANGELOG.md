# 变更日志

## [4.1.2] - 2026-11-07 22:27
### 修复
- 修复 Android 构建长时间卡在 Gradle 下载的问题;模板 `gradle-wrapper.properties` 的 `distributionUrl`
  由 `services.gradle.org` 改为腾讯云镜像,国内直连官方源常超时且不报错;
- 修复 `--debug` 下 Gradle 进度条被拆成大量点与数字的问题;调试模式编译改为 `stdio: 'inherit'`,
  让进度条直连终端刷新,不再经管道逐块拆分;

## [4.1.1] - 2026-11-06 11:11
### 优化
- 细节优化;

## [4.1.0] - 2026-11-06 10:10
### 新增
- 新增 `example` 子命令,重新生成 `mobileAppConfig.js` 到项目根目录;此前该文件只由 `postinstall` 自动复制,
  误删后无法手动恢复;文件已存在时跳过,不覆盖用户的修改;

### 优化
- 命令行帮助改用分组结构,按「命令」「选项」分节,子说明以 `- ` 前缀对齐,便于区分每个命令的注释边界;
- 帮助与运行输出统一使用 chalk 按语义着色:`用法:` 用 `blueBright`,分组名用 `cyan`,
  命令与选项名用 `cyanBright`,说明用 `gray`,成功用 `green` 与 `greenBright`,错误用 `red`;
- `scripts/copy-files.js` 的输出改用同套着色,移除 emoji 前缀;
- 未知命令分支由逗号链跨行改为分号结束的多行块,符合行宽与语句分隔规则;

### 修复
- 指南文件名由 `Android 构建指南.md` 改为 `Android构建指南.md`,去除空格;
  README 中的链接同步去除 `%20` 编码,此前指向不存在的路径;

### 文档
- README 命令列表与 `mobileAppConfig.js` 的「常用命令」注释补 `example`;
- README 包目录结构按 `files` 字段顺序重排;