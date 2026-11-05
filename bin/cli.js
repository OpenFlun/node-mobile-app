#!/usr/bin/env node
import chalk from 'chalk';
import { runTest } from '../src/commands/test.js';
import { runBuild } from '../src/commands/build.js';
import { runClean } from '../src/commands/clean.js';

// 输出用法;
const printHelp = () => {
  const cmd = (name, desc) => `      ${chalk.cyanBright(name.padEnd(20))}${chalk.gray(desc)}`,
    grp = name => `    ${chalk.cyan(name)}`,
    sub = text => `                            - ${chalk.gray(text)}`;
  console.log([
    `  ${chalk.blueBright('用法:')} node-mobile-app <命令> [选项]`, '',
    grp('命令'),
    cmd('test', '编译并安装到设备,走 Metro 热更新'),
    sub('Android 默认,需 adb 可连的设备(真机或模拟器),默认配置 arm64-v8a(真机)'),
    sub('iOS 加 --ios,仅 macOS'),
    cmd('build', '打包'),
    sub('Android 默认 debug APK,离线可用;加 --release 打 release APK'),
    sub('iOS 加 --ios,仅 macOS,打 IPA;加 --release 用 Release 配置与 ad-hoc 导出'),
    cmd('clean', '清理构建缓存,不限平台'), '',
    grp('选项'),
    cmd('--ios', '目标为 iOS;test 与 build 均可用,仅 macOS'),
    cmd('--release', '打 release 包;仅 build 可用,Android 与 iOS 均生效'),
    sub('打包安卓包时,请根据使用场景配置签名:默认、自签名或正式签名'),
    cmd('--device <id>', '指定设备;仅 test'),
    cmd('--arch <abi>', '指定 ABI,逗号分隔;仅 build,Android'),
    cmd('--debug', '显示详细日志;所有命令通用'), '',
    `  ${chalk.gray('无参数、help、-h、--help 输出本帮助;')}`
  ].join('\n'));
},
  /**
   * 解析 --key value 参数,重复键覆盖为后者;
   * @param {string[]} args 子命令后的参数
   * @returns {Object} 解析结果
   */
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
  // 命令分发入口;
  main = async () => {
    const [cmd, ...rest] = process.argv.slice(2), flags = parseFlags(rest);
    if (flags.debug) process.env.OPTIMIZE_DEBUG = '1';
    try {
      if (cmd === 'test') await runTest(flags);
      else if (cmd === 'build') await runBuild(flags);
      else if (cmd === 'clean') await runClean(flags);
      else if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') return printHelp(), process.exit(0);
      else {
        console.error(chalk.red('✗ 未知命令: ') + chalk.yellow(cmd)), console.log('');
        printHelp(), process.exit(1);
      }
    } catch (e) {
      console.error(chalk.red('✗ ') + e.message);
      if (process.env.DEBUG) console.error(chalk.gray(e.stack));
      process.exit(1);
    }
  };

main();