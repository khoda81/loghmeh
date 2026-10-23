import { expect, test } from 'bun:test';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { startPreview } from '../scripts/preview.mjs';
import { buildPackage } from '../scripts/package.mjs';

const root = path.resolve(import.meta.dir, '..');

test('the Bun preview serves unchanged extension files with the sample-mode network restrictions', async () => {
  const server = startPreview({ port: 0 });
  try {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(await Bun.file(path.join(root, 'extension/planner.html')).text());
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    expect(page.headers.get('Content-Security-Policy')).toContain("connect-src 'none'");
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-src 'none'");
    const frame = await fetch(new URL('/tests/browser-mobile.html', server.url));
    expect(frame.headers.get('Content-Security-Policy')).toContain("frame-src 'self'");
    await frame.text();
    const head = await fetch(new URL('/extension/planner.mjs', server.url), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toContain('text/javascript');
    expect(await head.text()).toBe('');
  } finally {
    await server.stop(true);
  }
});

test('the Bun preview refuses writes and paths outside its normalized file allowlist', async () => {
  const server = startPreview({ port: 0 });
  try {
    for (const pathname of ['/package.json', '/work/private.html', '/extension/%2e%2e%2fpackage.json', '/extension/%ff', '/extension/lib/']) {
      const response = await fetch(new URL(pathname, server.url));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found');
    }
    const write = await fetch(server.url, { method: 'POST', body: 'sample' });
    expect(write.status).toBe(405);
    expect(write.headers.get('Allow')).toBe('GET, HEAD');
    await write.text();
  } finally {
    await server.stop(true);
  }
});

test('the Bun packager produces the complete Firefox ZIP with source bytes and the license only', async () => {
  const { version, bytes } = await buildPackage();
  const files = unzipSync(bytes);
  const expected = ['LICENSE', 'background.mjs', 'demo.mjs', 'icon.svg',
    'lib/background-bridge.mjs', 'lib/client.mjs', 'lib/dining-session.mjs', 'lib/live-parser.mjs',
    'lib/parser.mjs', 'lib/planner-controller.mjs', 'lib/planner-demo.mjs', 'lib/planner-live.mjs',
    'lib/planner-model.mjs', 'lib/signed-balance.mjs', 'lib/transport.mjs',
    'manifest.json', 'planner.css', 'planner.html', 'planner.mjs', 'probe.css', 'probe.html', 'probe.mjs'];
  expect(Object.keys(files).sort()).toEqual(expected.sort());
  for (const name of expected) {
    const source = name === 'LICENSE' ? path.join(root, name) : path.join(root, 'extension', name);
    expect(files[name]).toEqual(await Bun.file(source).bytes());
  }
  expect(JSON.parse(new TextDecoder().decode(files['manifest.json'])).version).toBe(version);
});
