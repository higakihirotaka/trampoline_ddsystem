const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT      = process.env.PORT || 3000;
const PUBLIC    = path.join(__dirname, 'public');
const QIRA_HOST = 'localhost';
const QIRA_PORT = 8080;
const MIME    = {
    html : 'text/html',
    css  : 'text/css',
    js   : 'text/javascript',
    json : 'application/json',
    tsv  : 'text/tab-separated-values',
    png  : 'image/png',
    jpg  : 'image/jpeg',
    svg  : 'image/svg+xml',
};

// QIRA プロキシ: ブラウザからのリクエストを QIRA HTTP サーバーに中継
function proxyToQira(qiraPath, res) {
    const options = { hostname: QIRA_HOST, port: QIRA_PORT, path: qiraPath, method: 'GET' };
    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'QIRA unreachable', detail: e.message }));
    });
    proxyReq.end();
}

http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;

    // ---- QIRA API プロキシ ----
    if (pathname === '/api/qira/result') { proxyToQira('/routineresult', res); return; }
    if (pathname === '/api/qira/state')  { proxyToQira('/state',         res); return; }
    if (pathname === '/api/qira/health') { proxyToQira('/health',        res); return; }

    // ---- 静的ファイル ----
    let filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);

    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
    }

    const ext         = path.extname(filePath).slice(1);
    const contentType = MIME[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));

}).listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}/`);
    console.log(`📡 QIRA proxy: /api/qira/* → http://${QIRA_HOST}:${QIRA_PORT}`);
});
