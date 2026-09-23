import path from 'path';
import fs from 'fs';
import { removeDir } from '../utils.js';
import { getBuildDir } from '../copy.js';

const runClean = async () => {
  const userProjectDir = process.cwd(), buildDir = getBuildDir(userProjectDir),
    targets = [
      { label: '构建目录', path: buildDir },
      {
        label: '插件 CMake 缓存', path: path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native', 'android',
          '.cxx')
      },
    ];

  for (const t of targets) {
    if (fs.existsSync(t.path))
      removeDir(t.path), console.log('已清理:', t.label, '->', path.relative(userProjectDir, t.path) || t.path);
    else console.log('跳过（不存在）:', t.label);
  }

  console.log('\n✅ 清理完成');
};

export { runClean };