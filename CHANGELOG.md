# 变更日志

## [2.1.1] - 2026-09-29 13:55
### 优化
- 优化了 'README.md' 文档;

## [2.1.0] - 2026-09-29 10:39
### 变更

- **ESLint 插件换代**：`@babel/eslint-parser`、`eslint-plugin-react`、`eslint-plugin-react-native` 三个包的最新版均不支持 ESLint 10（分别止步于 9.0.0 / 9.7 / 9），导致安装 `eslint@10` 时被额外拉入一份 `eslint@9.39.5`（npm 的 peer 兼容回退），并触发 npm 的 deprecated 警告。现替换为：

  | 原                                                   | 新                                                  |
  | ---------------------------------------------------- | --------------------------------------------------- |
  | `@babel/eslint-parser`                               | `@typescript-eslint/parser`（已支持 ESLint 10）     |
  | `eslint-plugin-react` + `eslint-plugin-react-native` | `@eslint-react/eslint-plugin`（原生支持 ESLint 10） |

  生成的 `eslint.config.js` 随之更新。`eslint-plugin-react-hooks` 保留（其 7.1.x 已支持 ESLint 10）。

  > **注意**：lint 规则集与原先不同，升级后对同一份代码可能报出不同的检查结果。这只影响静态检查，不影响构建产物与运行。

### 修复

- **`DEP0190` 弃用警告**：`src/utils.js` 中的 `run` / `runQuiet` / `runSilent` 原先统一用 `spawnSync(bin, args, { shell: true })`。Node 20+ 对「参数数组 + shell」这种组合会提示参数未转义（`DEP0190`），每次执行 CLI 都会在输出末尾出现该警告。现改为：
  - Windows：把命令与参数拼成单个字符串（参数按需加引号）后交给 shell——`.cmd` / `.bat` 仍能执行，且不再触发警告；
  - 其它平台：不使用 shell，参数交由 Node 转义。
## [2.0.8] - 2026-09-28 22:17
### 修复

- **中文路径构建失败**：三处联动修复。
  - **AGP 拒绝非 ASCII 路径**：`template/android/gradle.properties` 增加 `android.overridePathCheck=true`，允许中文路径构建。
  - **`gradle.properties` 中文乱码**：该文件按 ISO-8859-1 读取，非 ASCII 字符（如路径中的「桌面」）会被读成乱码，导致 keystore 找不到。`patcher.js` 现在把写入的非 ASCII 字符转成 `\uXXXX` 转义（Java Properties 规范）。
  - 影响范围：项目路径含中文（或其它非 ASCII 字符）时，release 构建曾失败于 `Your project path contains non-ASCII characters` 与 `Keystore file ... not found`。
- **签名配置缺项时报错含糊**：`android.signing.keystore` 已配置、但密码 / 别名 / 别名密码为空时，原先会一路跑到 Gradle 才报 `keystore password was incorrect`，容易误导排查方向。现在 `patcher.js` 在构建前即校验四项，缺项时抛出明确错误，并提示「仅本地测试可注释掉整个 signing 块」。

### 变更

- **`mobileAppConfig.js` 模板**：`signing` 块内每项标注「必填」，并说明「取消整块注释即视为启用签名」。