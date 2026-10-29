<script lang="ts">
  import { ArrowUpRight, RefreshCw, ShieldCheck } from '@lucide/svelte';
  import { leaveWelcome } from '../lib/connection-handoff.ts';
  import Steam from './Steam.svelte';
  import type { ConnectionState } from '../lib/connection-state.ts';

  let { state, compact = false, opening, paused = false, artTarget = $bindable(), oncheck, onopen, onreport }: {
    state: ConnectionState; compact?: boolean; opening: boolean; paused?: boolean; artTarget?: HTMLDivElement;
    oncheck(): void; onopen(): void; onreport(): void;
  } = $props();

  const titles: Record<ConnectionState['phase'], string> = {
    checking: 'Checking your dining session', waiting: 'Come back when dining is ready',
    redirect: 'One quick visit to dining', login: 'Sign in on the dining website',
    network: 'Dining couldn’t be reached', permission: 'Allow access to dining',
    server: 'Dining returned an error', timeout: 'Dining took too long to respond',
    error: 'We couldn’t finish connecting', 'read-only': 'Connected, with limited access', connected: 'Dining is connected',
  };
  const descriptions: Partial<Record<ConnectionState['phase'], string>> = {
    checking: 'Checking access and discovering your eligible restaurants. Your planner will open when this finishes.',
    waiting: 'Open your reservations on the dining website, then return here. We’ll check your connection once when you come back.',
    redirect: 'Dining redirected our check, so we couldn’t verify your session. You may already be signed in — opening dining in this browser may be enough.',
    login: 'Dining returned a sign-in response. Complete sign-in in the university’s own tab, then return here.',
    permission: 'Loghmeh needs browser access to dining2.ut.ac.ir to use your existing session. Choose Allow dining access to continue.',
    connected: 'Your dining session is verified. Your planner is ready below.',
  };
  const busy = $derived(state.phase === 'checking');
  const titleId = $derived(compact ? 'connection-status-title' : 'connection-title');
  const visitFirst = $derived(['redirect', 'login', 'waiting'].includes(state.phase));
  const checkLabel = $derived(busy ? 'Checking…' : state.phase === 'permission' ? 'Allow dining access' : 'Check connection again');
  const checkedTime = $derived(state.checkedAt === null ? '' : new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tehran',
  }).format(state.checkedAt));
</script>

<section class:compact class="connection-screen" aria-labelledby={titleId} aria-busy={busy} out:leaveWelcome={{ paused, compact }}>
  <div class="connection-card">
    {#if !compact}<div class="connection-art" bind:this={artTarget} aria-hidden="true"></div>{/if}
    <div class="connection-copy" role="status" aria-live="polite" aria-atomic="true">
      <p class="connection-eyebrow">UNIVERSITY DINING {#if state.phase === 'read-only'}<ShieldCheck size={13} aria-hidden="true" />{/if}</p>
      <h1 id={titleId}>{titles[state.phase]}</h1>
      <p class="connection-description">{busy && compact ? 'Checking access and refreshing your eligible restaurants. Your existing planner stays below.' : descriptions[state.phase] ?? state.message}</p>
      {#if compact && state.phase !== 'read-only'}<p class="connection-preserved">Previously loaded menus may be out of date. Your pending choices stay in this tab.</p>{/if}
    </div>
    <div class="connection-actions">
      {#if visitFirst && state.phase !== 'waiting'}
        <button class="connection-primary" disabled={busy || opening} onclick={onopen}>Open dining website <ArrowUpRight size={16} aria-hidden="true" /></button>
        <button class="connection-secondary" disabled={busy} onclick={oncheck}><RefreshCw size={15} aria-hidden="true" />{checkLabel}</button>
      {:else}
        <button class="connection-primary" disabled={busy} onclick={oncheck}>
          {#if busy}<Steam size={16} />{:else}<RefreshCw size={16} aria-hidden="true" />{/if}
          {state.phase === 'waiting' ? 'I’m back · check connection' : checkLabel}
        </button>
        <button class="connection-secondary" disabled={busy || opening} onclick={onopen}>Open dining {state.phase === 'waiting' ? 'again' : 'website'} <ArrowUpRight size={15} aria-hidden="true" /></button>
      {/if}
    </div>
    <div class="connection-footer">
      <p>Your password stays with the university.</p>
      <div><span>{busy ? 'Checking now' : checkedTime ? `Last checked ${checkedTime} · Tehran` : 'Waiting for your return'}</span><button onclick={onreport}>Connection details</button></div>
    </div>
  </div>
</section>

<style>
  .connection-screen { min-height: calc(100dvh - 52px); display: grid; place-items: center; padding: 48px 24px 96px; }
  .connection-card { position: relative; width: min(100%, 530px); padding: 30px 38px 38px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: 0 18px 70px #263a2e06; }
  .connection-art { height: 206px; margin-bottom: 20px; }
  .connection-eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; color: #64725f; font-size: 10px; font-weight: 600; letter-spacing: 1.5px; }
  h1 { margin: 0; font-size: clamp(23px, 3vw, 28px); line-height: 1.45; font-weight: 600; letter-spacing: -.65px; }
  .connection-description { margin: 13px 0 0; color: #586553; font-size: 13px; line-height: 1.9; }
  .connection-preserved { margin: 12px 0 0; font-size: 12px; line-height: 1.8; color: #695b3b; }
  .connection-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 20px; margin-top: 28px; }
  .connection-primary, .connection-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 44px; font-size: 12px; }
  .connection-primary { padding: 11px 16px; background: var(--green); color: white; border: 1px solid var(--green); border-radius: 8px; }
  .connection-secondary { padding: 8px 0; background: transparent; color: #435d47; border: 0; }
  .connection-primary:disabled { opacity: .8; }
  .connection-footer { border-top: 1px solid var(--line); margin-top: 28px; padding-top: 18px; color: #64725f; font-size: 10px; line-height: 1.7; }
  .connection-footer p { margin: 0 0 12px; }
  .connection-footer > div { display: flex; gap: 12px; flex-wrap: wrap; justify-content: space-between; align-items: center; }
  .connection-footer button { background: transparent; border: 0; padding: 4px 0; color: #435d47; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
  .compact { min-height: 0; padding: 16px var(--page-gutter) 0; }
  .compact .connection-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'copy actions' 'footer footer'; gap: 0 24px; width: 100%; max-width: none; padding: 16px 20px; border-radius: 10px; box-shadow: none; border-left: 3px solid #aa7848; }
  .compact .connection-copy { grid-area: copy; }
  .compact .connection-actions { grid-area: actions; }
  .compact .connection-footer { grid-area: footer; }
  .compact h1 { font-size: 16px; letter-spacing: -.3px; }
  .compact .connection-eyebrow { display: none; }
  .compact .connection-description, .compact .connection-preserved { margin-top: 5px; font-size: 12px; }
  .compact .connection-actions { margin: 0; align-content: center; justify-content: end; }
  .compact .connection-footer { margin-top: 10px; padding-top: 8px; }
  .compact .connection-footer > p { display: none; }
  @media (max-width: 500px) {
    .connection-screen { padding: 30px 18px; align-items: start; }
    .connection-card { padding: 26px 22px; }
    .connection-art { margin-bottom: 22px; }
    .connection-actions { align-items: stretch; flex-direction: column; gap: 6px; }
    .connection-footer { font-size: 11px; }
    .compact { padding: 14px var(--page-gutter); }
    .compact .connection-card { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'copy' 'actions' 'footer'; row-gap: 12px; padding: 16px; }
    .compact .connection-actions, .compact .connection-footer { margin-top: 0; }
  }
</style>
