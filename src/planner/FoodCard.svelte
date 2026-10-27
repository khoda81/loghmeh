<script lang="ts">
  import { X, Undo2, Lock, CircleAlert, Pencil } from '@lucide/svelte';
  import Steam from './Steam.svelte';
  import { money } from '../lib/planner-view.ts';
  import type { Choice, Restaurant } from '../lib/types.ts';

  let { choice, restaurant, removing, draft, saving, failed, ontoggle }: {
    choice: Choice; restaurant: Restaurant; removing: boolean; draft: boolean; saving: boolean; failed: boolean; ontoggle: () => void;
  } = $props();
  const removable = $derived(!choice.locked && !removing);
  // A staged cancellation stays clickable so a stray tap can be taken back in place.
  const restorable = $derived(removing && !saving);
  const state = $derived(failed ? 'Not saved' : saving ? 'Saving…' : removing ? 'Cancel pending' : draft ? 'Draft' : choice.locked ? 'Locked' : '');
  const StatusIcon = $derived(failed ? CircleAlert : removing ? Undo2 : draft ? Pencil : Lock);
  const statusTitle = $derived([state, choice.locked ? choice.lockReason : ''].filter(Boolean).join(' · '));
  const title = $derived([choice.name, statusTitle].filter(Boolean).join('\n'));
</script>

{#snippet content()}
  <span class="food-name" dir="rtl" title={choice.name}>{restaurant.name}</span>
  <span class="food-card-bottom"><span>{money(choice.priceRials)} t</span>{#if state}<span class="status-icon" class:draft-state={draft} class:status-error={failed} role="img" aria-label={statusTitle} title={statusTitle}>{#if saving && !failed}<Steam size={14} />{:else}<StatusIcon size={12} aria-hidden="true" />{/if}</span>{/if}</span>
{/snippet}

{#if removable || restorable}
  <button type="button" class="food-card is-toggle" class:is-draft={draft} class:is-removing={removing} style:--restaurant-color={restaurant.color}
    data-choice-id={choice.id} data-focus-key="reservation-{choice.id}" {title}
    aria-label="{removable ? 'Remove' : 'Keep'} {choice.name} · {restaurant.name}" onclick={ontoggle}>
    <span class="card-hint" aria-hidden="true">{#if removable}<X size={28} />{:else}<Undo2 size={28} />{/if}</span>
    {@render content()}
  </button>
{:else}
  <div class="food-card" class:is-draft={draft} class:is-removing={removing} style:--restaurant-color={restaurant.color}
    data-choice-id={choice.id} data-focus-key="reservation-{choice.id}" {title} aria-label="{choice.name} · {restaurant.name}">
    {@render content()}
  </div>
{/if}
