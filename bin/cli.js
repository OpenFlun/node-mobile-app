#!/usr/bin/env node
import { runTest } from '../src/commands/test.js';
import { runBuild } from '../src/commands/build.js';
import { runClean } from '../src/commands/clean.js';
import chalk from 'chalk';

const HELP = `
@flun/node-mobile-app

指令:
  node-mobile-app test              编译并安装到设备（Android，需连 USB，走 Metro 热更新）
  node-mobile-app test --ios        iOS 版（仅 macOS）
  node-mobile-app build             打 debug APK（Android，离线可用）
  node-mobile-app build --release   打 release APK（Android，默认 debug keystore 签名，可安装）
  node-mobile-app build --ios       打 IPA（仅 macOS）
  node-mobile-app clean             清理构建缓存（不限平台）

选项:
  --device <id>   指定设备（仅 test）
  --arch <abi>    指定 ABI，逗号分隔（仅 build，Android）
  --debug         显示详细日志（所有指令通用）
`,

  parseFlags = args => {
    const f = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!a.startsWith('--')) continue;
      const k = a.slice(2), v = args[i + 1];
      if (v && !v.startsWith('--')) f[k] = v, i++;
      else f[k] = true;
    }
    return f;
  },

  main = async () => {
    const [cmd, ...rest] = process.argv.slice(2), flags = parseFlags(rest);
    if (flags.debug) process.env.OPTIMIZE_DEBUG = '1';
    try {
      if (cmd === 'test') await runTest(flags);
      else if (cmd === 'build') await runBuild(flags);
      else if (cmd === 'clean') await runClean(flags);
      else { console.log(HELP); process.exit(cmd ? 1 : 0); }
    } catch (e) {
      console.error(chalk.red('\n❌ ' + e.message));
      if (process.env.DEBUG) console.error(chalk.red(e.stack));
      process.exit(1);
    }
  };

main();
