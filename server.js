const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT        = process.env.PORT || 3000;
const PUBLIC      = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'qira-config.json');
const MIME    = {
    html : 'text/html',
    css  : 'text/css',
    js   : 'text/javascript',
    json : 'application/json',
    tsv  : 'text/tab-separated-values',
    png  : 'image/png',
    jpg  : 'image/jpeg',
    svg  : 'image/svg+xml',
    woff2: 'font/woff2',
};

// QIRA 接続先（起動時に qira-config.json から読み込み、/api/config で動的変更可能）
function loadQiraConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
    return { host: 'localhost', port: 8080 };
}
let qiraConfig = loadQiraConfig();
console.log(`📡 QIRA proxy → http://${qiraConfig.host}:${qiraConfig.port}`);

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };

// QIRA プロキシ: ブラウザからのリクエストを QIRA HTTP サーバーに中継
function proxyToQira(qiraPath, res) {
    const options = { hostname: qiraConfig.host, port: qiraConfig.port, path: qiraPath, method: 'GET' };
    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
        res.writeHead(503, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({ error: 'QIRA unreachable', detail: e.message }));
    });
    proxyReq.end();
}

http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS); res.end(); return;
    }

    // ---- QIRA 設定 API ----
    if (pathname === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify(qiraConfig)); return;
    }
    if (pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            try {
                const cfg = JSON.parse(body);
                if (cfg.host) qiraConfig.host = cfg.host;
                if (cfg.port) qiraConfig.port = parseInt(cfg.port);
                fs.writeFileSync(CONFIG_FILE, JSON.stringify(qiraConfig, null, 2));
                console.log(`📡 QIRA proxy updated → http://${qiraConfig.host}:${qiraConfig.port}`);
                res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
                res.end(JSON.stringify({ ok: true, config: qiraConfig }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
                res.end(JSON.stringify({ error: e.message }));
            }
        }); return;
    }

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
