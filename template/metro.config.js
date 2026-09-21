import { getDefaultConfig, mergeConfig } from '@react-native/metro-config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url), __dirname = dirname(__filename), workspaceRoot = resolve(__dirname, '..'),
  /**
   * Metro 配置
   * RN 工程位于 <userProject>/node-mobile-app-build/
   * 依赖装在 <userProject>/node_modules/（上一级）
   *
   * watchFolders 只监听必要位置，避免递归整个用户项目（性能灾难）
   */
  config = {
    watchFolders: [__dirname, resolve(workspaceRoot, 'node_modules')],
    resolver: { nodeModulesPaths: [resolve(__dirname, 'node_modules'), resolve(workspaceRoot, 'node_modules')] }
  };

export default mergeConfig(getDefaultConfig(__dirname), config);