<script lang="ts">
  import { onMount } from 'svelte';
  import { createDemoClient } from '../demo.ts';
  import { createExtensionClient } from '../lib/client.ts';
  import type { parseMenu } from '../lib/parser.ts';
  import { publicError } from '../lib/transport.ts';
  import type { Diagnostic } from '../lib/types.ts';

  type Option = { id: string; name: string };
  const api = globalThis.browser ?? globalThis.chrome;
  const isExtension = ['moz-extension:', 'chrome-extension:'].includes(location.protocol);
  const client = isExtension ? createExtensionClient(api!) : createDemoClient(new URLSearchParams(location.search).get('scenario'));
  const report = $state({ app: 'Loghmeh', version: isExtension ? api!.runtime.getManifest!().version : '0.6.0', environment: client.mode,
    sessionVerified: false, menuVerified: false, checks: [] as Record<string, unknown>[] });
  let busy = $state(false);
  let permission = $state(false);
  let connected = $state(false);
  let status = $state('Starting…');
  let error = $state('');
  let badge = $state<{ text: string; state?: 'connected' | 'failed' }>({ text: 'Not checked' });
  let groups = $state<{ options: Option[]; placeholder: string; value: string }>({ options: [], placeholder: 'Check your connection first', value: '' });
  let restaurants = $state<{ options: Option[]; placeholder: string; value: string }>({ options: [], placeholder: 'Choose a group first', value: '' });
  let menuStatus = $state('');
  let menu = $state<ReturnType<typeof parseMenu>>();
  let copyLabel = $state('Copy report');
  let reportArea: HTMLTextAreaElement;
  const reportJson = $derived(JSON.stringify(report, null, 2));

  const choose = (options: Option[], placeholder: string, preferred?: string) =>
    ({ options, placeholder, value: options.some(option => option.id === preferred) ? preferred! : options[0]?.id ?? '' });

  function record(diagnostic: Diagnostic, extra: Record<string, unknown> = {}) {
    report.checks.push({ ...diagnostic, ...extra });
  }

  async function run(operation: string, action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try { await action(); } catch (caught) {
      const safe = publicError(caught);
      error = safe.message;
      const failedOperation = safe.diagnostic?.operation || operation;
      record({ ...safe.diagnostic, operation: failedOperation }, { result: safe.code });
      if (safe.code === 'login-required' || safe.code === 'permission-required') {
        connected = false;
        report.sessionVerified = false;
        report.menuVerified = false;
        badge = { text: safe.code === 'login-required' ? 'Sign in needed' : 'Access needed', state: 'failed' };
        if (safe.code === 'permission-required') permission = false;
      }
      if (failedOperation === 'bootstrap' && !connected) {
        status = 'Connection has not been verified.';
        badge = { text: 'Not verified', state: 'failed' };
      }
      if (operation === 'menu') menuStatus = 'This menu read did not complete. Any previous result is kept below.';
    } finally { busy = false; }
  }

  async function loadRestaurants() {
    restaurants = choose([], 'Loading places…');
    const result = await client.restaurants(groups.value);
    restaurants = choose(result.restaurants, 'No restaurants returned');
    record(result.diagnostic, { result: 'passed', restaurantCount: result.restaurants.length });
  }

  const checkSession = () => run('bootstrap', async () => {
    connected = false;
    report.sessionVerified = false;
    report.menuVerified = false;
    status = 'Checking your dining session…';
    const result = await client.bootstrap();
    connected = true;
    report.sessionVerified = isExtension;
    report.menuVerified = false;
    badge = { text: isExtension ? 'Session reused' : 'Demo session', state: 'connected' };
    status = `${result.groups.length} ${result.groups.length === 1 ? 'group' : 'groups'} found${isExtension ? ' using your existing browser session' : ' in fictional sample data'}.`;
    groups = choose(result.groups, 'No eligible groups returned', result.selectedGroupId);
    record(result.diagnostic, { result: 'passed', groupCount: result.groups.length });
    if (groups.value) await loadRestaurants();
  });

  const readMenu = () => run('menu', async () => {
    report.menuVerified = false;
    menuStatus = 'Reading one menu…';
    const result = await client.menu(groups.value, restaurants.value);
    menu = result;
    report.menuVerified = isExtension;
    menuStatus = `${isExtension ? 'Authenticated menu read passed.' : 'Fictional menu parsed.'} ${result.rawChoiceCount} checkbox nodes → ${result.choices.length} unique options.${result.choices.length ? '' : ' This week has no food options.'}`;
    record(result.diagnostic, { result: 'passed', rawChoiceCount: result.rawChoiceCount, uniqueChoiceCount: result.choices.length,
      reservedCount: result.reservedCount, disabledCount: result.disabledCount });
  });

  function openLogin() {
    client.openLogin().catch(() => { error = 'Could not open dining. Open https://dining2.ut.ac.ir/Reserves in this browser.'; });
  }

  function grantAccess() {
    // Keep the permission request directly in a user gesture.
    client.requestPermission().then(granted => {
      permission = granted;
      status = granted ? 'Dining access allowed. Ready to check.' : 'Dining access was not granted.';
    }).catch(() => { status = 'Enable dining access in the extension’s permissions, then reopen Loghmeh.'; });
  }

  async function copyReport() {
    try { await navigator.clipboard.writeText(reportJson); copyLabel = 'Copied'; }
    catch { reportArea.focus(); reportArea.select(); copyLabel = 'Report selected — copy manually'; }
  }

  onMount(async () => {
    try {
      permission = await client.hasPermission();
      status = permission ? 'Ready when you are.' : 'Allow access to dining to run the check.';
    } catch {
      status = 'Could not start the extension. Reload it in about:debugging.';
    }
  });
</script>

{#snippet select(label: string, list: typeof groups, onchange: (value: string) => void)}
  <label>{label}<select disabled={busy || !connected || !list.value} dir="auto" value={list.value}
    onchange={event => onchange(event.currentTarget.value)}>
    {#each list.options as option (option.id)}<option value={option.id}>{option.name}</option>{:else}<option value="">{list.placeholder}</option>{/each}
  </select></label>
{/snippet}

<main>
  <header>
    <a class="brand" href="probe.html"><img src="icon.svg" alt="" width="40" height="40"><span>loghmeh<span class="persian" lang="fa">لقمه</span></span></a>
    <a href="planner.html">Try the weekly planner →</a>
  </header>
  <div class="notice" hidden={isExtension}>Local preview · fictional sample data. This does not test your browser login.</div>
  <section class="intro">
    <p class="eyebrow">A SMALL FIRST BITE</p>
    <h1>Let’s check the connection.</h1>
    <p>Use your existing dining login to read one menu. Your reservations stay as they are.</p>
  </section>

  <section class="card" aria-labelledby="connection-title">
    <div class="section-heading"><span class="step">1</span><h2 id="connection-title">Your dining session</h2><span class="badge" data-state={badge.state}>{badge.text}</span></div>
    <p>Sign in to dining in this browser, then check that Loghmeh can use the session.</p>
    <div class="actions">
      <button class="primary" disabled={busy || !permission} onclick={checkSession}>Check connection</button>
      <button class="secondary" hidden={!isExtension} onclick={openLogin}>Open dining login ↗</button>
      <button class="secondary" hidden={permission || !isExtension} onclick={grantAccess}>Allow dining access</button>
    </div>
    <p class="status" role="status" aria-live="polite">{status}</p>
    <p class="error" role="alert" hidden={!error}>{error}</p>
  </section>

  <section class="card" aria-labelledby="menu-title">
    <div class="section-heading"><span class="step">2</span><h2 id="menu-title">Read a menu</h2></div>
    <p>Choose one place. This reads the server’s currently selected week and does not advance it.</p>
    <div class="fields">
      {@render select('Group', groups, value => { groups.value = value; run('restaurants', loadRestaurants); })}
      {@render select('Restaurant', restaurants, value => { restaurants.value = value; })}
    </div>
    <button class="primary" disabled={busy || !connected || !restaurants.value} onclick={readMenu}>Read menu</button>
    <p class="status" role="status" aria-live="polite">{menuStatus}</p>
    {#if menu}
      <div>
        <div class="stats">
          <div><strong>{menu.choices.length}</strong><span>food options</span></div>
          <div><strong>{menu.reservedCount}</strong><span>already reserved</span></div>
          <div><strong>{menu.disabledCount}</strong><span>locked by dining</span></div>
        </div>
        <p id="week-dates" dir="auto">{menu.dates[0]} → {menu.dates.at(-1)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Date · ISO</th><th>Meal</th><th>Food</th><th>Price · rials</th><th>State</th></tr></thead>
          <tbody>
            {#each menu.choices as choice (choice.serverKey)}
              <tr>
                {#each [choice.date, choice.meal, choice.name, choice.priceRials === null ? 'See dining' : choice.priceRials.toLocaleString('en-US'),
                  [choice.reserved ? 'Reserved' : 'Not reserved', choice.disabled ? 'Locked' : ''].filter(Boolean).join(' · ')] as value, index (index)}
                  <td dir="auto">{value}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table></div>
      </div>
    {/if}
  </section>

  <details class="card diagnostics">
    <summary>Connection report</summary>
    <p>Contains only check results and counts. No passwords, cookies, student details, or raw server pages.</p>
    <textarea bind:this={reportArea} readonly aria-label="Connection report" spellcheck="false" value={reportJson}></textarea>
    <button class="secondary" onclick={copyReport}>{copyLabel}</button>
  </details>
  <footer>Loghmeh · No university reservation submissions, cancellations, or payments.</footer>
</main>
