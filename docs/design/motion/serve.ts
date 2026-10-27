// Standalone motion studies only; never included in the browser extension.
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../../..');
const files: Record<string, [string, string]> = {
  '/': ['outputs/motion/gallery.html', 'text/html; charset=utf-8'],
  '/index.html': ['outputs/motion/gallery.html', 'text/html; charset=utf-8'],
  '/status.json': ['outputs/motion/gallery-status.json', 'application/json'],
  '/Estedad-VF.woff2': ['src/fonts/Estedad-VF.woff2', 'font/woff2'],
  '/icon.svg': ['src/icon.svg', 'image/svg+xml'],
};
const server = Bun.serve({
  hostname: Bun.env.LOGHMEH_MOTION_HOST ?? '127.0.0.1', port: Number(Bun.env.LOGHMEH_MOTION_PORT ?? 0),
  async fetch(request) {
    const entry = files[new URL(request.url).pathname];
    if (!entry || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    const file = Bun.file(path.join(root, entry[0]));
    if (!await file.exists()) {
      if (new URL(request.url).pathname === '/') return new Response('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Loghmeh motion studies</title><h1>The motion studies are still being generated</h1><p>This page refreshes every 10 seconds. <a href="/status.json">Check job status</a>.</p>', { status: 202, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      return new Response('Not found', { status: 404 });
    }
    return new Response(request.method === 'HEAD' ? null : file, { headers: {
      'Content-Type': entry[1], 'Cache-Control': 'no-store',
      // Inline scripts/styles are confined to the design study, with no network connections.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'",
    } });
  },
});
console.log(`Loghmeh motion studies: ${server.url.href}`);
