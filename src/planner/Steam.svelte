<script lang="ts">
  import { onMount } from 'svelte';
  import { STEAM_DURATION, STEAM_STRANDS } from '../lib/steam.ts';

  let { size = 18 }: { size?: number } = $props();
  const gradient = $props.id();
  let reduced = $state(false);
  onMount(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced = preference.matches; };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  });
</script>

<svg class="steam" width={size} height={size} viewBox="0 0 64 80" fill="none" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id={gradient} x1="0" y1="80" x2="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="currentColor" stop-opacity="0" />
      <stop offset=".3" stop-color="currentColor" stop-opacity=".85" />
      <stop offset="1" stop-color="currentColor" stop-opacity="0" />
    </linearGradient>
  </defs>
  {#each STEAM_STRANDS as strand}
    <path d={strand.still} stroke="url(#{gradient})" stroke-width="1.1" stroke-linecap="round" vector-effect="non-scaling-stroke">
      {#if !reduced}<animate attributeName="d" values={strand.frames} dur={STEAM_DURATION} repeatCount="indefinite" />{/if}
    </path>
  {/each}
</svg>

<style>.steam { display: inline-block; vertical-align: middle; flex-shrink: 0; overflow: visible; }</style>
