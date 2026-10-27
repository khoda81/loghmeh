<script lang="ts">
  import { CircleAlert, X } from '@lucide/svelte';
  import { onMount } from 'svelte';

  let { title, message, context, week, code, queued, ondismiss }: {
    title: string; message: string; context?: string; week?: string; code?: string; queued: number; ondismiss: () => void;
  } = $props();
  // Give longer messages more reading time. Each queued error gets its own timer.
  const duration = $derived(Math.max(12000, Math.min(24000, message.length * 65)));
  let elapsed = $state(0);
  let hovered = $state(false);
  let focused = $state(false);

  onMount(() => {
    let last = performance.now();
    const visibility = () => { last = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => {
      const now = performance.now();
      if (!hovered && !focused && !document.hidden && !document.querySelector('dialog[open]')) elapsed = Math.min(duration, elapsed + now - last);
      last = now;
      if (elapsed >= duration) ondismiss();
    }, 100);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  });
</script>

<section class="error-banner" role="alert" aria-atomic="true"
  onpointerenter={() => { hovered = true; }} onpointerleave={() => { hovered = false; }}
  onfocusin={() => { focused = true; }} onfocusout={event => { focused = event.currentTarget.contains(event.relatedTarget as Node | null); }}>
  <CircleAlert size={20} aria-hidden="true" />
  <div class="error-copy">
    <strong>{title}</strong>
    {#if context || week}<div class="error-context">{#if context}<bdi>{context}</bdi>{/if}{#if week}<span>{week}</span>{/if}</div>{/if}
    <p>{message}</p>
    <div class="error-footer">
      {#if code}<code>{code}</code>{/if}
      <span aria-hidden="true">{hovered || focused ? 'Timer paused' : `${Math.ceil((duration - elapsed) / 1000)}s`}{queued ? ` · ${queued} more` : ''}</span>
    </div>
  </div>
  <button class="dismiss-error" aria-label="Dismiss error" title="Dismiss error" onclick={ondismiss}><X size={18} aria-hidden="true" /></button>
  <div class="error-timer" aria-hidden="true"><span style:transform="scaleX({elapsed / duration})"></span></div>
</section>

<style>
  .error-banner { position: fixed; z-index: 40; bottom: 22px; left: 50%; transform: translateX(-50%); display: grid; grid-template-columns: 20px minmax(0, 1fr) 30px; gap: 12px; width: min(620px, calc(100% - 28px)); max-height: min(420px, 70dvh); overflow: auto; padding: 18px 16px 14px; background: #fff9f4; color: #713b2e; border: 1px solid #d7a390; border-radius: 12px; box-shadow: 0 8px 35px #572a2026; animation: appear .2s ease-out; }
  .error-banner > :global(svg) { margin-top: 2px; color: var(--danger); }
  .error-copy { min-width: 0; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
  strong { display: block; font-weight: 700; }
  .error-context { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 11px; color: #8c5e4f; margin-top: 2px; }
  p { margin: 7px 0 8px; }
  .error-footer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: #8c5e4f; font-size: 10px; }
  .error-footer > span { margin-left: auto; }
  code { font-size: 10px; }
  .dismiss-error { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; background: transparent; border-radius: 5px; color: inherit; }
  .dismiss-error:hover { background: #713b2e0d; }
  .error-timer { grid-column: 1 / -1; height: 3px; margin-top: 3px; border-radius: 2px; background: #ead7cc; overflow: hidden; }
  .error-timer span { display: block; width: 100%; height: 100%; background: #b5694e; transform-origin: left; transition: transform .1s linear; }
  @keyframes appear { from { opacity: 0; translate: 0 8px; } to { opacity: 1; translate: 0 0; } }
</style>
