<script lang="ts">
  import { Activity, FileText, RefreshCw, FlaskConical, BookOpen, Plug } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import Dialog from './Dialog.svelte';
  import Palette from './Palette.svelte';
  import PlacePicker from './PlacePicker.svelte';
  import Wallet from './Wallet.svelte';
  import WeekCalendar from './WeekCalendar.svelte';
  import { createExtensionClient } from '../lib/client.ts';
  import { PlannerController } from '../lib/planner-controller.ts';
  import { DemoDiningService, RESTAURANTS, type DemoServerState } from '../lib/planner-demo.ts';
  import { LiveDiningService } from '../lib/planner-live.ts';
  import { PlannerModel, addDays, menuKey, type PlannerState } from '../lib/planner-model.ts';
  import { calendarClock, restoreCalendarWeek } from '../lib/planner-view.ts';
  import { errorDetails } from '../lib/transport.ts';
  import type { Restaurant } from '../lib/types.ts';

  const api = globalThis.browser ?? globalThis.chrome;
  const EXPIRED = ['login-required', 'redirect-required', 'reconnect-required', 'account-changed'];
  const extensionApi = api?.runtime?.id ? api : undefined;
  const isLive = Boolean(extensionApi) && new URLSearchParams(location.search).get('demo') !== '1';
  const sessionClient = extensionApi ? createExtensionClient(extensionApi) : null;
  const pageUrl = (page: string) => extensionApi?.runtime.getURL(page) ?? page;

  const startClock = calendarClock();
  let clock = $state(startClock);
  const storageKey = `loghmeh:planner-demo:v1:${startClock.today}`;
  const calendarStorageKey = `loghmeh:${isLive ? 'live' : 'demo'}:calendar-week:v1`;
  let saved: { model?: PlannerState; server?: DemoServerState } | null = null;
  try { if (!isLive) saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { /* Local persistence is optional. */ }
  const live = isLive ? new LiveDiningService(extensionApi!) : null;
  const demo = isLive ? null : new DemoDiningService({ today: startClock.today, saved: saved?.server });
  const service = (live ?? demo)!;
  let restaurants: Restaurant[] = isLive ? [] : RESTAURANTS;
  let activeWeek = $state(startClock.nextWeek);
  try { activeWeek = restoreCalendarWeek(localStorage, calendarStorageKey, startClock.nextWeek); } catch { /* Storage is optional. */ }

  // The model and controller are plain objects; every controller change bumps the revision
  // that components derive their view from.
  let model = $state.raw<PlannerModel>();
  let controller = $state.raw<PlannerController>();
  let revision = $state(0);
  let accountTag: string | null = null;
  let connecting = $state(false);
  const connection = $state({ visible: isLive, message: 'Connecting to your dining session…', retryLabel: 'Connect dining', liveLabel: 'Connect dining' });
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout>;
  let lastMessage = '';
  let reportJson = $state('');
  let placePicker = $state<PlacePicker>();
  let simulation = $state<Dialog>();
  let report = $state<Dialog>();

  const issue = $derived.by(() => { void revision; return model?.issueFor(model.activeId) ?? null; });
  const demoFlags = $derived.by(() => { void revision; return { failNextSave: demo?.failNextSave, failNextRead: demo?.failNextRead }; });

  function persist(current: PlannerModel) {
    try {
      if (live) localStorage.setItem('loghmeh:live:palette:v1', JSON.stringify({ selectedIds: current.selectedIds, activeId: current.activeId }));
      else localStorage.setItem(storageKey, JSON.stringify({ model: current.exportState(), server: demo!.exportState() }));
    } catch { /* State remains usable in memory if storage is disabled or full. */ }
  }

  function changed() {
    if (!model || !controller) return;
    if (live) {
      const expired = [...model.loads.values(), ...model.saves.values()].find(state => EXPIRED.includes(state.code ?? ''));
      if (expired) {
        live.writable = false;
        connection.visible = true;
        connection.message = `${expired.message} Your pending choices stay in this tab.`;
      }
    }
    if (controller.message && controller.message !== lastMessage) {
      lastMessage = toast = controller.message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast = ''; }, 6000);
    }
    persist(model);
    revision++;
  }

  function initializeCalendar(preferences: Partial<PlannerState>) {
    const selectedIds = (preferences.selectedIds || []).filter(id => restaurants.some(restaurant => restaurant.id === id));
    if (!selectedIds.length) selectedIds.push(isLive ? restaurants[0].id : 'kooy', ...(!isLive ? ['engineering', 'garden'] : []));
    model = new PlannerModel({ restaurants, balanceRials: service.balanceRials, selectedIds,
      activeId: preferences.activeId, drafts: isLive ? [] : preferences.drafts, menus: isLive ? [] : preferences.menus });
    controller = new PlannerController({ model, service, onChange: changed });
    controller.showWeek(activeWeek);
  }

  function showWeek(week: string) {
    if (week === activeWeek) return;
    activeWeek = week;
    try { localStorage.setItem(calendarStorageKey, week); } catch { /* Storage is optional. */ }
    controller?.showWeek(week);
  }

  function refreshCalendarClock() {
    const next = calendarClock();
    if (next.today !== clock.today || next.currentMeal !== clock.currentMeal) clock = next;
  }

  async function connectDining() {
    if (!live || !sessionClient || connecting) return;
    connecting = true;
    connection.visible = true;
    connection.message = 'Connecting and discovering your eligible restaurants…';
    try {
      if (!await sessionClient.hasPermission() && !await sessionClient.requestPermission()) throw new Error('Allow dining access to connect your browser session.');
      const result = await live.connect();
      if (model && accountTag !== result.accountTag) {
        live.writable = false;
        throw new Error('The signed-in account changed. Open a new Loghmeh tab to start with that account. Your old drafts stay here.');
      }
      if (model && model.selectedIds.some(id => !result.restaurants.some(restaurant => restaurant.id === id))) {
        live.writable = false;
        throw new Error('Your eligible restaurants changed. Open a new Loghmeh tab to choose from the updated list. Drafts stay here.');
      }
      accountTag = result.accountTag;
      restaurants = result.restaurants;
      if (!model || !controller) {
        let preferences;
        try { preferences = JSON.parse(localStorage.getItem('loghmeh:live:palette:v1') ?? 'null'); } catch { /* Start with one place. */ }
        initializeCalendar(preferences || {});
      } else {
        model.balanceRials = result.balanceRials;
        model.restaurants = new Map(restaurants.map(restaurant => [restaurant.id, restaurant]));
        controller.cancelReads(() => true);
        model.loads.clear();
        if (controller.running?.kind === 'read') {
          const { restaurantId, week } = controller.running;
          model.loads.set(menuKey(restaurantId, week!), { restaurantId, week: week!, state: 'loading' });
        }
        for (const [id, state] of model.saves) if (EXPIRED.includes(state.code ?? '')) model.saves.delete(id);
        controller.showWeek(activeWeek);
      }
      connection.liveLabel = 'Live · Refresh';
      connection.visible = !result.writable;
      connection.message = result.writeReason;
    } catch (error) {
      connection.message = errorDetails(error).message;
      connection.retryLabel = connection.liveLabel = 'Reconnect dining';
    } finally {
      connecting = false;
      revision++;
    }
  }

  function openReport() {
    reportJson = JSON.stringify(live?.connectionReport(), null, 2);
    report?.open();
  }

  function resetDemo() {
    localStorage.removeItem(storageKey);
    location.reload();
  }

  if (!isLive) initializeCalendar(saved?.model || {});

  onMount(() => {
    if (isLive) connectDining();
    const timer = setInterval(refreshCalendarClock, 60_000);
    return () => clearInterval(timer);
  });
</script>

<svelte:window onbeforeunload={event => {
  if (live && model?.changes().length) { event.preventDefault(); event.returnValue = ''; }
}} />
<svelte:document onvisibilitychange={() => { if (!document.hidden) refreshCalendarClock(); }} />

<header class="app-shell">
  <div class="topbar">
    <a class="brand" href={pageUrl('planner.html')}><img src={pageUrl('icon.svg')} width="30" height="30" alt=""><span>loghmeh <span lang="fa">لقمه</span></span></a>
    <div class="topbar-actions">
      <a href={pageUrl('probe.html')} aria-label="Connection probe" title="Connection probe"><Activity size={18} aria-hidden="true" /></a>
      {#if live}
        <a href={pageUrl('planner.html?demo=1')} aria-label="Sample menus" title="Sample menus"><BookOpen size={18} aria-hidden="true" /></a>
        <button class="live-label" aria-label="Report" title="Connection report" onclick={openReport}><FileText size={18} aria-hidden="true" /></button>
        <button class="live-label" disabled={connecting} aria-label={connection.liveLabel} title={connection.liveLabel} onclick={connectDining}><RefreshCw size={18} class={connecting ? 'spinning' : ''} aria-hidden="true" /></button>
      {:else}
        {#if extensionApi}<a href={pageUrl('planner.html')} aria-label="Connect dining" title="Connect dining"><Plug size={18} aria-hidden="true" /></a>{/if}
        <button class="demo-label" aria-label="Interactive demo" title="Interactive demo" onclick={() => simulation?.open()}><FlaskConical size={18} aria-hidden="true" /></button>
      {/if}
    </div>
  </div>
  {#if live}
    <div class="live-connection" role="status" hidden={!connection.visible}>
      <p>{connection.message}</p>
      <div>
        <button class="plain-primary" disabled={connecting} onclick={connectDining}>{connection.retryLabel}</button>
        <button class="undo-button" onclick={() => sessionClient?.openLogin()}>Open dining login</button>
      </div>
    </div>
  {/if}
</header>

{#if model && controller}
  <div class="budget-header">
    <Wallet {model} {controller} {live} {revision} />
  </div>

  <main class="calendar-main" aria-label="Meal calendar">
    <div class="planner-warning" role="alert" hidden={!issue}>{issue ?? ''}</div>
    <div class="weeks">
      <WeekCalendar {model} {controller} {revision} week={activeWeek} today={clock.today} currentMeal={clock.currentMeal}
        onprevious={() => showWeek(addDays(activeWeek, -7))} onnext={() => showWeek(addDays(activeWeek, 7))} />
    </div>
    <Palette {model} {controller} {revision} week={activeWeek} onadd={() => placePicker?.open()} />
  </main>
  <PlacePicker bind:this={placePicker} {model} {controller} {revision} />
{/if}

{#if live}
  <Dialog bind:this={report} id="connection-report" title="Connection report" closeLabel="Close connection report">
    <p class="dialog-intro">Request results only. No passwords, cookies, balances, food names, or account identifiers.</p>
    <textarea class="report-json" readonly aria-label="Connection report JSON" value={reportJson}></textarea>
  </Dialog>
{:else if demo}
  <Dialog bind:this={simulation} id="simulation" eyebrow="Try the awkward bits" title="A safe little sandbox." closeLabel="Close simulation controls">
    <p class="dialog-intro">All menus, money, and submissions here are fictional. Nothing is sent to the university.</p>
    <label class="simulation-option">Request speed<select onchange={event => { demo.delayMs = Number(event.currentTarget.value); }}>
      <option value="150">Quick</option><option value="650" selected>Realistic</option><option value="1800">Very slow</option>
    </select></label>
    <label class="simulation-check"><input type="checkbox" checked={demoFlags.failNextSave}
      onchange={event => { demo.failNextSave = event.currentTarget.checked; revision++; }}> Reject the next submission</label>
    <label class="simulation-check"><input type="checkbox" checked={demoFlags.failNextRead}
      onchange={event => { demo.failNextRead = event.currentTarget.checked; revision++; }}> Fail the next menu request</label>
    <p class="simulation-rule">Sample rule: one student meal per slot. A supplementary meal uses a separate entitlement, so both can appear together.</p>
    <button class="danger-link" onclick={resetDemo}>Reset sample data and local drafts</button>
  </Dialog>
{/if}
<div class="toast" role="status" aria-live="polite" hidden={!toast}>{toast}</div>
