import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const ensureDir = dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
},
  removeDir = dir => {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  },
  isExcluded = (name, patterns) => {
    for (let p of patterns) {
      p = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
      if (p === name) return true;
      if (p.includes('*')) {
        const escaped = p.replace(/[.+?^${}()|[\]\\/]/g, '\\$&').replace(/\*/g, '.*');
        if (new RegExp('^' + escaped + '$').test(name)) return true;
      }
    }
    return false;
  },
  /**
   * 递归复制，exclude 支持 'node_modules/'、'*.log'、'.git/'
   */
  copyDir = (src, dest, exclude = []) => {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const name = entry.name;
      if (isExcluded(name, exclude)) continue;
      const s = path.join(src, name), d = path.join(dest, name);
      if (entry.isDirectory()) copyDir(s, d, exclude);
      else if (entry.isFile()) fs.copyFileSync(s, d);
    }
  },
  readJson = file => JSON.parse(fs.readFileSync(file, 'utf-8')),
  writeJson = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf-8'),
  /**
   * 内容不同才写文件，避免不必要的 mtime 变化触发下游（Gradle/Metro）重编
   * 返回 true 表示写入了，false 表示内容相同跳过
   */
  writeIfChanged = (file, content) => {
    if (fs.existsSync(file)) {
      try {
        if (fs.readFileSync(file, 'utf-8') === content) return false;
      } catch { /* 读失败就当需要写 */ }
    }
    fs.writeFileSync(file, content, 'utf-8');
    return true;
  },
  /**
   * 大小和 mtime 都一致才跳过复制，否则复制
   * 用于用户项目 → nodejs-project 的增量复制
   */
  copyFileIfChanged = (src, dst) => {
    if (fs.existsSync(dst)) {
      try {
        const s = fs.statSync(src), d = fs.statSync(dst);
        if (s.size === d.size && Math.floor(s.mtimeMs) <= Math.floor(d.mtimeMs)) return false;
      } catch { /* 出错就复制 */ }
    }
    fs.copyFileSync(src, dst);
    return true;
  },
  run = (bin, args, opts = {}) => {
    const r = spawnSync(bin, args, { stdio: 'inherit', shell: true, ...opts });
    if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} 退出码 ${r.status}`);
    return r;
  },
  runQuiet = (bin, args, opts = {}) => spawnSync(bin, args, { encoding: 'utf-8', shell: true, ...opts }),
  runSilent = (bin, args, opts = {}) => {
    const r = spawnSync(bin, args, { encoding: 'utf-8', shell: true, ...opts });
    if (r.status !== 0) {
      if (r.stdout) process.stderr.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      throw new Error(`${bin} ${args.join(' ')} 退出码 ${r.status}`);
    }
    return r;
  },
  /**
   * 定位 adb（配置 > 环境变量 > 默认路径 > PATH）
   */
  findAdb = config => {
    // 1. 用户显式配置的路径优先
    const configured = config?.android?.adbPath;
    if (configured) {
      if (fs.existsSync(configured)) return configured;
      console.warn('⚠️  config.android.adbPath 不存在，回退到自动查找: ' + configured);
    }
    // 2. 环境变量 ANDROID_HOME / ANDROID_SDK_ROOT
    for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      const base = process.env[env];
      if (base) {
        const p = path.join(base, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
        if (fs.existsSync(p)) return p;
      }
    }
    // 3. 默认路径猜测（Windows / macOS / Linux）
    const home = process.env.USERPROFILE || process.env.HOME || '', localAppData = process.env.LOCALAPPDATA || '',
      candidates = [
        path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
        path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
        path.join(home, 'Android', 'Sdk', 'platform-tools', 'adb')
      ];
    for (const c of candidates) if (c && fs.existsSync(c)) return c;
    return 'adb';
  },
  /**
   * 定位 hermesc（Hermes 编译器，用于把 JS bundle 编成字节码）
   */
  findHermesc = userProjectDir => {
    const base = path.join(userProjectDir, 'node_modules', 'hermes-compiler', 'hermesc'), platform = process.platform;
    let sub;
    if (platform === 'win32') sub = ['win64-bin', 'hermesc.exe'];
    else if (platform === 'darwin') sub = ['osx-bin', 'hermesc'];
    else sub = ['linux64-bin', 'hermesc'];
    const p = path.join(base, ...sub);
    return fs.existsSync(p) ? p : null;
  },
  /**
   * 文件名安全化：去除文件系统非法字符（/ \ : * ? " < > |）
   * 空结果回退 'app'
   */
  sanitizeFileName = s => {
    const cleaned = String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
    return cleaned || 'app';
  },
  /**
   * 生成 ESLint flat config 源码（替代 @react-native/eslint-config/flat）
   */
  buildEslintConfigSource = () => `import js from '@eslint/js';
    import babelParser from '@babel/eslint-parser';
    import tsParser from '@typescript-eslint/parser';
    import tsPlugin from '@typescript-eslint/eslint-plugin';
    import reactPlugin from 'eslint-plugin-react';
    import reactHooks from 'eslint-plugin-react-hooks';
    import reactNative from 'eslint-plugin-react-native';
    import prettier from 'eslint-config-prettier';

    export default [
      js.configs.recommended,
      {
        files: ['**/*.{js,jsx,ts,tsx}'],
        languageOptions: {
          parser: babelParser,
          parserOptions: { requireConfigFile: false, babelOptions: { presets: ['module:@react-native/babel-preset'] } },
        },
        plugins: { react: reactPlugin, 'react-hooks': reactHooks, 'react-native': reactNative },
        settings: { react: { version: 'detect' } },
        rules: {
          ...reactPlugin.configs.recommended.rules,
          ...reactHooks.configs.recommended.rules,
          'react/react-in-jsx-scope': 'off',
          'react/prop-types': 'off',
        },
      },
      { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tsParser }, plugins: { '@typescript-eslint': tsPlugin },
       rules: tsPlugin.configs.recommended.rules }, prettier];`;

export {
  ensureDir, removeDir, isExcluded, copyDir, readJson, writeJson, writeIfChanged, copyFileIfChanged, run, runQuiet,
  runSilent, findAdb, findHermesc, sanitizeFileName, buildEslintConfigSource
};