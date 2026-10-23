import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const transpiler = new Bun.Transpiler({ loader: 'js' });
for (const filename of new Bun.Glob('{extension,scripts,tests}/**/*.mjs').scanSync(root)) {
  try {
    transpiler.transformSync(await Bun.file(path.join(root, filename)).text());
  } catch (cause) {
    throw new Error(`Syntax check failed: ${filename}`, { cause });
  }
}
const manifest = await Bun.file(path.join(root, 'extension/manifest.json')).json();
assert.deepEqual(manifest.host_permissions, ['https://dining2.ut.ac.ir/*']);
assert.equal(manifest.permissions, undefined);
assert.equal(manifest.background.type, 'module');
assert.deepEqual(manifest.background.scripts, ['background.mjs']);
for (const file of ['background.mjs', 'probe.html', 'probe.mjs', 'probe.css', 'planner.html', 'planner.mjs', 'planner.css', 'icon.svg']) {
  assert.ok(await Bun.file(path.join(root, 'extension', file)).exists(), `Missing extension file: ${file}`);
}
assert.equal((await Bun.file(path.join(root, 'package.json')).json()).version, manifest.version);
console.log('Syntax and Firefox manifest checks passed. One host; no cookie, storage, or tabs API permissions.');
