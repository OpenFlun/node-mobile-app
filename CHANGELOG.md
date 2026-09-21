## [1.0.2] - 2026-09-21 08:24

### 修复
- **依赖树瘦身**：删除主包里未使用的 6 个依赖（`@babel/preset-env`、`@babel/runtime`、`@react-native/jest-preset`、`@react-native/new-app-screen`、`@react-native/typescript-config`、`react-native-safe-area-context`），安装体积与安装耗时下降
- **消除旧依赖链**：移除 `@react-native/eslint-config`，改为内置自写 ESLint flat config（`src/utils.js` 的 `buildEslintConfigSource()`，构建时覆写到 `node-mobile-app-build/eslint.config.js`）。随之消失的旧包：`inflight@1.0.6`、`rimraf@3.0.2`、`glob@7.2.3`、`@humanwhocodes/config-array`、`@humanwhocodes/object-schema`
- **ESLint 升级到 9**：统一使用 `eslint@^9`，不再出现 eslint 8 / 9 两份并存
- **模板 lint 清理**：修复 `template/App.tsx` 中逗号表达式触发的 `@typescript-eslint/no-unused-expressions` 报错，模板现在默认 `npx eslint` 零 error 零 warning

### 文档
- `mobileAppConfig.js` 与 `README.md` 更正签名说明：`build --release` **不配置 `android.signing` 也能出包**，默认沿用模板自带的 debug keystore 签名（可安装、可本地测试，不可上架）；需要上架时再填 `keystore` / `storePassword` / `keyAlias` / `keyPassword`

## [1.0.1] - 2026-09-20 11:52
### 首发
- 发布将 Node.js 项目一键打包为 Android / iOS 移动应用（基于 nodejs-mobile-react-native）;