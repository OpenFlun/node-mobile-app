/**
 * React Native 应用入口
 * 挂载根组件 App（见 App.tsx）到 AppRegistry，
 * 组件名取自 app.json 的 name（由 CLI 根据 appName 自动生成）
 *
 * 用户一般不需要修改这个文件
 */
import { AppRegistry } from 'react-native';
import { App } from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);