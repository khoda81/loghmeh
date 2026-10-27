<script lang="ts">
  import { Plus, EyeOff, RefreshCw, CircleAlert, CircleHelp } from '@lucide/svelte';
  import Steam from './Steam.svelte';
  import type { PlannerController } from '../lib/planner-controller.ts';
  import type { PlannerModel } from '../lib/planner-model.ts';
  import { menuKey } from '../lib/planner-model.ts';
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
      places: model.selectedIds.map(id => ({ id, restaurant: model.restaurants.get(id)!, status: restaurantStatus(model, id, week), count: model.changes(id).length,
        loading: ['queued', 'loading'].includes(model.loads.get(menuKey(id, week))?.state ?? '') })),
    };
  });

  $effect(() => {
    document.documentElement.style.setProperty('--active-color', v.activeColor);
  });

</script>

<div class="palette-row">
  <div class="palette" role="group" aria-label="Restaurants">
    {#each v.places as { id, restaurant, status, count, loading } (id)}
      <div class="place-token" class:active={id === v.activeId} class:has-error={status.error} class:loading style:--restaurant-color={restaurant.color}>
        <button class="place-pill" data-restaurant-id={id} aria-pressed={id === v.activeId} disabled={loading} aria-busy={status.busy || undefined}
          aria-label={[restaurant.name, status.text || status.title].filter(Boolean).join(' · ')}
          title={[restaurant.name, status.text, status.title].filter(Boolean).join('\n')}
          onclick={() => controller.select(id)}>
          {#if status.busy}<Steam size={24} />{:else}<span class="color-dot"></span>{/if}
          <span class="pill-name" dir="auto">{restaurant.name}</span>
          {#if status.error}
            {#if model.saves.get(id)?.state === 'unknown'}<CircleHelp size={14} class="status-error" aria-hidden="true" />{:else}<CircleAlert size={14} class="status-error" aria-hidden="true" />{/if}
          {:else if status.text && !status.busy}
            <span class="pill-status" aria-hidden="true">{count}</span>
          {/if}
        </button>
        {#if status.error}
          <button class="retry-pill" aria-label={model.saves.get(id)?.state === 'unknown' ? `Check save status for ${restaurant.shortName}` : `Retry ${restaurant.shortName}`}
            title={model.saves.get(id)?.state === 'unknown' ? 'Read reservations without submitting changes' : `Retry ${restaurant.name}`}
            onclick={() => controller.retry(id)}><RefreshCw size={14} aria-hidden="true" /></button>
        {/if}
        <button class="place-remove" aria-label="Hide {restaurant.shortName} from the calendar" title="Hide {restaurant.name} from the calendar" disabled={v.single}
          onclick={() => controller.remove(id)}><EyeOff size={14} aria-hidden="true" /></button>
      </div>
    {/each}
    <button class="add-place" aria-haspopup="dialog" aria-label="Add a restaurant" title="Add a restaurant" onclick={onadd}><Plus size={16} aria-hidden="true" /></button>
  </div>
</div>
