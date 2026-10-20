import path from 'path';
import fs from 'fs';
import { removeDir } from '../utils.js';
import { getBuildDir } from '../copy.js';
import chalk from 'chalk';

const runClean = async () => {
  const userProjectDir = process.cwd(), buildDir = getBuildDir(userProjectDir),
    targets = [
      { label: '构建目录', path: buildDir },
      {
        label: '插件构建缓存', path: path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native',
          'android', 'build')
      },
      {
        label: '插件 CMake 缓存', path: path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native',
          'android', '.cxx')
      },
    ];

  for (const t of targets) {
    if (fs.existsSync(t.path))
      removeDir(t.path), console.log(chalk.green('已清理: ' + t.label + ' -> ' + (path.relative(userProjectDir, t.path) || t.path)));
    else console.log(chalk.gray('跳过（不存在）: ' + t.label));
  }

  console.log(chalk.green('\n✅ 清理完成'));
};

export { runClean };