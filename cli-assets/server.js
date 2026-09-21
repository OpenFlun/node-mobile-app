// ============================================================
// 这是 @flun/node-mobile-app 自动生成的默认入口脚本。
// 请替换为你自己的 Node.js 启动脚本。
//
// 你可以：
//   1. 直接修改这个文件
//   2. 或用 mobileAppConfig.js 里的 serverPath 指向你自己的入口文件
// ============================================================
import http from 'http';

const PORT = 3000,
  html = `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Node Mobile App</title>
  <style>
  html,body{height:100%;margin:0;padding:0}
  body{display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;text-align:center;padding:24px;box-sizing:border-box}
  h1{margin:0 0 16px;font-size:28px;font-weight:600;letter-spacing:.5px}
  p{margin:0;font-size:16px;opacity:.9;line-height:1.5}
  .hint{margin-top:32px;font-size:13px;opacity:.65}
  </style>
  </head>
  <body>
  <h1>Hello from Node!</h1>
  <p>If you see this, it works.</p>
  <div class="hint">编辑 server.js 开始你的项目</div>
  </body>
  </html>`,

  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }), res.end(html);
  });

server.listen(PORT, '0.0.0.0', () => console.log(`Express started on port ${PORT}`));