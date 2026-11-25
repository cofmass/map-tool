/* 极简静态文件服务器：仅用于本地开发预览，不用于生产 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const HOST = process.argv[3] || '0.0.0.0'; // 默认监听所有网卡，供手机局域网访问；可传 127.0.0.1 恢复仅本机

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([\\/])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, HOST, () => {
  console.log(`map-tool serving at http://localhost:${PORT} (listening on ${HOST})`);
  if (HOST === '0.0.0.0') {
    // 列出本机 IPv4 地址，方便手机直接访问
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  手机访问: http://${net.address}:${PORT}`);
      }
    }
  }
});
