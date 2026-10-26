<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let { id, title, eyebrow, closeLabel, children }: {
    id: string; title: string; eyebrow?: string; closeLabel: string; children: Snippet;
  } = $props();
  let dialog: HTMLDialogElement;
  let scrollY = 0;

  // showModal() scrolls the page toward the dialog; the calendar stays where it was.
  export function open() {
    scrollY = window.scrollY;
    dialog.showModal();
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }

  export function close() { dialog.close(); }
</script>

<dialog {id} bind:this={dialog} aria-labelledby="{id}-title" onclose={() => window.scrollTo(0, scrollY)}>
  <div class="panel-heading">
    {#if eyebrow}
      <div><p class="eyebrow">{eyebrow}</p><h2 id="{id}-title">{title}</h2></div>
    {:else}
      <h2 id="{id}-title">{title}</h2>
    {/if}
    <button class="icon-button" aria-label={closeLabel} onclick={close}><X size={22} aria-hidden="true" /></button>
  </div>
  {@render children()}
</dialog>
