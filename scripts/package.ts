import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { build } from 'vite';

const root = path.resolve(import.meta.dir, '..');
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
type Manifest = Record<string, any>;

// dist/build/ is the Firefox build as loaded from about:debugging; Chrome gets a derived manifest.
export const TARGETS: Record<string, { includes(name: string): boolean; manifest: ((manifest: Manifest) => Manifest) | null }> = {
  firefox: {
    includes: name => !name.startsWith('offscreen.') && !name.startsWith('icons/'),
    manifest: null,
  },
  chrome: {
    includes: () => true,
    manifest: ({ browser_specific_settings: _gecko, background, ...manifest }) => ({
      ...manifest,
      minimum_chrome_version: '116', // runtime.getContexts for the offscreen page reader.
      permissions: ['offscreen'],
      background: { service_worker: background.scripts[0], type: background.type },
      action: { ...manifest.action, default_icon: icons },
      icons,
    }),
  },
};

// AMO reviews bundled add-ons against the source and these build instructions.
const SOURCE_FILES = ['{extension,scripts,tests}/**/*', 'package.json', 'bun.lock', 'tsconfig.json', 'vite.config.ts', 'README.md', 'PRIVACY.md', 'LICENSE'];
const PRIVATE_SOURCES = /^tests\/browser-private\//u;

export async function buildExtension(mode = 'production') {
  await build({ configFile: path.join(root, 'vite.config.ts'), mode, logLevel: 'warn' });
  return path.join(root, mode === 'preview' ? 'dist/preview' : 'dist/build');
}

async function readTree(directory: string, includes: (name: string) => boolean = () => true) {
  const files: Record<string, Uint8Array> = {};
  for (const filename of [...new Bun.Glob('**/*').scanSync({ cwd: directory, dot: true })].sort()) {
    const entry = filename.split(path.sep).join('/');
    if (includes(entry)) files[entry] = await Bun.file(path.join(directory, filename)).bytes();
  }
  return files;
}

// Packages the current dist/build output; run buildExtension() first.
export async function buildPackage(target = 'firefox') {
  const { includes, manifest } = TARGETS[target];
  const files = await readTree(path.join(root, 'dist/build'), includes);
  const source: Manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if (manifest) files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest(source), null, 2) + '\n');
  files.LICENSE = await Bun.file(path.join(root, 'LICENSE')).bytes();
  return { version: source.version as string, files, bytes: zipSync(files, { level: 6 }) };
}

export async function buildSourcePackage() {
  const files: Record<string, Uint8Array> = {};
  for (const pattern of SOURCE_FILES) {
    for (const filename of new Bun.Glob(pattern).scanSync({ cwd: root, dot: false })) {
      const entry = filename.split(path.sep).join('/');
      if (!PRIVATE_SOURCES.test(entry)) files[entry] = await Bun.file(path.join(root, filename)).bytes();
    }
  }
  return zipSync(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))), { level: 6 });
}

if (import.meta.main) {
  await buildExtension();
  for (const target of Object.keys(TARGETS)) {
    const { version, files, bytes } = await buildPackage(target);
    // The unpacked copy is what Chrome's "Load unpacked" and web-ext sign read.
    const unpacked = path.join(root, 'dist', target);
    await rm(unpacked, { recursive: true, force: true });
    await mkdir(unpacked, { recursive: true });
    for (const [name, data] of Object.entries(files)) await Bun.write(path.join(unpacked, name), data);
    const destination = path.join(root, 'dist', `loghmeh-${version}-${target}.zip`);
    await Bun.write(destination, bytes);
    console.log(destination);
  }
  const { version } = await Bun.file(path.join(root, 'package.json')).json();
  const destination = path.join(root, 'dist', `loghmeh-${version}-source.zip`);
  await Bun.write(destination, await buildSourcePackage());
  console.log(destination);
}
