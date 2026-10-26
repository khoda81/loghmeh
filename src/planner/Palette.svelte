<script lang="ts">
  import { Plus, X, RefreshCw, CircleAlert } from '@lucide/svelte';
  import type { PlannerController } from '../lib/planner-controller.ts';
  import type { PlannerModel } from '../lib/planner-model.ts';
  import { restaurantStatus } from '../lib/planner-view.ts';

  let { model, controller, week, revision, onadd }: {
    model: PlannerModel; controller: PlannerController; week: string; revision: number; onadd: () => void;
  } = $props();

  const v = $derived.by(() => {
    void revision;
    return {
      activeId: model.activeId,
      activeColor: model.restaurants.get(model.activeId)!.color,
      single: model.selectedIds.length === 1,
      places: model.selectedIds.map(id => ({ id, restaurant: model.restaurants.get(id)!, status: restaurantStatus(model, id, week), count: model.changes(id).length })),
    };
  });

  $effect(() => {
    document.documentElement.style.setProperty('--active-color', v.activeColor);
  });

</script>

<div class="palette-row">
  <div class="palette" role="group" aria-label="Restaurants">
    {#each v.places as { id, restaurant, status, count } (id)}
      <div class="place-token" class:active={id === v.activeId} class:has-error={status.error} style:--restaurant-color={restaurant.color}>
        <button class="place-pill" data-restaurant-id={id} aria-pressed={id === v.activeId}
          aria-label={[restaurant.name, status.text || status.title].filter(Boolean).join(' · ')}
          title={[restaurant.name, status.text, status.title].filter(Boolean).join('\n')}
          onclick={() => controller.select(id)}>
          <span class={status.busy ? 'spinner' : 'color-dot'}></span>
          <span class="pill-name" dir="auto">{restaurant.name}</span>
          {#if status.error}
            <CircleAlert size={14} class="status-error" aria-hidden="true" />
          {:else if status.text && !status.busy}
            <span class="pill-status" aria-hidden="true">{count}</span>
          {/if}
        </button>
        {#if status.error}
          <button class="retry-pill" aria-label="Retry {restaurant.shortName}" title="Retry {restaurant.name}" onclick={() => controller.retry(id)}><RefreshCw size={14} aria-hidden="true" /></button>
        {/if}
        <button class="place-remove" aria-label="Remove {restaurant.shortName} from your palette" disabled={v.single}
          onclick={() => controller.remove(id)}><X size={14} aria-hidden="true" /></button>
      </div>
    {/each}
    <button class="add-place" aria-haspopup="dialog" aria-label="Add a restaurant" title="Add a restaurant" onclick={onadd}><Plus size={16} aria-hidden="true" /></button>
  </div>
</div>
