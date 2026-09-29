# 变更日志
## [2.1.2] - 2026-09-29 19:53
### 更改
- 加固了拷贝文件的一些逻辑;

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