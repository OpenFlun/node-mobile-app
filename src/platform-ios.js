import path from 'path';
import fs from 'fs';
import { run, ensureDir } from './utils.js';

const SCHEME = 'MyApp',
  /** iOS 相关命令只能在 macOS 上跑 */
  ensureMac = () => {
    if (process.platform !== 'darwin') throw new Error('iOS 构建只能在 macOS 上执行（当前平台: ' + process.platform + '）');
  },
  /** 检查 xcodebuild 是否存在 */
  checkIosTools = () => {
    const r = run('which', ['xcodebuild'], { stdio: 'pipe' });
    if (r.status !== 0) throw new Error('未找到 xcodebuild，请安装 Xcode 并运行 xcode-select --install');
  },
  /**
   * 执行 pod install（若 Pods/ 已存在且 Podfile.lock 未变，cocoapods 会自动跳过）
   */
  podInstall = iosDir => {
    console.log('  pod install ...'), run('pod', ['install'], { cwd: iosDir });
  },
  /**
   * 把 config.ios.signing.certificate 导入临时 keychain，供 xcodebuild 签名用
   * 返回 { keychainPath, keychainPassword } 或 null（未配置 / 文件缺失）
   */
  setupSigningKeychain = (buildDir, userProjectDir, config) => {
    const signing = config.ios && config.ios.signing;
    if (!signing || !signing.certificate) return null;

    const certPath = path.resolve(userProjectDir, signing.certificate);
    if (!fs.existsSync(certPath)) {
      console.warn('  ⚠️  iOS 签名证书不存在，跳过:', certPath);
      return null;
    }

    const keychainDir = path.join(buildDir, 'ios', 'build', 'signing');
    ensureDir(keychainDir);
    const keychainPath = path.join(keychainDir, 'build.keychain-db'), keychainPassword = 'nmapp' + Date.now();

    // 清掉同名的旧 keychain（重复构建时）
    if (fs.existsSync(keychainPath)) fs.rmSync(keychainPath, { force: true });
    console.log('  创建临时 keychain 并导入证书 ...');
    run('security', ['create-keychain', '-p', keychainPassword, keychainPath]);
    run('security', ['set-keychain-settings', '-lut', '3600', keychainPath]);
    run('security', ['unlock-keychain', '-p', keychainPassword, keychainPath]);
    run('security', [
      'import', certPath,
      '-k', keychainPath,
      '-P', signing.certificatePassword || '',
      '-T', '/usr/bin/codesign',
      '-T', '/usr/bin/security',
    ]);
    run('security', [
      'set-key-partition-list',
      '-S', 'apple-tool:,apple:,codesign:',
      '-s',
      '-k', keychainPassword,
      keychainPath,
    ]);

    return { keychainPath, keychainPassword };
  },
  /**
   * xcodebuild archive
   * 返回 xcarchive 路径
   */
  xcodebuildArchive = (buildDir, config, release, userProjectDir) => {
    const iosDir = path.join(buildDir, 'ios'), workspace = path.join(iosDir, SCHEME + '.xcworkspace');
    if (!fs.existsSync(workspace)) throw new Error('未找到 ' + workspace + '（pod install 是否成功？）');

    const archiveDir = path.join(iosDir, 'build');
    ensureDir(archiveDir);
    const archivePath = path.join(archiveDir, SCHEME + '.xcarchive'), configName = release ? 'Release' : 'Debug',
      teamId = (config.ios && config.ios.signing && config.ios.signing.teamId) || '',
      args = [
        '-workspace', workspace,
        '-scheme', SCHEME,
        '-configuration', configName,
        '-destination', 'generic/platform=iOS',
        '-archivePath', archivePath,
        'archive',
      ];

    if (teamId) args.push('DEVELOPMENT_TEAM=' + teamId);

    // 若配置了 certificate，导入临时 keychain 并让 xcodebuild 使用
    const keychain = setupSigningKeychain(buildDir, userProjectDir, config);
    if (keychain) args.push('OTHER_CODE_SIGN_FLAGS=--keychain ' + keychain.keychainPath);

    console.log('  xcodebuild archive ...'), run('xcodebuild', args, { cwd: iosDir });
    return archivePath;
  },
  /**
   * xcodebuild -exportArchive，导出 .ipa
   * 返回 .ipa 路径
   */
  xcodebuildExport = (buildDir, config, release, outDir, userProjectDir) => {
    const iosDir = path.join(buildDir, 'ios'), exportDir = path.join(iosDir, 'build', 'export');
    ensureDir(exportDir);
    const archivePath = path.join(iosDir, 'build', SCHEME + '.xcarchive'), method = release ? 'ad-hoc' : 'development',
      signing = (config.ios && config.ios.signing) || {}, teamId = signing.teamId || '',
      // provisioningProfile 路径 → 取 basename（去扩展名），写进 exportOptions.plist
      profilePath = signing.provisioningProfile ? path.resolve(userProjectDir, signing.provisioningProfile) : '',
      profileName = profilePath ? path.basename(profilePath).replace(/\.mobileprovision$/i, '') : '',
      plistPath = path.join(iosDir, 'build', 'exportOptions.plist'),
      plist = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>method</key>',
        '  <string>' + method + '</string>',
        '  <key>stripSwiftSymbols</key>',
        '  <true/>',
        '  <key>compileBitcode</key>',
        '  <false/>',
        teamId ? '  <key>teamID</key>' : '',
        teamId ? '  <string>' + teamId + '</string>' : '',
        profileName ? '  <key>provisioningProfiles</key>' : '',
        profileName ? '  <dict>' : '',
        profileName ? '    <key>' + config.appId + '</key>' : '',
        profileName ? '    <string>' + profileName + '</string>' : '',
        profileName ? '  </dict>' : '',
        '</dict>',
        '</plist>',
      ].filter(Boolean).join('\n');
    fs.writeFileSync(plistPath, plist, 'utf-8'); // 生成 exportOptions.plist

    console.log('  xcodebuild -exportArchive ...');
    run('xcodebuild', [
      '-exportArchive',
      '-archivePath', archivePath,
      '-exportOptionsPlist', plistPath,
      '-exportPath', exportDir,
    ], { cwd: iosDir });

    // 找 .ipa
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.ipa'));
    if (files.length === 0) throw new Error('导出目录里没有 .ipa: ' + exportDir);
    return path.join(exportDir, files[0]);
  };

export { ensureMac, checkIosTools, podInstall, xcodebuildArchive, xcodebuildExport };