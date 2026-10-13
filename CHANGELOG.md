# 变更日志

## [3.0.0] - 2026-10-13 15:35
### 新增
- **node_modules 优化系统（默认开启）**：构建时自动执行六阶段优化，大幅减少打包文件数、加速启动。不改变项目源码，对任意 Node.js 项目通用；
  - **阶段 1 合并 JS**：按包入口 bundle，多个 JS 文件合并为单文件（`bundled/` 目录下的 `.cjs` / `.mjs`）；CJS 保持 CJS、ESM 保持 ESM；
  - **阶段 2 清空资源**：扫描各包 `postinstall` 引用的目录/文件，保留目录结构、清空内容；被 import/require 的保留不删；
  - **阶段 3 清平台二进制**：按目标平台 + `abiFilters` 逐文件判定，删除非本机二进制（三层识别：目录名、文件后缀、文件头魔数）；
  - **阶段 4 清开发文件**：删除 `.md` / `.map` / `.d.ts` / `.h` / `.c` 等非运行文件；**原生模块包（含 `binding.gyp`）内的编译必需文件保留**，确保原生编译通过；
  - **阶段 5 清中间产物**；**阶段 6 清不参与运行的文件和空目录**；
- **优化缓存（快照 + 指纹）**：`.deps-snapshot.json` 记录依赖、目标平台、架构、运行时 Node 主版本、优化代码指纹、上次构建是否完成；
  - 构建时自动判断并执行三种动作：**重装依赖并优化** / **仅优化** / **跳过**，日志说明当次动作与原因；
  - 运行时 Node 主版本从 `libnode/include/node/node_version.h` 读取（读不到则报错退出）；
- **模板指纹**：`template/` 目录内容纳入缓存指纹，模板改动自动触发重编；
- **`--debug` 调试开关**：`npx node-mobile-app build --debug` / `test --debug` 显示优化各阶段明细与各命令完整输出；
- **优化逃生舱口**（`mobileAppConfig.js`）：`optimize: { enabled: false }` 整体关闭优化；`optimize: { exclude: ['包名'] }` 精确排除特定包；
- **构建进度提示**：默认模式在打包阶段显示「打包进行中...」，避免长时间无输出被误认为卡死；`--debug` 下输出已完整，无需此提示；

### 修复
- **`bundled` 目录在 APK 中丢失（重要）**：aapt2 默认过滤 `<dir>_*`，原产物目录名以下划线开头，被打包时整体丢弃，应用启动报 `Node assets copy failed`；产物目录改用 `bundled`，绕开该过滤；
- **scripts 引用保护过宽**：原逻辑保护 `package.json` `scripts` 引用的所有 js（含 test / lint），但移动端无安装期、这些脚本永不执行；移除该保护，测试脚本等被正常清理；
- **`run` 输出策略**：`run` 默认实时输出（inherit）；新增 `quiet` 参数——捕获输出、成功静默、失败才打印，用于 `gradlew` / `xcodebuild` 等命令；
- **`clean` 清理不完整**：原只清 `node-mobile-app-build` 与插件 `.cxx`，现补上插件 `android/build`，确保清环境彻底；

### 升级注意事项
- **3.0.0 起 node_modules 优化默认开启**，无需配置即享优化收益；
- **升级后首次构建**会重装依赖并执行优化，比平时慢；后续构建命中缓存后无额外开销；
- 若**构建或运行异常**，按以下顺序排查：
  1. 在 `mobileAppConfig.js` 中设置 `optimize: { enabled: false }` 关闭优化，验证是否为优化引起；
  2. 若确认是某个包合并后异常，用 `optimize: { exclude: ['包名'] }` 排除优化时异常或不想优化的包；
  3. 若需彻底重来，删除 `node-mobile-app-build` 目录后重新构建。

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
