<script lang="ts">
  import { ArrowLeft, ArrowRight, RefreshCw, Lock } from '@lucide/svelte';
  import Steam from './Steam.svelte';
  import { WeekScrollGesture } from '../lib/calendar-navigation.ts';
  import FoodCard from './FoodCard.svelte';
  import type { PlannerController } from '../lib/planner-controller.ts';
  import { MEALS, addDays, type PlannerModel } from '../lib/planner-model.ts';
  import { formatDay, mealName, money, slotView } from '../lib/planner-view.ts';
  import type { Choice } from '../lib/types.ts';

  interface Props {
    model: PlannerModel; controller: PlannerController; week: string; today: string; currentMeal: string; revision: number;
    onprevious: () => void; onnext: () => void;
  }
  let { model, controller, week, today, currentMeal, revision, onprevious, onnext }: Props = $props();
  const days = $derived(Array.from({ length: 7 }, (_, day) => addDays(week, day)));
  let grid = $state<HTMLElement>();
  let focused: HTMLElement | undefined;
  let displayedWeek: string | undefined;

  const scrollGesture = new WeekScrollGesture();

  function shortcutsBlocked(target: EventTarget | null) {
    return Boolean(document.querySelector('dialog[open]') ||
      target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"]'));
  }

  function navigate(direction: -1 | 1) {
    // A card may disappear with the week; keep focus on a stable control instead.
    if (grid?.contains(document.activeElement)) {
      focused = undefined;
      grid.closest('.week')?.querySelector<HTMLButtonElement>(direction < 0 ? '.previous' : '.next')?.focus({ preventScroll: true });
    }
    if (direction < 0) onprevious();
    else onnext();
  }

  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || shortcutsBlocked(event.target)) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    navigate(event.key === 'ArrowLeft' ? -1 : 1);
  }

  function wheel(event: WheelEvent) {
    if (!event.shiftKey || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || shortcutsBlocked(event.target)) {
      scrollGesture.reset();
      return;
    }
    event.preventDefault();
    const direction = scrollGesture.push(event.deltaX, event.deltaY, event.deltaMode, performance.now());
    if (direction) navigate(direction);
  }

  function wheelNavigation(node: HTMLElement) {
    node.addEventListener('wheel', wheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', wheel) };
  }

  // Only navigation animates; initial render, menu updates, and clock changes stay still.
  function animateWeek(node: HTMLElement, nextWeek: string) {
    const direction = displayedWeek ? Math.sign(nextWeek.localeCompare(displayedWeek)) : 0;
    displayedWeek = nextWeek;
    if (!direction || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = node.animate([
      { transform: `translateX(${direction * 32}px)`, opacity: 0.35 },
      { transform: 'translateX(0)', opacity: 1 },
    ], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
    // A rapid second click replaces the week immediately and cancels its old animation.
    return { destroy: () => animation.cancel() };
  }

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
    if (!grid || !focused || focused.isConnected || document.activeElement !== document.body) return;
    const key = focused.dataset.focusKey!;
    const nodes = new Map([...grid.querySelectorAll<HTMLElement>('[data-focus-key]')].map(node => [node.dataset.focusKey, node]));
    (nodes.get(key.replace('ghost-', 'reservation-')) || nodes.get(key) || nodes.get(key.replace('reservation-', 'ghost-')))?.focus({ preventScroll: true });
  });
</script>

<svelte:window onkeydown={keydown} />

<section use:wheelNavigation class="week" data-week={week} aria-label="Week of {formatDay(week, 'short')}">
  <div class="week-controls" role="group" aria-label="Calendar week">
    <button class="week-arrow previous" aria-label="Previous week" title="Previous week (← or Shift+scroll up)" aria-keyshortcuts="ArrowLeft" onclick={onprevious}><ArrowLeft size={20} aria-hidden="true" /></button>
    <button class="week-arrow next" aria-label="Next week" title="Next week (→ or Shift+scroll down)" aria-keyshortcuts="ArrowRight" onclick={onnext}><ArrowRight size={20} aria-hidden="true" /></button>
  </div>
  <div class="week-viewport">
  <!-- Reset the cells and their scroll position while keeping the week buttons focused. -->
  {#key `${week}|${today}`}
  <div class="week-scroll" use:animateWeek={week}>
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
                  <button class="slot-state" aria-label="Retry menu" title="Retry menu" onclick={() => controller.load(v.activeId, week, true)}><RefreshCw size={16} aria-hidden="true" /></button>
                {:else if slot.state === 'loading'}
                  <span class="slot-state" role="img" aria-label="Loading menu" title="Loading menu"><Steam size={18} /></span>
                {:else if slot.state === 'closed'}
                  <span class="slot-state" role="img" aria-label="Reservation closed" title="Reservation closed"><Lock size={14} aria-hidden="true" /></span>
                {/if}
              </div>
            {/if}
            {#if slot.conflict}<p class="slot-conflict">Meal entitlement conflict</p>{/if}
          </article>
        {/each}
      {/each}
    </div>
  </div>
  {/key}
  </div>
</section>
