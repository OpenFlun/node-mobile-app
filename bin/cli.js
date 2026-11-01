#!/usr/bin/env node
import { runTest } from '../src/commands/test.js';
import { runBuild } from '../src/commands/build.js';
import { runClean } from '../src/commands/clean.js';
import chalk from 'chalk';

const HELP = `用法: node-mobile-app <命令> [选项]

  命令:
    test              编译并安装到设备(走 Metro 热更新)
                        Android  默认,需 adb 可连的设备(真机或模拟器),默认配置 'arm64-v8a'(真机)
                        iOS      加 --ios,仅 macOS
    build             打包
                        Android  默认 debug APK,离线可用;加 --release 打 release APK
                        iOS      加 --ios,仅 macOS,打 IPA;加 --release 用 Release 配置与 ad-hoc 导出
    clean             清理构建缓存(不限平台)

  选项:
    --ios             目标为 iOS;test 与 build 均可用,仅 macOS
    --release         打 release 包;仅 build 可用,Android 与 iOS 均生效;
                      打包安卓包时,请根据使用场景配置签名(走默认/自签名/正式签名);
    --device <id>     指定设备;仅 test
    --arch <abi>      指定 ABI,逗号分隔;仅 build,Android
    --debug           显示详细日志;所有命令通用

  无参数、help、-h、--help 输出本帮助。`,

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
      else if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { console.log(HELP); process.exit(0); }
      else { console.error(chalk.yellow(`✗ 未知命令: ${cmd}\n`)), console.log(HELP), process.exit(1); }
    } catch (e) {
      console.error(chalk.red('\n❌ ' + e.message));
      if (process.env.DEBUG) console.error(chalk.red(e.stack));
      process.exit(1);
    }
  };

main();