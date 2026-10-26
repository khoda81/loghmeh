<script lang="ts">
  import type { PlannerController } from '../lib/planner-controller.ts';
  import type { PlannerModel } from '../lib/planner-model.ts';
  import { restaurantStatus } from '../lib/planner-view.ts';

  let { model, controller, week, revision, onadd }: {
    model: PlannerModel; controller: PlannerController; week: string; revision: number; onadd: () => void;
  } = $props();
  let palette: HTMLElement;
  let scrolledTo: string | undefined;

  const v = $derived.by(() => {
    void revision;
    return {
      activeId: model.activeId,
      activeColor: model.restaurants.get(model.activeId)!.color,
      single: model.selectedIds.length === 1,
      places: model.selectedIds.map(id => ({ id, restaurant: model.restaurants.get(id)!, status: restaurantStatus(model, id, week) })),
    };
  });

  $effect(() => {
    document.documentElement.style.setProperty('--active-color', v.activeColor);
  });

  // Keep a newly active place visible inside the scrollable palette without moving the page.
  $effect(() => {
    if (v.activeId === scrolledTo) return;
    scrolledTo = v.activeId;
    const selected = palette.querySelector<HTMLElement>('.place-token.active');
    if (!selected) return;
    const top = selected.offsetTop;
    const bottom = top + selected.offsetHeight;
    if (top < palette.scrollTop) palette.scrollTop = top;
    else if (bottom > palette.scrollTop + palette.clientHeight) palette.scrollTop = bottom - palette.clientHeight;
  });
</script>

<div class="palette-row">
  <div class="palette" role="group" aria-label="Restaurants" bind:this={palette}>
    {#each v.places as { id, restaurant, status } (id)}
      <div class="place-token" class:active={id === v.activeId} class:has-error={status.error} style:--restaurant-color={restaurant.color}>
        <button class="place-pill" data-restaurant-id={id} aria-pressed={id === v.activeId}
          aria-label={[restaurant.name, status.text || status.title].filter(Boolean).join(' · ')}
          title={[restaurant.name, status.title].filter(Boolean).join('\n')}
          onclick={() => controller.select(id)}>
          <span class={status.busy ? 'spinner' : 'color-dot'}></span>
          <span class="pill-name" dir="auto">{restaurant.name}</span>
          <span class="pill-status" class:error={status.error}>{status.text}</span>
        </button>
        {#if status.error}
          <button class="retry-pill" aria-label="Retry {restaurant.shortName}" onclick={() => controller.retry(id)}>Retry</button>
        {/if}
        <button class="place-remove" aria-label="Remove {restaurant.shortName} from your palette" disabled={v.single}
          onclick={() => controller.remove(id)}>×</button>
      </div>
    {/each}
  </div>
  <button class="add-place" aria-haspopup="dialog" aria-label="Add a restaurant" onclick={onadd}><span aria-hidden="true">+</span><span class="add-place-label">Add a restaurant</span></button>
</div>
