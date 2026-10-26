import assert from 'node:assert/strict';
import path from 'node:path';

// Type checking runs separately (svelte-check and tsc); this guards the manifest's permissions.
const root = path.resolve(import.meta.dir, '..');
const manifest = await Bun.file(path.join(root, 'src/manifest.json')).json();
assert.deepEqual(manifest.host_permissions, ['https://dining2.ut.ac.ir/*']);
assert.equal(manifest.permissions, undefined);
assert.equal(manifest.background.type, 'module');
assert.deepEqual(manifest.background.scripts, ['background.js']);
for (const file of ['background.ts', 'probe.html', 'probe.ts', 'probe.css', 'planner.html', 'planner.ts', 'planner.css', 'icon.svg']) {
  assert.ok(await Bun.file(path.join(root, 'src', file)).exists(), `Missing extension file: ${file}`);
}
assert.equal((await Bun.file(path.join(root, 'package.json')).json()).version, manifest.version);
console.log('Firefox manifest checks passed. One host; no cookie, storage, or tabs API permissions.');
