import { beforeAll, expect, test } from 'bun:test';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { startPreview } from '../scripts/preview.ts';
import { buildExtension, buildPackage, buildSourcePackage } from '../scripts/package.ts';

const root = path.resolve(import.meta.dir, '..');
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

beforeAll(async () => {
  await buildExtension();
  await buildExtension('preview');
}, 60_000);

test('the Bun preview serves the built pages with the sample-mode network restrictions', async () => {
  const server = startPreview({ port: 0 });
  try {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(await Bun.file(path.join(root, 'dist/preview/src/planner.html')).text());
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    expect(page.headers.get('Content-Security-Policy')).toContain("connect-src 'none'");
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-src 'none'");
    const frame = await fetch(new URL('/tests/browser-mobile.html', server.url));
    expect(frame.headers.get('Content-Security-Policy')).toContain("frame-src 'self'");
    await frame.text();
    const head = await fetch(new URL('/src/probe.js', server.url), { method: 'HEAD' });
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
    for (const pathname of ['/package.json', '/work/private.html', '/src/%2e%2e%2fpackage.json', '/src/%ff', '/src/chunks/']) {
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

const entries = ['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'manifest.json', 'background.js', 'icon.svg', 'planner.html', 'planner.js', 'planner.css', 'probe.html', 'probe.js', 'probe.css'];
const chromeOnly = ['offscreen.html', 'offscreen.js', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'];

// Every page script, stylesheet, image, font, and module import must resolve inside the package.
function expectSelfContained(files: Record<string, Uint8Array>) {
  for (const [name, bytes] of Object.entries(files)) {
    const references = name.endsWith('.html') ? [...decode(bytes).matchAll(/(?:src|href)="([^"]+)"/gu)].map(match => match[1])
      : name.endsWith('.js') ? [...decode(bytes).matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/gu)].map(match => match[1])
      : name.endsWith('.css') ? [...decode(bytes).matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gu)].map(match => match[1]) : [];
    if (name.endsWith('.css')) {
      for (const reference of references) expect(reference).not.toMatch(/^(?:[a-z]+:|\/\/)/iu);
    }
    for (const reference of references.filter(reference => !/^[a-z]+:|\?|^#/u.test(reference))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), reference));
      expect(files[target], `${name} → ${reference}`).toBeDefined();
    }
  }
}

test('the Firefox ZIP is the built extension without the Chrome page reader, plus the license', async () => {
  const { version, files } = await buildPackage('firefox');
  const built = [...new Bun.Glob('**/*').scanSync(path.join(root, 'dist/build'))].map(name => name.split(path.sep).join('/'));
  const names = Object.keys(files);
  expect(names.sort()).toEqual([...built.filter(name => !chromeOnly.includes(name)), 'LICENSE'].sort());
  for (const name of entries) expect(names).toContain(name);
  expect(names.filter(name => /\.(?:ts|svelte|mjs|map)$/u.test(name))).toEqual([]);
  for (const name of names.filter(name => name !== 'LICENSE')) expect(files[name]).toEqual(await Bun.file(path.join(root, 'dist/build', name)).bytes());
  expect(JSON.parse(decode(files['manifest.json'])).version).toBe(version);
  expectSelfContained(files);
});

test('the Chrome ZIP adds the offscreen page reader, PNG icons, and a service-worker manifest', async () => {
  const { version, files } = await buildPackage('chrome');
  for (const name of [...entries, ...chromeOnly]) expect(files[name]).toBeDefined();
  const manifest = JSON.parse(decode(files['manifest.json']));
  expect(manifest.version).toBe(version);
  expect(manifest.browser_specific_settings).toBeUndefined();
  expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
  expect(manifest.permissions).toEqual(['offscreen']);
  expect(manifest.host_permissions).toEqual(['https://dining2.ut.ac.ir/*']);
  for (const icon of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)] as string[]) expect(files[icon]).toBeDefined();
  expectSelfContained(files);
});

test('both extension packages include the local variable font and its license, with same-origin font loading', async () => {
  for (const target of ['firefox', 'chrome']) {
    const { files } = await buildPackage(target);
    const manifest = JSON.parse(decode(files['manifest.json']));
    expect(manifest.content_security_policy.extension_pages).toContain("font-src 'self'");
    expect(files['Estedad-VF.woff2']).toEqual(await Bun.file(path.join(root, 'src/fonts/Estedad-VF.woff2')).bytes());
    expect(decode(files['THIRD_PARTY_NOTICES.txt'])).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(decode(files['THIRD_PARTY_NOTICES.txt'])).toContain('Copyright 2022 The Estedad Project Authors');
    for (const page of ['planner', 'probe']) {
      const css = decode(files[`${page}.css`]);
      expect(css).toContain('Estedad-VF.woff2');
      expect(css).toMatch(/font-weight:\s*100 900/u);
    }
    expectSelfContained(files);
  }
});

test('the source ZIP has everything needed to rebuild, and nothing private or generated', async () => {
  const names = Object.keys(unzipSync(await buildSourcePackage()));
  for (const name of ['package.json', 'bun.lock', 'tsconfig.json', 'vite.config.ts', 'README.md', 'LICENSE', 'src/manifest.json', 'scripts/package.ts', 'src/fonts/Estedad-VF.woff2', 'src/fonts.css', 'src/THIRD_PARTY_NOTICES.txt']) {
    expect(names).toContain(name);
  }
  expect(names.filter(name => /^(?:dist|node_modules|work|outputs|tests\/browser-private)\//u.test(name))).toEqual([]);
});
