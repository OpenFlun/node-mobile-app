import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureDir, removeDir } from './utils.js';

const FINGERPRINT_FILE = '.build-fingerprint.json',
  hashUserDeps = userProjectDir => {
    const h = crypto.createHash('sha256'), pkgPath = path.join(userProjectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        h.update(JSON.stringify(pkg.dependencies || {})), h.update('|'), h.update(pkg.type || '');
      } catch { h.update('package.json-read-error'); }
    }
    else h.update('no-package');
    return h.digest('hex');
  },
  writeFp = (file, fp) => fs.writeFileSync(file, JSON.stringify(fp, null, 2), 'utf-8'),
  clearCommonCaches = (buildDir, userProjectDir) => {
    removeDir(path.join(buildDir, 'android', 'build'));
    removeDir(path.join(buildDir, 'android', 'app', 'build'));
    removeDir(path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native', 'android', 'build'));
  },
  computeFingerprint = (userProjectDir, config, pkgRoot) => {
    const abiFilters = [...(config.android.abiFilters || [])].sort(), libnode = {},
      pluginDir = path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native'),
      libnodeBin = path.join(pluginDir, 'android', 'libnode', 'bin');

    if (fs.existsSync(libnodeBin)) {
      for (const arch of fs.readdirSync(libnodeBin)) {
        const so = path.join(libnodeBin, arch, 'libnode.so');
        if (fs.existsSync(so)) {
          const stat = fs.statSync(so);
          libnode[arch] = { size: stat.size, mtime: Math.floor(stat.mtimeMs) };
        }
      }
    }

    let pluginVersion = null;
    const pluginPkg = path.join(pluginDir, 'package.json');
    if (fs.existsSync(pluginPkg)) try { pluginVersion = JSON.parse(fs.readFileSync(pluginPkg, 'utf-8')).version; } catch { };

    let cliVersion = null;
    const cliPkg = path.join(pkgRoot, 'package.json');
    if (fs.existsSync(cliPkg)) try { cliVersion = JSON.parse(fs.readFileSync(cliPkg, 'utf-8')).version; } catch { };

    const depsHash = hashUserDeps(userProjectDir), a = config.android || {},
      appInfo = {
        appName: config.appName || null,
        appId: config.appId || null,
        versionCode: config.versionCode || null,
        versionName: config.versionName || null,
        minSdkVersion: a.minSdkVersion || null,
        targetSdkVersion: a.targetSdkVersion || null,
        compileSdkVersion: a.compileSdkVersion || null,
        buildToolsVersion: a.buildToolsVersion || null,
        usesCleartextTraffic: a.usesCleartextTraffic !== false,
        permissions: [...(a.permissions || [])].sort(),
      };

    return { abiFilters, libnode, pluginVersion, cliVersion, depsHash, appInfo };
  },
  checkAndResetCache = (buildDir, userProjectDir, config, pkgRoot) => {
    ensureDir(buildDir);

    const fpFile = path.join(buildDir, FINGERPRINT_FILE), newFp = computeFingerprint(userProjectDir, config, pkgRoot);
    let oldFp = null;
    if (fs.existsSync(fpFile)) try { oldFp = JSON.parse(fs.readFileSync(fpFile, 'utf-8')); } catch { };
    if (!oldFp) return console.log('  ✓ 首次构建,无缓存可清'), writeFp(fpFile, newFp);

    const abiChanged = JSON.stringify(oldFp.abiFilters) !== JSON.stringify(newFp.abiFilters),
      libnodeChanged = JSON.stringify(oldFp.libnode) !== JSON.stringify(newFp.libnode),
      pluginChanged = oldFp.pluginVersion !== newFp.pluginVersion,
      cliChanged = oldFp.cliVersion !== newFp.cliVersion, depsChanged = oldFp.depsHash !== newFp.depsHash,
      appInfoChanged = JSON.stringify(oldFp.appInfo) !== JSON.stringify(newFp.appInfo),
      structural = abiChanged || libnodeChanged || pluginChanged || cliChanged;

    if (structural) {
      const reasons = [];
      if (abiChanged) reasons.push('ABI 配置');
      if (libnodeChanged) reasons.push('libnode.so');
      if (pluginChanged) reasons.push('插件版本');
      if (cliChanged) reasons.push('CLI 版本');
      if (depsChanged) reasons.push('用户依赖');
      if (appInfoChanged) reasons.push('应用信息');
      console.log('  ⚠️  检测到变化（' + reasons.join('、') + '），清理全部缓存');
      clearCommonCaches(buildDir, userProjectDir);
      removeDir(path.join(userProjectDir, 'node_modules', '@flun', 'nodejs-mobile-react-native', 'android', '.cxx'));
    }
    else if (depsChanged || appInfoChanged) {
      const reasons = [];
      if (depsChanged) reasons.push('用户依赖');
      if (appInfoChanged) reasons.push('应用信息');
      console.log('  ⚠️  检测到变化（' + reasons.join('、') + '），清理 nodejs-assets 缓存 + app/build');
      clearCommonCaches(buildDir, userProjectDir);
    }
    else console.log('  ✓ 缓存有效，跳过清理');

    writeFp(fpFile, newFp);
  };

export { computeFingerprint, checkAndResetCache };