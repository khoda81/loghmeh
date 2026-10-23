import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dir, '..');
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));

// extension/ is the Firefox source as loaded from about:debugging; Chrome gets a derived manifest.
export const TARGETS = {
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

export async function buildPackage(target = 'firefox') {
  const { includes, manifest } = TARGETS[target];
  const extension = path.join(root, 'extension');
  const source = await Bun.file(path.join(extension, 'manifest.json')).json();
  const files = {};
  for (const filename of [...new Bun.Glob('**/*').scanSync({ cwd: extension, dot: true })].sort()) {
    const entry = filename.split(path.sep).join('/');
    if (includes(entry)) files[entry] = await Bun.file(path.join(extension, filename)).bytes();
  }
  if (manifest) files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest(source), null, 2) + '\n');
  files.LICENSE = await Bun.file(path.join(root, 'LICENSE')).bytes();
  return { version: source.version, files, bytes: zipSync(files, { level: 6 }) };
}

if (import.meta.main) {
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
}
