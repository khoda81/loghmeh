<script lang="ts">
  import { tick } from 'svelte';
  import Dialog from './Dialog.svelte';
  import type { PlannerController } from '../lib/planner-controller.ts';
  import type { PlannerModel } from '../lib/planner-model.ts';

  let { model, controller, revision }: { model: PlannerModel; controller: PlannerController; revision: number } = $props();
  let dialog: Dialog;
  let searchInput: HTMLInputElement;
  let search = $state('');

  const v = $derived.by(() => {
    void revision;
    const query = search.trim().toLocaleLowerCase();
    const restaurants = [...model.restaurants.values()];
    const groups = [...new Set(restaurants.map(restaurant => restaurant.group))].map(name => ({
      name,
      restaurants: restaurants.filter(restaurant => restaurant.group === name
        && `${restaurant.group} ${restaurant.name} ${restaurant.shortName}`.toLocaleLowerCase().includes(query)),
    })).filter(group => group.restaurants.length);
    return { groups, selected: new Set(model.selectedIds) };
  });

  export async function open() {
    dialog.open();
    await tick();
    searchInput.focus({ preventScroll: true });
  }

  function toggle(id: string, checkbox: HTMLInputElement) {
    if (checkbox.checked) controller.add(id); else controller.remove(id);
    // Removal can be refused (pending changes); show what the palette actually holds.
    checkbox.checked = model.selectedIds.includes(id);
  }
</script>

<Dialog bind:this={dialog} id="place-picker" eyebrow="Build your palette" title="Your usual places." closeLabel="Close restaurant picker">
  <p class="dialog-intro">Choose a few favorites. Each one gets its own color.</p>
  <label class="search-label"><span class="sr-only">Search restaurants or groups</span><input bind:this={searchInput} bind:value={search} type="search" placeholder="Find a restaurant or group…" autocomplete="off"></label>
  <div class="place-groups">
    {#each v.groups as group (group.name)}
      <details class="place-group" open>
        <summary>{group.name}</summary>
        <ul>
          {#each group.restaurants as restaurant (restaurant.id)}
            <li>
              <label class="place-option" style:--restaurant-color={restaurant.color}>
                <input type="checkbox" checked={v.selected.has(restaurant.id)} data-place-id={restaurant.id}
                  onchange={event => toggle(restaurant.id, event.currentTarget)}>
                <span class="place-option-name" dir="auto">{restaurant.name}</span><span class="color-dot"></span>
              </label>
            </li>
          {/each}
        </ul>
      </details>
    {:else}
      <p class="food-empty">No matching restaurants.</p>
    {/each}
  </div>
  <div class="dialog-footer"><span>{v.selected.size} restaurants in your palette</span><button class="plain-primary" onclick={() => dialog.close()}>Done</button></div>
</Dialog>
