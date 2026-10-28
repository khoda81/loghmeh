<script lang="ts">
  import { Pause, Play } from '@lucide/svelte';
  import { connectionMotionState, type ConnectionMotionState } from '../lib/connection-motion.ts';
  import type { ConnectionPhase } from '../lib/connection-state.ts';
  import { SaffronOrbit } from '../lib/saffron-orbit.ts';

  let { phase, compact = false, logo, onsettled }: {
    phase: ConnectionPhase; compact?: boolean; logo: string; onsettled(): void;
  } = $props();
  let paused = $state(false);
  let available = $state(true);
  const motion = $derived(connectionMotionState(phase));

  function animate(canvas: HTMLCanvasElement, options: { state: ConnectionMotionState; paused: boolean }) {
    const context = canvas.getContext('2d');
    if (!context) {
      available = false;
      // Canvas is decorative; its availability cannot hold up the planner.
      let timer: ReturnType<typeof setTimeout>;
      const update = (next: typeof options) => {
        clearTimeout(timer);
        if (next.state === 'connected') timer = setTimeout(() => onsettled(), 1800);
      };
      update(options);
      return { update, destroy: () => clearTimeout(timer) };
    }
    const orbit = new SaffronOrbit(canvas, context, options.state, () => onsettled());
    orbit.setPaused(options.paused);
    return {
      update(next: typeof options) { orbit.setState(next.state); orbit.setPaused(next.paused); },
      destroy() { orbit.destroy(); },
    };
  }
</script>

<div class="connection-motion" class:compact data-motion-state={motion} data-motion-paused={paused}>
  <canvas use:animate={{ state: motion, paused }} aria-hidden="true"></canvas>
  {#if !available}<img src={logo} width="72" height="72" alt="" />{/if}
  {#if available}
    <button class="motion-toggle" onclick={() => paused = !paused} aria-pressed={paused}
      aria-label={paused ? 'Resume connection animation' : 'Pause connection animation'}
      title={paused ? 'Resume animation' : 'Pause animation'}>
      {#if paused}<Play size={13} aria-hidden="true" />{:else}<Pause size={13} aria-hidden="true" />{/if}
    </button>
  {/if}
</div>

<style>
  .connection-motion { position: relative; width: 100%; height: 190px; overflow: hidden; border-radius: 12px; background: var(--paper); }
  canvas { display: block; width: 100%; height: 100%; }
  img { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
  .motion-toggle { position: absolute; bottom: 7px; right: 7px; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 50%; background: var(--surface); color: #586553; }
  .motion-toggle:hover { border-color: #aa7848; color: var(--ink); }
  .compact { height: 108px; }
  .compact .motion-toggle { bottom: 3px; right: 3px; width: 26px; height: 26px; }
  @media (prefers-reduced-motion: reduce) { .motion-toggle { display: none; } }
</style>
