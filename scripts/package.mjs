import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dir, '..');

export async function buildPackage() {
  const extension = path.join(root, 'extension');
  const { version } = await Bun.file(path.join(extension, 'manifest.json')).json();
  const files = {};
  for (const filename of [...new Bun.Glob('**/*').scanSync({ cwd: extension, dot: true })].sort()) {
    const entry = filename.split(path.sep).join('/');
    files[entry] = await Bun.file(path.join(extension, filename)).bytes();
  }
  files.LICENSE = await Bun.file(path.join(root, 'LICENSE')).bytes();
  return { version, bytes: zipSync(files, { level: 6 }) };
}

if (import.meta.main) {
  const { version, bytes } = await buildPackage();
  const destination = path.join(root, 'dist', `loghmeh-${version}.zip`);
  await Bun.write(destination, bytes);
  console.log(destination);
}
