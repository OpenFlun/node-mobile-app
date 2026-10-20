import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import chalk from 'chalk';

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
  // 把单个参数转成适合 Windows cmd.exe 的形式：含空白或 shell 元字符时加双引号。
  quoteShellArg = (s) => {
    const str = String(s);
    if (str === '') return '""';
    return /[\s"&|<>^()]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  },
  /**
   * 统一的子进程启动：
   * - Windows：.cmd / .bat 需经 shell；把命令与参数拼成单字符串，
   *   避免 spawnSync(bin, args, { shell: true }) 触发 DEP0190。
   * - 其它平台：不用 shell，参数交由 Node 转义。
   */
  spawnCmd = (bin, args, baseOpts = {}) => {
    if (process.platform === 'win32') {
      const cmd = [bin, ...args].map(quoteShellArg).join(' ');
      return spawnSync(cmd, { ...baseOpts, shell: true });
    }
    return spawnSync(bin, args, { ...baseOpts, shell: false });
  },
  /**
   * 异步 spawn：参数同 spawnCmd，返回 ChildProcess
   * @param {string} bin 命令
   * @param {string[]} args 参数
   * @param {object} [baseOpts] spawn 选项
   * @returns {import('child_process').ChildProcess}
   */
  spawnCmdAsync = (bin, args, baseOpts = {}) => {
    if (process.platform === 'win32') {
      const cmd = [bin, ...args].map(quoteShellArg).join(' ');
      return spawn(cmd, { ...baseOpts, shell: true });
    }
    return spawn(bin, args, { ...baseOpts, shell: false });
  },
  /**
   * 执行命令：默认实时输出（inherit）；quiet=true 时捕获输出，成功静默、失败才打印
   */
  run = (bin, args, opts = {}) => {
    const { quiet, ...restOpts } = opts;
    if (!quiet || process.env.OPTIMIZE_DEBUG) {
      const r = spawnCmd(bin, args, { stdio: 'inherit', ...restOpts });
      if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} 退出码 ${r.status}`);
      return r;
    }
    const r = spawnCmd(bin, args, { encoding: 'utf-8', ...restOpts });
    if (r.status !== 0) {
      if (r.stdout) process.stderr.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      throw new Error(`${bin} ${args.join(' ')} 退出码 ${r.status}`);
    }
    return r;
  },
  runQuiet = (bin, args, opts = {}) => spawnCmd(bin, args, { encoding: 'utf-8', ...opts }),
  runSilent = (bin, args, opts = {}) => {
    const r = spawnCmd(bin, args, { encoding: 'utf-8', ...opts });
    if (r.status !== 0) {
      if (r.stdout) process.stderr.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      throw new Error(`${bin} ${args.join(' ')} 退出码 ${r.status}`);
    }
    return r;
  },
  /**
   * 执行命令：实时输出，仅首行加缩进前缀，其余行原样
   * @param {string} bin 命令
   * @param {string[]} args 参数
   * @param {object} [opts] spawn 选项 + prefix
   * @returns {Promise<void>}
   */
  runStream = (bin, args, opts = {}) => new Promise((resolve, reject) => {
    const { prefix = '  ', quiet = false, ...restOpts } = opts, child = spawnCmdAsync(bin, args, restOpts),
      verbose = !quiet || process.env.OPTIMIZE_DEBUG, KEY_RE = /Installing|Installed|FAILED|error|Error|失败|退出码/;
    let first = true;
    const write = chunk => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (!verbose && !KEY_RE.test(line)) continue;
        process.stdout.write((first ? prefix : '') + line + '\n');
        first = false;
      }
    };
    if (child.stdout) child.stdout.on('data', write);
    if (child.stderr) child.stderr.on('data', write);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${bin} ${args.join(' ')} 退出码 ${code}`)));
  }),
  /**
   * 定位 adb（配置 > 环境变量 > 默认路径 > PATH）
   */
  findAdb = config => {
    // 1. 用户显式配置的路径优先
    const configured = config?.android?.adbPath;
    if (configured) {
      if (fs.existsSync(configured)) return configured;
      console.warn(chalk.yellow('⚠️  config.android.adbPath 不存在，回退到自动查找: ' + configured));
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
  /**
   * 读取安装状态标志（记录上次由本工具安装的包与变体）
   * @param {string} buildDir 构建目录
   * @returns {{appId:string, variant:'debug'|'release'}|null} 状态或 null
   */
  readInstallState = buildDir => {
    const f = path.join(buildDir, '.install-state.json');
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; }
  },
  /**
   * 写入安装状态标志（安装成功后调用）
   * @param {string} buildDir 构建目录
   * @param {object} state 状态
   * @returns {void}
   */
  writeInstallState = (buildDir, state) => {
    try { ensureDir(buildDir), fs.writeFileSync(path.join(buildDir, '.install-state.json'), JSON.stringify(state, null, 2)); } catch { }
  },
  /**
   * 查询设备上已安装包的 DEBUGGABLE 标志
   * @param {string} adb adb 路径
   * @param {string} appId 包名
   * @returns {'debug'|'release'|null} 变体或 null（未安装）
   */
  getInstalledVariant = (adb, appId, serial) => {
    const pre = serial ? ['-s', serial] : [],
      r = spawnCmd(adb, [...pre, 'shell', 'dumpsys', 'package', appId], { encoding: 'utf-8' });
    if (r.status !== 0 || !r.stdout || !r.stdout.includes('Package [')) return null;
    return /\bDEBUGGABLE\b/.test(r.stdout) ? 'debug' : 'release';
  },
  /**
   * 确保待装包可覆盖安装：标志不一致或变体不符时卸载已装包
   * @param {string} adb adb 路径
   * @param {string} appId 包名
   * @param {'debug'|'release'} want 待装变体
   * @param {string} buildDir 构建目录
   * @param {string} [serial] 设备序列号（多设备时指定）
   * @returns {void}
   */
  ensureInstallable = (adb, appId, want, buildDir, serial) => {
    const installed = getInstalledVariant(adb, appId, serial);
    if (installed && installed !== want) {
      console.log(chalk.yellow(`  已安装 ${installed} 包与待装 ${want} 包签名不同，先卸载`));
      spawnCmd(adb, [...(serial ? ['-s', serial] : []), 'uninstall', appId], { encoding: 'utf-8' });
    }
  },
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
    import tsParser from '@typescript-eslint/parser';
    import tsPlugin from '@typescript-eslint/eslint-plugin';
    import reactPlugin from '@eslint-react/eslint-plugin';
    import reactHooks from 'eslint-plugin-react-hooks';
    import prettier from 'eslint-config-prettier';
import chalk from 'chalk';

    export default [
      js.configs.recommended,
      {
        files: ['**/*.{js,jsx,ts,tsx}'],
        languageOptions: {
          parser: tsParser,
          parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
        },
        plugins: { ...reactPlugin.configs.recommended.plugins, 'react-hooks': reactHooks },
        settings: { ...reactPlugin.configs.recommended.settings },
        rules: {
          ...reactPlugin.configs.recommended.rules,
          ...reactHooks.configs.recommended.rules,
        },
      },
      { files: ['**/*.{ts,tsx}'], plugins: { '@typescript-eslint': tsPlugin },
       rules: tsPlugin.configs.recommended.rules }, prettier];`;

export {
  ensureDir, removeDir, isExcluded, copyDir, readJson, writeJson, writeIfChanged, copyFileIfChanged, spawnCmdAsync, run, runQuiet, runStream,
  runSilent, findAdb, readInstallState, writeInstallState, getInstalledVariant, ensureInstallable, findHermesc, sanitizeFileName, buildEslintConfigSource
};
