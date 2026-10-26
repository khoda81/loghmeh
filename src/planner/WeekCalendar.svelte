<script lang="ts">
  import FoodCard from './FoodCard.svelte';
  import type { PlannerController } from '../lib/planner-controller.ts';
  import { MEALS, addDays, type PlannerModel } from '../lib/planner-model.ts';
  import { formatDay, mealName, money, slotView } from '../lib/planner-view.ts';
  import type { Choice } from '../lib/types.ts';

  let { model, controller, week, today, currentMeal, revision }: {
    model: PlannerModel; controller: PlannerController; week: string; today: string; currentMeal: string; revision: number;
  } = $props();
  const days = $derived(Array.from({ length: 7 }, (_, day) => addDays(week, day)));
  let grid: HTMLElement;
  let focused: HTMLElement | undefined;

  const v = $derived.by(() => {
    void revision;
    const slots = new Map(days.flatMap(date => MEALS.map(meal => {
      const slot = slotView(model, date, meal.id, week);
      return [slot.key, { ...slot, cards: slot.cards.map(({ choice, removing }) => ({
        choice, removing,
        restaurant: model.restaurants.get(choice.restaurantId)!,
        draft: model.drafts.has(choice.id),
        saving: model.inflight.has(choice.id),
        failed: model.drafts.has(choice.id) && model.saves.get(choice.restaurantId)?.state === 'error',
      })) }] as const;
    })));
    return { slots, activeId: model.activeId, activeShortName: model.restaurants.get(model.activeId)!.shortName };
  });

  function toggle(choice: Choice, removing: boolean) {
    if (!choice.locked && !removing) controller.removeChoice(choice);
    else controller.choose(choice);
  }

  // Choosing a food replaces its button with a reservation card (and the reverse when
  // a cancellation is staged). Move focus to the replacement instead of losing it.
  $effect(() => {
    void v;
    if (!focused || focused.isConnected || document.activeElement !== document.body) return;
    const key = focused.dataset.focusKey!;
    const nodes = new Map([...grid.querySelectorAll<HTMLElement>('[data-focus-key]')].map(node => [node.dataset.focusKey, node]));
    (nodes.get(key.replace('ghost-', 'reservation-')) || nodes.get(key) || nodes.get(key.replace('reservation-', 'ghost-')))?.focus({ preventScroll: true });
  });
</script>

<section class="week" data-week={week} aria-label="Week of {formatDay(week, 'short')}">
  <div class="week-scroll">
    <div class="week-grid" bind:this={grid}
      onfocusin={event => { focused = (event.target as HTMLElement).dataset.focusKey ? event.target as HTMLElement : undefined; }}>
      <div></div>
      {#each days as date (date)}
        <div class="day-heading" class:is-today={date === today} aria-current={date === today ? 'date' : undefined}>
          <strong>{formatDay(date, 'weekday')}</strong><span>{formatDay(date, 'shortFa')}</span>
        </div>
      {/each}
      {#each MEALS as meal (meal.id)}
        <div class="meal-heading">{meal.name}</div>
        {#each days as date (date)}
          {@const slot = v.slots.get(`${date}|${meal.id}`)!}
          {@const current = date === today && meal.id === currentMeal}
          <article class="meal-slot" class:is-today={date === today} class:current-slot={current} class:has-conflict={slot.conflict}
            data-slot={slot.key} aria-label="{formatDay(date, 'fullWeekday')}, {formatDay(date, 'short')}, {meal.name}{current ? ', current meal' : ''}">
            {#if current}<span class="slot-now">Now · {meal.name}</span>{/if}
            <div class="slot-cards">
              {#each slot.cards as card (`${card.choice.id}|${card.removing}`)}
                <FoodCard {...card} ontoggle={() => toggle(card.choice, card.removing)} />
              {/each}
            </div>
            {#if !slot.hasActiveBooking}
              <div class="paint-surface" class:can-paint={slot.ghosts.length > 0}>
                {#if slot.ghosts.length}
                  <div class="ghost-options" role="group" aria-label="{date} {mealName(meal.id)} · {v.activeShortName}">
                    {#each slot.ghosts as choice (choice.id)}
                      <div class="ghost-option">
                        <button class="ghost-choice" data-ghost-id={choice.id} data-focus-key="ghost-{choice.id}"
                          aria-label="Choose {choice.name} · {money(choice.priceRials)} toman" onclick={() => controller.choose(choice)}>
                          <span class="ghost-name" dir="rtl">{choice.name}</span><span class="ghost-meta">{money(choice.priceRials)} t</span>
                        </button>
                      </div>
                    {/each}
                  </div>
                {:else if slot.state === 'retry'}
                  <button class="slot-state" onclick={() => controller.load(v.activeId, week, true)}>Retry menu</button>
                {:else if slot.state === 'loading'}
                  <span class="slot-state"><span class="spinner"></span><span>Loading menu</span></span>
                {:else if slot.state === 'closed'}
                  <span class="slot-state">Reservation closed</span>
                {/if}
              </div>
            {/if}
            {#if slot.conflict}<p class="slot-conflict">Meal entitlement conflict</p>{/if}
          </article>
        {/each}
      {/each}
    </div>
  </div>
</section>
