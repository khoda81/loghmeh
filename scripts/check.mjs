import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkDirectory(filename);
    else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
}
await checkDirectory('extension');
await checkDirectory('scripts');
await checkDirectory('tests');
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.deepEqual(manifest.host_permissions, ['https://dining2.ut.ac.ir/*']);
assert.equal(manifest.permissions, undefined);
assert.equal(manifest.background.type, 'module');
assert.deepEqual(manifest.background.scripts, ['background.mjs']);
for (const file of ['background.mjs', 'probe.html', 'probe.mjs', 'probe.css', 'icon.svg']) await readFile(`extension/${file}`);
console.log('Syntax and Firefox manifest checks passed. One host; no cookie, storage, or tabs API permissions.');
