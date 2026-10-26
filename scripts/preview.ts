import path from 'node:path';
import { buildExtension } from './package.ts';

// Serves the preview build (bun run preview builds it first) with the extension's restrictions.
const root = path.resolve(import.meta.dir, '../dist/preview');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function startPreview({ port = 4173 } = {}) {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(request) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      try {
        const pathname = decodeURIComponent(new URL(request.url).pathname);
        const filename = path.resolve(root, '.' + (pathname === '/' ? '/extension/planner.html' : pathname));
        if (!filename.startsWith(root + path.sep)) throw new Error('Not found');
        const relative = '/' + path.relative(root, filename).split(path.sep).join('/');
        if (!relative.startsWith('/extension/') && !relative.startsWith('/tests/browser')) throw new Error('Not found');
        const data = await Bun.file(filename).arrayBuffer();
        return new Response(request.method === 'HEAD' ? null : data, { headers: {
          'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src ${relative.startsWith('/tests/') ? "'self' 'unsafe-inline'" : "'self'"}; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src ${relative === '/tests/browser-mobile.html' ? "'self'" : "'none'"}; base-uri 'none'`,
        } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  });
}

if (import.meta.main) {
  await buildExtension('preview');
  const server = startPreview();
  console.log(`Loghmeh planner demo: http://localhost:${server.port}/extension/planner.html`);
}
