const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT    = process.env.PORT || 3000;
const PUBLIC  = path.join(__dirname, 'public');
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

http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;
    let filePath   = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);

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
});
