<script lang="ts">
  import { Activity, FileText, RefreshCw, FlaskConical, BookOpen, Plug, Pause, Play } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import Dialog from './Dialog.svelte';
  import ConnectionPanel from './ConnectionPanel.svelte';
  import ConnectionMotion from './ConnectionMotion.svelte';
  import ErrorBanner from './ErrorBanner.svelte';
  import Steam from './Steam.svelte';
  import Palette from './Palette.svelte';
  import PlacePicker from './PlacePicker.svelte';
  import Wallet from './Wallet.svelte';
  import WeekCalendar from './WeekCalendar.svelte';
  import { createDiningAccessClient } from '../lib/client.ts';
  import { PlannerController, type PlannerFailure } from '../lib/planner-controller.ts';
  import { DemoDiningService, RESTAURANTS, type DemoServerState } from '../lib/planner-demo.ts';
  import { LiveDiningService } from '../lib/planner-live.ts';
  import { PlannerModel, addDays, menuKey, type PlannerState } from '../lib/planner-model.ts';
  import { calendarClock, formatDay, restoreCalendarWeek } from '../lib/planner-view.ts';
  import { ProbeError } from '../lib/transport.ts';
  import { ConnectionController } from '../lib/connection-state.ts';
  import { revealPlanner } from '../lib/connection-handoff.ts';
  import type { Restaurant } from '../lib/types.ts';

  const api = globalThis.browser ?? globalThis.chrome;
  const EXPIRED = ['login-required', 'redirect-required', 'reconnect-required', 'account-changed', 'background-unavailable'];
  const extensionApi = api?.runtime?.id ? api : undefined;
  const isLive = !__LOGHMEH_PREVIEW__ || Boolean(extensionApi) && new URLSearchParams(location.search).get('demo') !== '1';
  const sessionClient = extensionApi ? createDiningAccessClient(extensionApi) : null;
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
  interface ErrorNotice { id: number; title: string; message: string; context?: string; week?: string; code?: string; restaurantId?: string; source?: 'connection' }
  let errors = $state<ErrorNotice[]>([]);
  let errorSequence = 0;

  function showError(title: string, failure: { message: string; code?: string; source?: 'connection' }, context?: string, week?: string, restaurantId?: string) {
    errors = [...errors, { id: ++errorSequence, title, ...failure, context, week, restaurantId }];
    // Public messages only: never log HTTP bodies, tokens, or the original exception.
    console.error(`[Loghmeh] ${title}: ${failure.message}`, { code: failure.code });
  }

  function plannerError(failure: PlannerFailure) {
    const title = failure.code === 'save-unknown' ? 'Save outcome not verified'
      : { load: 'Menu could not be loaded', save: 'Changes could not be fully saved', edit: 'Could not make that change' }[failure.operation];
    const restaurant = failure.restaurantId ? model?.restaurants.get(failure.restaurantId)?.name : undefined;
    const week = failure.week ? `Week of ${formatDay(failure.week, 'short')}` : undefined;
    showError(title, { message: failure.message, code: failure.code }, restaurant, week, failure.restaurantId);
  }

  const connectionController = new ConnectionController({
    connect: performConnection,
    openDining: () => sessionClient!.openLogin(),
    changed: () => {
      revision++;
      if (['connected', 'read-only'].includes(connectionController.state.phase)) errors = errors.filter(error => error.source !== 'connection');
    },
    onError: failure => showError('Dining connection failed', { ...failure, source: 'connection' }),
  });
  const connection = $derived.by(() => { void revision; return { ...connectionController.state, opening: connectionController.opening }; });
  const connecting = $derived(connection.phase === 'checking');
  let plannerEntered = $state(!isLive);
  let motionPaused = $state(false);
  let welcomeArt = $state<HTMLDivElement>();
  let brandMark = $state<HTMLSpanElement>();
  $effect(() => {
    if (model && ['connected', 'read-only'].includes(connection.phase)) plannerEntered = true;
  });
  const liveLabel = $derived(connecting ? 'Checking dining connection' : connection.phase === 'connected' ? 'Dining connected · Refresh' : 'Check dining connection');
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
    errors = errors.filter(error => error.code !== 'save-unknown' || !error.restaurantId || controller!.uncertainSaves.has(error.restaurantId));
    if (live) {
      if (live.sessionVerified && ['save-unknown', 'background-unavailable'].includes(connectionController.state.code ?? '')) {
        connectionController.verified(live);
      }
      const failures = [...model.loads.values(), ...model.saves.values()];
      const expired = failures.find(state => EXPIRED.includes(state.code ?? ''))
        ?? (!live.sessionVerified ? failures.find(state => state.state === 'error' || state.state === 'unknown') : undefined);
      if (expired) {
        live.writable = false;
        connectionController.invalidate(expired.code, expired.message ?? 'The dining session needs to be checked again.');
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
    controller = new PlannerController({ model, service, onChange: changed, onError: plannerError });
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

  async function performConnection(interactive: boolean) {
    if (!live || !sessionClient) throw new Error('The dining connection is available inside the extension.');
    live.writable = false;
    try {
      if (!await sessionClient.hasPermission() && (!interactive || !await sessionClient.requestPermission())) {
        throw new ProbeError('permission-required', 'Allow dining access to connect your browser session.');
      }
      const result = await live.connect();
      if (model && accountTag !== result.accountTag) {
        live.writable = false;
        throw new ProbeError('account-changed', 'The signed-in account changed. Open a new Loghmeh tab to start with that account. Your old drafts stay here.');
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
      return result;
    } catch (error) {
      live.sessionVerified = false;
      live.writable = false;
      live.writeReason = 'Check your dining connection before saving. Your pending choices stay in this tab.';
      throw error;
    } finally {
      revision++;
    }
  }

  async function connectDining() {
    const fromWelcome = !plannerEntered && Boolean(document.activeElement?.closest('.connection-screen'));
    await connectionController.check(true);
    await tick();
    if (fromWelcome && plannerEntered) document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }

  function returnToPlanner() {
    if (document.hidden) return;
    refreshCalendarClock();
    connectionController.returned();
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
    if (isLive) connectionController.check();
    const timer = setInterval(refreshCalendarClock, 60_000);
    return () => { clearInterval(timer); clearTimeout(toastTimer); };
  });
</script>

<svelte:window onfocus={returnToPlanner} onbeforeunload={event => {
  if (live && model?.changes().length) { event.preventDefault(); event.returnValue = ''; }
}} />
<svelte:document onvisibilitychange={returnToPlanner} />

<header class="app-shell">
  <div class="topbar">
    <a class="brand" href={pageUrl('planner.html')}>
      {#if live}<span class="brand-mark" bind:this={brandMark}><img class:arrived={plannerEntered} src={pageUrl('icon.svg')} width="30" height="30" alt=""></span>
      {:else}<img src={pageUrl('icon.svg')} width="30" height="30" alt="">{/if}
      <span>loghmeh <span lang="fa">لقمه</span></span>
    </a>
    <div class="topbar-actions">
      {#if __LOGHMEH_PREVIEW__}
        <a href={pageUrl('probe.html')} aria-label="Connection probe" title="Connection probe"><Activity size={18} aria-hidden="true" /></a>
      {/if}
      {#if live}
        <button class="live-label motion-toggle" aria-label={motionPaused ? 'Resume connection animation' : 'Pause connection animation'}
          title={motionPaused ? 'Resume animation' : 'Pause animation'} aria-pressed={motionPaused} onclick={() => motionPaused = !motionPaused}>
          {#if motionPaused}<Play size={15} aria-hidden="true" />{:else}<Pause size={15} aria-hidden="true" />{/if}
        </button>
        {#if __LOGHMEH_PREVIEW__}<a href={pageUrl('planner.html?demo=1')} aria-label="Sample menus" title="Sample menus"><BookOpen size={18} aria-hidden="true" /></a>{/if}
        <button class="live-label" aria-label="Report" title="Connection report" onclick={openReport}><FileText size={18} aria-hidden="true" /></button>
        <button class="live-label" disabled={connecting} aria-label={liveLabel} title={liveLabel} onclick={connectDining}>{#if connecting}<Steam size={18} />{:else}<RefreshCw size={18} aria-hidden="true" />{/if}</button>
      {:else if __LOGHMEH_PREVIEW__}
        {#if extensionApi}<a href={pageUrl('planner.html')} aria-label="Connect dining" title="Connect dining"><Plug size={18} aria-hidden="true" /></a>{/if}
        <button class="demo-label" aria-label="Interactive demo" title="Interactive demo" onclick={() => simulation?.open()}><FlaskConical size={18} aria-hidden="true" /></button>
      {/if}
    </div>
  </div>
</header>

{#if live && !plannerEntered}
  <ConnectionPanel state={connection} opening={connection.opening} paused={motionPaused} bind:artTarget={welcomeArt}
    oncheck={connectDining} onopen={() => connectionController.openDining()} onreport={openReport} />
{/if}

{#if model && controller && plannerEntered}
  <div class="planner-workspace" use:revealPlanner={!live || motionPaused}>
  <div class="budget-header">
    <Wallet {model} {controller} {live} {revision} />
  </div>

  {#if live && !['connected', 'checking'].includes(connection.phase)}
    <ConnectionPanel state={connection} compact opening={connection.opening}
      oncheck={connectDining} onopen={() => connectionController.openDining()} onreport={openReport} />
  {/if}
  <main class="calendar-main" aria-label="Meal calendar" tabindex="-1">
    <div class="planner-warning" role="alert" hidden={!issue}>{issue ?? ''}</div>
    <div class="weeks">
      <WeekCalendar {model} {controller} {revision} week={activeWeek} today={clock.today} currentMeal={clock.currentMeal}
        onprevious={() => showWeek(addDays(activeWeek, -7))} onnext={() => showWeek(addDays(activeWeek, 7))} />
    </div>
    <Palette {model} {controller} {revision} week={activeWeek} onadd={() => placePicker?.open()} />
  </main>
  </div>
  <PlacePicker bind:this={placePicker} {model} {controller} {revision} />
{/if}

{#if live}
  <ConnectionMotion phase={connection.phase} docked={plannerEntered} paused={motionPaused}
    welcome={welcomeArt} brand={brandMark} logo={pageUrl('icon.svg')} />
  <span class="sr-only" role="status">{connection.phase === 'connected' ? 'Dining connected. Your planner is ready.' : connecting && plannerEntered ? 'Checking your dining session. Your planner stays available.' : ''}</span>
{/if}

{#if live}
  <Dialog bind:this={report} id="connection-report" title="Connection report" closeLabel="Close connection report">
    <p class="dialog-intro">Request results only. No passwords, cookies, balances, food names, or account identifiers.</p>
    <textarea class="report-json" readonly aria-label="Connection report JSON" value={reportJson}></textarea>
  </Dialog>
{:else if __LOGHMEH_PREVIEW__ && demo}
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
{#if errors.length}
  {#key errors[0].id}
    <ErrorBanner {...errors[0]} queued={errors.length - 1} ondismiss={() => { errors = errors.slice(1); }} />
  {/key}
{/if}
<div class="toast" role="status" aria-live="polite" hidden={!toast || errors.length > 0}>{toast}</div>
