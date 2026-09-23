import path from 'path';
import fs from 'fs';
import {
  ensureDir, removeDir, readJson, isExcluded, copyFileIfChanged, writeIfChanged, buildEslintConfigSource
} from './utils.js';
import { resolveSdkPath } from './config.js';

const BUILD_DIR_NAME = 'node-mobile-app-build',
  TEMPLATE_EXCLUDE = [
    'build/', '.gradle/', '.cxx/', '.kotlin/',
    'app/build/', 'app/.cxx/',
    'Pods/', 'local.properties', '*.bak', 'gradle.properties.bak',
  ],
  /**
   * 内部：递归覆盖式复制模板,跳过 keepSet 命中的文件
   */
  copyDirOverwrite = (src, dst, exclude, buildDir, keepSet) => {
    ensureDir(dst);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (isExcluded(entry.name, exclude)) continue;
      const s = path.join(src, entry.name), d = path.join(dst, entry.name);
      if (entry.isDirectory()) copyDirOverwrite(s, d, exclude, buildDir, keepSet);
      else if (entry.isFile()) {
        const rel = path.relative(buildDir, d).replace(/\\/g, '/');
        if (keepSet.has(rel)) continue;
        copyFileIfChanged(s, d);
      }
    }
  },
  /**
   * 内部：增量复制用户项目到 nodejs-project
   * 保留 node_modules 等由其他步骤生成的产物
   */
  copyDirIncremental = (src, dst, exclude) => {
    ensureDir(dst);

    const dstKeep = new Set(['node_modules', '.deps-hash', 'main.js', 'package.json', 'package-lock.json']),
      srcNames = new Set(fs.readdirSync(src));
    // 1. 删除 dst 里不该存在的条目
    for (const name of fs.readdirSync(dst)) {
      if (dstKeep.has(name)) continue;
      if (!srcNames.has(name) || isExcluded(name, exclude)) removeDir(path.join(dst, name));
    }
    // 2. 增量复制
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (isExcluded(entry.name, exclude)) continue;
      if (dstKeep.has(entry.name)) continue;
      const s = path.join(src, entry.name), d = path.join(dst, entry.name);
      if (entry.isDirectory()) copyDirIncremental(s, d, exclude);
      else if (entry.isFile()) copyFileIfChanged(s, d);
    }
  },
  /**
   * 获取 build 目录路径：<userProject>/node-mobile-app-build
   */
  getBuildDir = userProjectDir => path.join(userProjectDir, BUILD_DIR_NAME),

  /**
   * 把 buildDir/package.json 的依赖版本同步为主包 dependencies 的版本
   * - 依赖名单来自 buildDir/package.json（模板声明需要哪些依赖）
   * - 版本号来自 pkgRoot/package.json 的 dependencies（单一数据源）
   * - 若主包缺少某个依赖，抛错中断（避免模板占位值被真正使用）
   */
  syncTemplateDependencies = (pkgRoot, buildDir) => {
    const buildPkgPath = path.join(buildDir, 'package.json');
    if (!fs.existsSync(buildPkgPath)) return;
    const mainPkgPath = path.join(pkgRoot, 'package.json');
    if (!fs.existsSync(mainPkgPath)) return;

    const buildPkg = readJson(buildPkgPath);
    const mainPkg = readJson(mainPkgPath);
    if (!buildPkg.dependencies) return;

    const mainDeps = mainPkg.dependencies || {};
    const missing = [];
    let updated = 0;

    // 移除仅用于模板占位说明的 _comment 字段，避免带进最终 build 工程
    if ('_comment' in buildPkg) {
      delete buildPkg._comment;
      updated++;
    }
    for (const name of Object.keys(buildPkg.dependencies)) {
      const v = mainDeps[name];
      if (!v) { missing.push(name); continue; }
      if (buildPkg.dependencies[name] !== v) {
        buildPkg.dependencies[name] = v;
        updated++;
      }
    }

    if (updated > 0) {
      writeIfChanged(buildPkgPath, JSON.stringify(buildPkg, null, 2) + '\n');
      console.log('  ✓ 已同步 ' + updated + ' 个依赖版本到 ' + BUILD_DIR_NAME + '/package.json');
    }

    if (missing.length > 0) {
      throw new Error(
        'template/package.json 声明的以下依赖在主包 dependencies 中不存在：\n' +
        '       ' + missing.join(', ') + '\n' +
        '     请在 @flun/node-mobile-app 的 package.json 中补上对应声明（版本号随意，\n' +
        '     但必须存在，以便 syncTemplateDependencies 覆盖模板里的占位值）。'
      );
    }
  },
  /**
   * 把 CLI 包里的 template/ 逐文件覆盖到 build 目录
   * - 只覆盖模板里存在的文件，不删除 buildDir 里已有的其他内容（保留 Gradle 增量缓存）
   * - 模板文件被改写时自动同步；新增文件自动添加
   * - 若模板里删除了文件，旧副本残留由 CLI 版本指纹触发全量重建处理
   */
  copyTemplate = (pkgRoot, buildDir, config) => {
    ensureDir(buildDir);

    const templateDir = path.join(pkgRoot, 'template');
    if (!fs.existsSync(templateDir)) throw new Error('CLI 包缺少 template/ 目录: ' + templateDir);

    const keepSet = new Set((config && config.keepFiles) || []);
    copyDirOverwrite(templateDir, buildDir, TEMPLATE_EXCLUDE, buildDir, keepSet);
    fs.writeFileSync(path.join(buildDir, 'eslint.config.js'), buildEslintConfigSource(), 'utf-8');
    syncTemplateDependencies(pkgRoot, buildDir);
    console.log('  ✓ 模板已更新到', BUILD_DIR_NAME + '/');
    if (keepSet.size > 0) console.log('    保留文件:', Array.from(keepSet).join(', '));
  },
  /**
   * 复制用户 Node 项目到 <buildDir>/nodejs-assets/nodejs-project
   * 复制后重写 package.json：只保留 dependencies，剔除 devDependencies；用 config 的 allowScripts
   */
  copyUserProject = (userProjectDir, buildDir, config) => {
    const targetDir = path.join(buildDir, 'nodejs-assets', 'nodejs-project');
    ensureDir(targetDir);

    const exclude = [
      ...config.excludeFiles, BUILD_DIR_NAME + '/',
      'mobileAppConfig.js', 'mobileAppConfig.mjs', 'mobileAppConfig.cjs'
    ];

    // 增量复制：内容变化的文件才覆盖，保留 node_modules 和其他未变文件
    copyDirIncremental(userProjectDir, targetDir, exclude);
    // 黑名单式过滤：只删 devDependencies 和 allowScripts,其余字段原样保留
    const userPkgPath = path.join(userProjectDir, 'package.json');
    if (!fs.existsSync(userPkgPath)) throw new Error('用户项目缺少 package.json');
    const pkg = readJson(userPkgPath), out = { ...pkg };
    delete out.devDependencies;
    out.allowScripts = (config.allowScripts && Object.keys(config.allowScripts).length) ? config.allowScripts : { node: true };
    writeIfChanged(path.join(targetDir, 'package.json'), JSON.stringify(out, null, 2) + '\n');

    console.log('  ✓ 已同步用户项目到 nodejs-assets/nodejs-project');
    console.log('    模块类型:', out.type === 'module' ? 'ESM' : 'CJS');
    console.log('    生产依赖:', Object.keys(out.dependencies || {}).length, '个');

    return { pkg: out, moduleType: out.type === 'module' ? 'module' : 'commonjs', targetDir };
  },
  /**
   * 生成 <buildDir>/android/local.properties（Gradle 需要 sdk.dir）
   */
  writeLocalProperties = (buildDir, config) => {
    const sdkPath = resolveSdkPath(config);
    if (!sdkPath) return console.warn('  ⚠️  未找到 Android SDK，请在 mobileAppConfig.js 里配置 android.sdkPath');

    const localProps = path.join(buildDir, 'android', 'local.properties'),
      escaped = sdkPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    fs.writeFileSync(localProps, `sdk.dir=${escaped}\n`, 'utf-8');
    console.log('  ✓ 写入 sdk.dir:', sdkPath);
  },
  /**
   * 确保用户项目根存在 serverPath 指向的入口文件
   * 不存在时从 CLI 内置 cli-assets/server.js 复制一份
   */
  ensureUserEntry = (userProjectDir, config, pkgRoot) => {
    const entryPath = path.join(userProjectDir, config.serverPath);
    if (fs.existsSync(entryPath)) return { created: false, path: entryPath };

    const fallback = path.join(pkgRoot, 'cli-assets', 'server.js');
    if (!fs.existsSync(fallback)) throw new Error('入口文件不存在: ' + config.serverPath + '（CLI 内置模板也缺失）');

    ensureDir(path.dirname(entryPath)), fs.copyFileSync(fallback, entryPath);
    console.log('  ✓ 生成默认入口文件:', config.serverPath);
    console.log('    （因为用户项目里没有这个文件,从 CLI 内置模板复制）');

    return { created: true, path: entryPath };
  },
  /**
   * 确保用户项目根存在 mobileAppConfig.js
   * 不存在时从 CLI 包根复制一份（带注释的模板）
   */
  ensureUserConfig = (userProjectDir, pkgRoot) => {
    const configPath = path.join(userProjectDir, 'mobileAppConfig.js');
    if (fs.existsSync(configPath)) return { created: false, path: configPath };

    const fallback = path.join(pkgRoot, 'mobileAppConfig.js');
    if (!fs.existsSync(fallback)) throw new Error('CLI 缺少 mobileAppConfig.js 模板');

    fs.copyFileSync(fallback, configPath);
    console.log('  ✓ 生成默认配置文件: mobileAppConfig.js');
    console.log('    （因为用户项目里没有这个文件,从 CLI 内置模板复制）');

    return { created: true, path: configPath };
  },
  /**
   * 按 config.android.abiFilters 修改 buildDir 里的 app/build.gradle：
   *   - defaultConfig.ndk.abiFilters
   *   - gradle.properties 的 reactNativeArchitectures
   * 插件 build.gradle 读的是 project(":app").android.defaultConfig.ndk.abiFilters，
   * 所以必须改这里，改插件自身的 abiFilters 无效。
   */
  patchAndroidAbi = (buildDir, config) => {
    const file = path.join(buildDir, 'android', 'app', 'build.gradle');
    if (!fs.existsSync(file)) return console.warn('  ⚠️  未找到 app/build.gradle，跳过 ABI patch');

    const abiList = (config.android.abiFilters || []).map((x) => `"${x}"`).join(', ');
    let c = fs.readFileSync(file, 'utf-8');
    const before = c;

    // defaultConfig 里的 ndk { abiFilters ... }
    c = c.replace(/(defaultConfig\s*\{[\s\S]*?ndk\s*\{\s*abiFilters\s+)("[^"]*"(?:\s*,\s*"[^"]*")*)/, `$1${abiList}`);
    // 兜底：没有 ndk {} 块时，插到 defaultConfig 里
    if (!/ndk\s*\{\s*abiFilters/.test(c))
      c = c.replace(/(defaultConfig\s*\{)/, `$1\n        ndk {\n            abiFilters ${abiList}\n        }`);
    // 不 patch splits.abi.include：AGP 禁止它和 ndk.abiFilters 同时存在
    if (c !== before) writeIfChanged(file, c), console.log(`  ✓ 已设置 app ndk.abiFilters = [${abiList}]`);

    // 同步 gradle.properties 的 reactNativeArchitectures
    const propsFile = path.join(buildDir, 'android', 'gradle.properties');
    if (fs.existsSync(propsFile)) {
      let p = fs.readFileSync(propsFile, 'utf-8');
      const abiPlain = (config.android.abiFilters || []).join(','), before2 = p;
      p = p.replace(/^reactNativeArchitectures=.*/gm, `reactNativeArchitectures=${abiPlain}`);
      if (p !== before2) writeIfChanged(propsFile, p), console.log(`  ✓ 已设置 reactNativeArchitectures = ${abiPlain}`);
    }
  },
  /**
   * 把用户在 mobileAppConfig.js 里声明的 extraRnDependencies 注入 buildDir/package.json
   * 版本号从用户根 node_modules 读实际装的版本
   * 用户没装的会中断并提示安装命令
   */
  patchExtraRnDependencies = (buildDir, userProjectDir, config) => {
    const extras = config.extraRnDependencies || [];
    if (extras.length === 0) return;

    const buildPkgPath = path.join(buildDir, 'package.json');
    if (!fs.existsSync(buildPkgPath)) return console.warn('  ⚠️  未找到 buildDir/package.json,跳过 extraRnDependencies');

    const buildPkg = readJson(buildPkgPath);
    if (!buildPkg.dependencies) buildPkg.dependencies = {};

    const missing = [];
    let added = 0;
    for (const name of extras) {
      const pkgJson = path.join(userProjectDir, 'node_modules', name, 'package.json');
      if (!fs.existsSync(pkgJson)) {
        missing.push(name);
        continue;
      }
      try {
        const v = JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version;
        if (buildPkg.dependencies[name] !== v) buildPkg.dependencies[name] = v, added++;
      } catch { missing.push(name); }
    }

    if (added > 0) {
      writeIfChanged(buildPkgPath, JSON.stringify(buildPkg, null, 2) + '\n');
      console.log(`  ✓ 已注入 ${added} 个额外 RN 依赖到 buildDir/package.json`);
    }

    if (missing.length > 0) {
      throw new Error(
        'extraRnDependencies 里以下包未安装:\n' +
        '       ' + missing.join(', ') + '\n' +
        '     请先在项目根执行:\n' +
        '       npm install ' + missing.join(' ') + '\n' +
        '     然后重新运行 node-mobile-app test'
      );
    }
  };

export {
  getBuildDir, copyTemplate, copyUserProject, writeLocalProperties, ensureUserEntry, ensureUserConfig, patchAndroidAbi,
  patchExtraRnDependencies
};