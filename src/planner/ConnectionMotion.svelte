<script lang="ts">
  import { connectionMotionState, type ConnectionMotionState } from '../lib/connection-motion.ts';
  import { placeConnection } from '../lib/connection-handoff.ts';
  import type { ConnectionPhase } from '../lib/connection-state.ts';
  import { SaffronOrbit } from '../lib/saffron-orbit.ts';

  let { phase, docked, paused, welcome, brand, logo }: {
    phase: ConnectionPhase; docked: boolean; paused: boolean;
    welcome?: HTMLElement; brand?: HTMLElement; logo: string;
  } = $props();
  let available = $state(true);
  const motion = $derived(connectionMotionState(phase));

  function animate(canvas: HTMLCanvasElement, options: { state: ConnectionMotionState; paused: boolean }) {
    const context = canvas.getContext('2d');
    if (!context) {
      available = false;
      return;
    }
    const orbit = new SaffronOrbit(canvas, context, options.state);
    orbit.setPaused(options.paused);
    return {
      update(next: typeof options) { orbit.setState(next.state); orbit.setPaused(next.paused); },
      destroy() { orbit.destroy(); },
    };
  }
</script>

<div class="connection-motion" class:docked use:placeConnection={{ welcome, brand, docked, paused, phase }}
  data-motion-state={motion} data-motion-paused={paused} data-motion-docked={docked} aria-hidden="true">
  <div class="connection-scene">
    <canvas use:animate={{ state: motion, paused }}></canvas>
    {#if !available}<img src={logo} width="100" height="100" alt="" />{/if}
  </div>
</div>

<style>
  .connection-motion { position: absolute; top: 0; left: 0; z-index: 11; visibility: hidden; overflow: hidden; pointer-events: none; }
  .docked { z-index: 31; }
  .connection-scene { position: absolute; top: 0; left: 0; width: 400px; height: 300px; transform-origin: 0 0; }
  canvas { display: block; width: 400px; height: 300px; }
  img { position: absolute; top: 128px; left: 150px; }
</style>
