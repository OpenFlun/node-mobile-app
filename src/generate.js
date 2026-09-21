import fs from 'fs';
import path from 'path';
import { writeIfChanged } from './utils.js';

/**
 * 生成 main.js（桥接代码，用户不需要手写）
 *
 * 上报机制（通过 rn-bridge channel 发消息给 App.tsx）：
 *   - 'Node started on <URL>'  server.js 成功调用 listen
 *   - 'Node failed: <原因>'    加载异常或 5 秒内未捕获 listen
 */
const generateMainJs = (targetDir, config, moduleType) => {
  const entry = config.serverPath.startsWith('./') ? config.serverPath : './' + config.serverPath,
    entryLabel = config.serverPath, hb = config.advanced.heartbeatInterval,
    body = `const rn_bridge = require('rn-bridge');
    const net = require('net'), https = require('https'), USER_ENTRY = ${JSON.stringify(entry)},
     ENTRY_LABEL = ${JSON.stringify(entryLabel)}, START_TIMEOUT_MS = 5000;

    let resolved = false;
    function emitUrl(url) {
      if (resolved) return;
      resolved = true;
      console.log('[node-mobile-app] server URL: ' + url);
      rn_bridge.channel.send('Node started on ' + url);
    }

    function emitFailure(reason, detail) {
      if (resolved) return;
      resolved = true;
      const msg = detail ? (reason + ' -- ' + detail) : reason;
      console.log('[node-mobile-app] failed: ' + msg);
      rn_bridge.channel.send('Node failed: ' + msg);
    }

    rn_bridge.channel.send('Node was initialized.');
    process.on('uncaughtException', (err) => {
      console.error('Uncaught Exception:', err);
      emitFailure('未捕获异常', err && err.message);
    });
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled Rejection:', reason);
      emitFailure('未处理的 Promise rejection', String(reason));
    });

    // 拦截 net.Server.prototype.listen，捕获协议和真实端口
    const origListen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) {
      const server = this;
      if (!resolved) {
        server.once('listening', () => {
          try {
            const addr = server.address(), port = (addr && typeof addr === 'object') ? addr.port : addr,
             protocol = (server instanceof https.Server) ? 'https' : 'http';
            emitUrl(protocol + '://127.0.0.1:' + port);
          } catch (e) { /* 等超时 */ }
        });
      }
      return origListen.apply(this, args);
    };

    // 5 秒超时兜底
    setTimeout(() => {
      if (resolved) return;
      emitFailure('Node 服务 5 秒内未启动', '请检查 ' + ENTRY_LABEL + ' 是否调用了 listen()');
    }, START_TIMEOUT_MS);

    // 加载用户入口
    (async () => {
      try {
        await import(USER_ENTRY);
      } catch (err) {
        emitFailure('加载 ' + ENTRY_LABEL + ' 失败', err && err.message);
      }
    })();

    ${config.advanced.keepAlive === false ? '// keepAlive: false — 不发送心跳' : "setInterval(() => rn_bridge.channel.send('heartbeat'), " + hb + ");"}

    rn_bridge.channel.on('message', (msg) => {
      rn_bridge.channel.send('Echo: ' + msg);
    });`,
    header = moduleType === 'module'
      ? `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);\n\n` : '',
    file = path.join(targetDir, 'main.js'), changed = writeIfChanged(file, header + body);
  console.log(changed ? '  ✓ 已生成 main.js' : '  ✓ main.js 无变化');
},
  generateRuntime = (buildDir, config) => {
    const data = {
      showLoading: config.webview.showLoading,
      loadingText: config.webview.loadingText,
      webview: {
        enableJavaScript: config.webview.enableJavaScript,
        enableDomStorage: config.webview.enableDomStorage,
        allowFileAccess: config.webview.allowFileAccess,
        mixedContentMode: config.webview.mixedContentMode,
        backgroundColor: config.webview.backgroundColor,
      },
    }, content = `// 自动生成，请勿手改\nexport default ${JSON.stringify(data, null, 2)} as const;\n`,
      changed = writeIfChanged(path.join(buildDir, 'mobileApp.runtime.ts'), content);
    console.log(changed ? '  ✓ 已生成 mobileApp.runtime.ts' : '  ✓ mobileApp.runtime.ts 无变化');
  }

export { generateMainJs, generateRuntime };