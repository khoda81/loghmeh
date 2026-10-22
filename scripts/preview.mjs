import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? '/extension/probe.html' : pathname;
    if (!relative.startsWith('/extension/') && !relative.startsWith('/tests/browser')) throw new Error('Not found');
    const filename = path.resolve(root, '.' + relative);
    if (!filename.startsWith(root + path.sep)) throw new Error('Not found');
    const data = await readFile(filename);
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
    });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Loghmeh fixture preview: http://127.0.0.1:4173/extension/probe.html'));
