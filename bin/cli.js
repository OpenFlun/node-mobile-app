#!/usr/bin/env node
import { runTest } from '../src/commands/test.js';
import { runBuild } from '../src/commands/build.js';
import { runClean } from '../src/commands/clean.js';

const HELP = `
@flun/node-mobile-app

用法:
  node-mobile-app test              编译并安装到设备（开发调试）
  node-mobile-app test --ios        同上，iOS（仅 macOS）
  node-mobile-app build             打 APK
  node-mobile-app build --ios       打 IPA（仅 macOS）
  node-mobile-app clean             清理构建缓存

选项:
  --ios                目标平台为 iOS（默认 Android，仅 macOS 可执行）
  --release            打 release 包（build）
  --device <id>        指定设备（test）
  --arch <abi>         指定 ABI，逗号分隔（build，仅 Android）
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
    try {
      if (cmd === 'test') await runTest(flags);
      else if (cmd === 'build') await runBuild(flags);
      else if (cmd === 'clean') await runClean(flags);
      else { console.log(HELP); process.exit(cmd ? 1 : 0); }
    } catch (e) {
      console.error('\n❌ ' + e.message);
      if (process.env.DEBUG) console.error(e.stack);
      process.exit(1);
    }
  };

main();