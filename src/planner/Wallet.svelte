<script lang="ts">
  import { Undo2, Save, Check, CircleMinus, Lock, RefreshCw } from '@lucide/svelte';
  import Steam from './Steam.svelte';
  import type { PlannerController } from '../lib/planner-controller.ts';
  import type { LiveDiningService } from '../lib/planner-live.ts';
  import type { PlannerModel } from '../lib/planner-model.ts';
  import { mealName, money } from '../lib/planner-view.ts';
  import { SignedBalanceLedger, signedBalanceTicks } from '../lib/signed-balance.ts';

  let { model, controller, live, revision }: {
    model: PlannerModel; controller: PlannerController; live: LiveDiningService | null; revision: number;
  } = $props();
  const ledger = new SignedBalanceLedger();
  let trackWidth = $state(0);

  const v = $derived.by(() => {
    void revision;
    const ledgerView = ledger.update(model);
    const count = model.changes(model.activeId).length;
    return {
      ledger: ledgerView,
      busy: controller.saveJobs.has(model.activeId),
      unknown: controller.uncertainSaves.has(model.activeId),
      verifying: model.saves.get(model.activeId)?.state === 'verifying',
      unverifiedBalance: controller.uncertainSaves.size > 0,
      count,
      pending: model.changes().length,
      issue: model.issueFor(model.activeId),
      readOnly: Boolean(live && !live.writable),
      writeReason: live?.writeReason,
      selectedCount: model.selectedIds.length,
      active: model.restaurants.get(model.activeId)!,
      segments: ledgerView.segments.map(segment => ({ ...segment, restaurant: model.restaurants.get(segment.choice.restaurantId)! })),
    };
  });
  const projected = $derived(v.ledger.projectedRials);
  const pendingLabel = $derived.by(() => {
    if (v.unverifiedBalance) return 'Save status unverified';
    const { spendingRials, recoveryRials } = v.ledger;
    const parts = [spendingRials ? `${money(spendingRials)} spending` : '', recoveryRials ? `${money(recoveryRials)} recovery` : ''].filter(Boolean);
    return parts.length ? `${parts.join(' · ')} pending` : v.pending ? 'Change queued behind a saving meal' : 'No pending changes';
  });
  const ticks = $derived(trackWidth ? signedBalanceTicks(v.ledger, trackWidth) : []);
  const percent = (fraction: number) => `${fraction * 100}%`;
  const tickLabel = (value: number) => `${value < 0 ? '−' : ''}${Math.abs(value) >= 1000 ? `${Math.abs(value) / 1000}k` : Math.abs(value)}`;
  const segmentStatus = { adding: 'Pending food', removing: 'Pending refund', reserved: 'Reserved' };

  function undo() {
    model.discard(model.activeId);
    controller.changed();
  }
</script>

<div class="wallet">
  <div class="wallet-top">
    <div class="wallet-amount" class:unverified={v.unverifiedBalance}><span class="eyebrow">{v.unverifiedBalance ? 'Last known balance' : 'Your balance'}</span><strong>{money(v.ledger.balanceRials)}</strong><span class="unit">toman</span></div>
    <div class="wallet-projection">
      <span>{pendingLabel}</span><span><span>{live && v.pending ? 'Estimated after saving' : 'After saving'}</span> <strong style:color={projected < 0 ? 'var(--danger)' : null}>{money(projected)}</strong></span>
    </div>
    <div class="wallet-actions">
      <!-- select() submits the outgoing restaurant's changes; say so before a pill click does it. -->
      <span class="switch-hint" hidden={!v.count || v.busy || v.unknown || v.selectedCount < 2 || v.readOnly}>Saves when you switch restaurant</span>
      <button class="undo-button" hidden={!v.count} disabled={v.busy || v.unknown} aria-label="Undo changes" title={v.unknown ? 'Check save status before undoing' : 'Undo changes'} onclick={undo}><Undo2 size={16} aria-hidden="true" /></button>
      <button class="submit-button" disabled={v.busy || (!v.unknown && (!v.count || Boolean(v.issue) || v.readOnly))}
        aria-label={v.verifying ? 'Checking save status' : v.unknown ? 'Check save status' : v.busy ? 'Saving changes' : v.count ? `Submit changes for ${v.active.shortName}` : v.pending ? 'No changes here' : 'All saved'}
        title={v.unknown ? 'Check save status · reads reservations without submitting changes' : (v.readOnly ? v.writeReason || 'Reconnect dining before saving' : '') || v.issue || (v.busy ? 'Saving…' : v.count ? `Submit ${v.count} ${v.count === 1 ? 'change' : 'changes'} for ${v.active.shortName}` : v.pending ? 'No changes here' : 'All saved')}
        onclick={() => controller.submit()}>
        {#if v.busy}<Steam size={18} />
        {:else if v.unknown}<RefreshCw size={18} aria-hidden="true" />
        {:else if v.readOnly}<Lock size={18} aria-hidden="true" />
        {:else if v.count}<Save size={18} aria-hidden="true" /><span>{v.count}</span>
        {:else if v.pending}<CircleMinus size={18} aria-hidden="true" />
        {:else}<Check size={18} aria-hidden="true" />{/if}
        <span class="sr-only">{v.verifying ? 'Checking save status' : v.unknown ? 'Check save status' : v.busy ? 'Saving…' : v.count ? `Submit · ${v.count}` : v.pending ? 'No changes here' : 'All saved'}</span>
      </button>
    </div>
  </div>
  <div class="balance-track" class:over-budget={projected < 0} role="img" bind:clientWidth={trackWidth}
    aria-label="Known reservations minus {money(v.ledger.reservedRials)} toman. Available balance {money(v.ledger.balanceRials)}. Pending spending {money(v.ledger.spendingRials)}, recovery {money(v.ledger.recoveryRials)}. After saving {money(projected)}.">
    <div class="balance-cash" style:left={percent(v.ledger.zeroFraction)}></div>
    <div class="balance-segments">
      {#each v.segments as { choice, state, lane, startRials, endRials, restaurant } (choice.id)}
        <div class="balance-segment {state} lane-{lane}" data-ledger-id={choice.id} data-date={choice.date}
          style:--restaurant-color={restaurant.color}
          style:left={percent(startRials / v.ledger.extentRials)}
          style:width={percent((endRials - startRials) / v.ledger.extentRials)}
          title={`${choice.name} · ${restaurant.name}\n${choice.date} · ${mealName(choice.mealId)} · ${money(choice.priceRials)} toman · ${segmentStatus[state]}${live && state !== 'reserved' ? ' (estimate)' : ''}`}></div>
      {/each}
    </div>
    <div class="balance-zero" style:left={percent(v.ledger.zeroFraction)}></div>
  </div>
  <div class="balance-ticks" aria-hidden="true">
    {#each ticks as tick (tick.value)}
      <span class:zero-tick={tick.value === 0} data-tick-value={tick.value} style:left={percent(tick.fraction)}>{tickLabel(tick.value)}</span>
    {/each}
  </div>
  <div class="balance-key">
    <span><i class="ledger-swatch reserved"></i><span>{money(v.ledger.reservedRials)} reserved</span></span>
    <span><i class="ledger-swatch adding"></i>Pending food</span>
    <span><i class="ledger-swatch removing"></i>Pending refund</span>
    <span class="cash-key">0 → balance · available</span>
  </div>
</div>
