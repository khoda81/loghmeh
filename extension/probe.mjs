import { createExtensionClient } from './lib/client.mjs';
import { publicError } from './lib/transport.mjs';

const $ = id => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const isExtension = ['moz-extension:', 'chrome-extension:'].includes(location.protocol);
const client = isExtension ? createExtensionClient(api)
  : (await import('./demo.mjs')).createDemoClient(new URLSearchParams(location.search).get('scenario'));
const report = { app: 'Loghmeh', version: isExtension ? api.runtime.getManifest().version : '0.4.0', environment: client.mode, sessionVerified: false, menuVerified: false, checks: [] };
let busy = false;
let permission = false;
let connected = false;

function updateReport() { $('report').value = JSON.stringify(report, null, 2); }
function controls() {
  $('check-session').disabled = busy || !permission;
  $('read-menu').disabled = busy || !connected || !$('restaurant').value;
  $('group').disabled = busy || !connected || !$('group').value;
  $('restaurant').disabled = busy || !connected || !$('restaurant').value;
  $('grant-access').hidden = permission || !isExtension;
}
function options(element, entries, placeholder) {
  element.replaceChildren();
  if (!entries.length) element.add(new Option(placeholder, ''));
  for (const entry of entries) element.add(new Option(entry.name, entry.id));
}
function record(diagnostic, extra = {}) {
  report.checks.push({ ...diagnostic, ...extra });
  updateReport();
}
async function run(operation, action) {
  if (busy) return;
  busy = true;
  $('error').hidden = true;
  controls();
  try { await action(); } catch (error) {
    const safe = publicError(error);
    $('error').textContent = safe.message;
    $('error').hidden = false;
    const failedOperation = safe.diagnostic?.operation || operation;
    record({ ...safe.diagnostic, operation: failedOperation, result: safe.code });
    if (safe.code === 'login-required' || safe.code === 'permission-required') {
      connected = false;
      report.sessionVerified = false;
      report.menuVerified = false;
      $('connection-badge').textContent = safe.code === 'login-required' ? 'Sign in needed' : 'Access needed';
      $('connection-badge').dataset.state = 'failed';
      if (safe.code === 'permission-required') permission = false;
    }
    if (failedOperation === 'bootstrap' && !connected) {
      $('connection-status').textContent = 'Connection has not been verified.';
      $('connection-badge').textContent = 'Not verified';
      $('connection-badge').dataset.state = 'failed';
    }
    if (operation === 'menu') $('menu-status').textContent = 'This menu read did not complete. Any previous result is kept below.';
    updateReport();
  } finally { busy = false; controls(); }
}
async function loadRestaurants() {
  options($('restaurant'), [], 'Loading places…');
  const result = await client.restaurants($('group').value);
  options($('restaurant'), result.restaurants, 'No restaurants returned');
  record(result.diagnostic, { result: 'passed', restaurantCount: result.restaurants.length });
}

$('check-session').addEventListener('click', () => run('bootstrap', async () => {
  connected = false;
  report.sessionVerified = false;
  report.menuVerified = false;
  $('connection-status').textContent = 'Checking your dining session…';
  const result = await client.bootstrap();
  connected = true;
  report.sessionVerified = isExtension;
  report.menuVerified = false;
  $('connection-badge').textContent = isExtension ? 'Session reused' : 'Demo session';
  $('connection-badge').dataset.state = 'connected';
  $('connection-status').textContent = `${result.groups.length} ${result.groups.length === 1 ? 'group' : 'groups'} found${isExtension ? ' using your existing browser session' : ' in fictional sample data'}.`;
  options($('group'), result.groups, 'No eligible groups returned');
  if (result.groups.some(group => group.id === result.selectedGroupId)) $('group').value = result.selectedGroupId;
  record(result.diagnostic, { result: 'passed', groupCount: result.groups.length });
  if ($('group').value) await loadRestaurants();
}));
$('group').addEventListener('change', () => run('restaurants', loadRestaurants));
$('restaurant').addEventListener('change', controls);
$('read-menu').addEventListener('click', () => run('menu', async () => {
  report.menuVerified = false;
  $('menu-status').textContent = 'Reading one menu…';
  const result = await client.menu($('group').value, $('restaurant').value);
  $('choice-count').textContent = result.choices.length;
  $('reserved-count').textContent = result.reservedCount;
  $('locked-count').textContent = result.disabledCount;
  $('week-dates').textContent = `${result.dates[0]} → ${result.dates.at(-1)}`;
  const rows = result.choices.map(choice => {
    const row = document.createElement('tr');
    const values = [choice.date, choice.meal, choice.name,
      choice.priceRials === null ? 'See dining' : choice.priceRials.toLocaleString('en-US'),
      [choice.reserved ? 'Reserved' : 'Not reserved', choice.disabled ? 'Locked' : ''].filter(Boolean).join(' · ')];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      cell.dir = 'auto';
      row.append(cell);
    }
    return row;
  });
  $('foods').replaceChildren(...rows);
  $('menu-result').hidden = false;
  report.menuVerified = isExtension;
  $('menu-status').textContent = `${isExtension ? 'Authenticated menu read passed.' : 'Fictional menu parsed.'} ${result.rawChoiceCount} checkbox nodes → ${result.choices.length} unique options.${result.choices.length ? '' : ' This week has no food options.'}`;
  record(result.diagnostic, { result: 'passed', rawChoiceCount: result.rawChoiceCount, uniqueChoiceCount: result.choices.length,
    reservedCount: result.reservedCount, disabledCount: result.disabledCount });
}));
$('open-login').addEventListener('click', () => client.openLogin().catch(() => {
  $('error').textContent = 'Could not open dining. Open https://dining2.ut.ac.ir/Reserves in this browser.';
  $('error').hidden = false;
}));
$('grant-access').addEventListener('click', () => {
  // Keep the permission request directly in a user gesture.
  client.requestPermission().then(granted => {
    permission = granted;
    $('connection-status').textContent = granted ? 'Dining access allowed. Ready to check.' : 'Dining access was not granted.';
    controls();
  }).catch(() => {
    $('connection-status').textContent = 'Enable dining access in the extension’s permissions, then reopen Loghmeh.';
  });
});
$('copy-report').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('report').value); $('copy-report').textContent = 'Copied'; }
  catch { $('report').focus(); $('report').select(); $('copy-report').textContent = 'Report selected — copy manually'; }
});

$('preview-notice').hidden = isExtension;
if (!isExtension) { $('open-login').hidden = true; }
try {
  permission = await client.hasPermission();
  $('connection-status').textContent = permission ? 'Ready when you are.' : 'Allow access to dining to run the check.';
} catch {
  $('connection-status').textContent = 'Could not start the extension. Reload it in about:debugging.';
}
updateReport();
controls();
