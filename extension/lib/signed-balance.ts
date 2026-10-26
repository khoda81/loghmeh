import type { Choice } from './types.ts';
import type { PlannerModel } from './planner-model.ts';

export interface LedgerEntry { choice: Choice; state: 'reserved' | 'adding' | 'removing'; provisional?: boolean }
export interface LedgerSegment extends LedgerEntry { startRials: number; endRials: number; lane: 'full' }
export type LedgerView = ReturnType<SignedBalanceLedger['update']>;

const total = (choices: Choice[]) => choices.reduce((sum, choice) => sum + choice.priceRials, 0);

// The signed ruler uses balance + known paid reservations as its funding extent.
// Food stays chronological, including pending refunds at their original positions.
// Purchases move zero on confirmation; confirmed removals close their own gap.
export class SignedBalanceLedger {
  update(model: Pick<PlannerModel, 'confirmed' | 'drafts' | 'inflightDrafts' | 'balanceRials' | 'delta'>) {
    const reservedRials = total([...model.confirmed.values()]);
    const fundingRials = reservedRials + model.balanceRials;
    const extentRials = Math.max(1, fundingRials);
    const entries = new Map<string, LedgerEntry>([...model.confirmed].map(([id, choice]) => [id, { choice, state: 'reserved' }]));
    for (const [id, draft] of model.drafts) {
      if (draft.desired && !model.confirmed.has(id)) entries.set(id, { choice: draft.choice, state: 'adding' });
      if (draft.desired && model.confirmed.has(id) && model.inflightDrafts.get(id)?.desired === false) {
        entries.set(id, { choice: draft.choice, state: 'adding', provisional: true });
      }
      if (!draft.desired && (model.confirmed.has(id) || model.inflightDrafts.get(id)?.desired)) {
        entries.set(id, { choice: draft.choice, state: 'removing', provisional: !model.confirmed.has(id) });
      }
    }
    const chronological = (a: LedgerEntry, b: LedgerEntry) => a.choice.date.localeCompare(b.choice.date)
      || a.choice.mealId.localeCompare(b.choice.mealId, 'en', { numeric: true })
      || a.choice.restaurantId.localeCompare(b.choice.restaurantId)
      || a.choice.id.localeCompare(b.choice.id);
    let startRials = 0;
    const segments = [...entries.values()].sort(chronological).map(entry => {
      const segment: LedgerSegment = { ...entry, startRials, endRials: startRials + entry.choice.priceRials, lane: 'full' };
      startRials = segment.endRials;
      return segment;
    });
    return { segments, reservedRials, fundingRials, extentRials, balanceRials: model.balanceRials,
      zeroFraction: reservedRials / extentRials, projectedRials: model.balanceRials - model.delta(),
      spendingRials: total(segments.filter(entry => entry.state === 'adding' && !entry.provisional).map(entry => entry.choice)),
      recoveryRials: total(segments.filter(entry => entry.state === 'removing' && !entry.provisional).map(entry => entry.choice)) };
  }
}

export function signedBalanceTicks({ reservedRials, extentRials, balanceRials }: Pick<LedgerView, 'reservedRials' | 'extentRials' | 'balanceRials'>, width: number, minimumGap = 72) {
  const extent = extentRials / 10;
  const target = extent / Math.max(1, Math.floor(width / minimumGap));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= target)! * magnitude;
  const ticks = [];
  const minimum = -reservedRials / 10;
  const maximum = balanceRials / 10;
  for (let index = Math.ceil(minimum / step); index <= Math.floor(maximum / step); index++) {
    const value = index * step || 0;
    ticks.push({ value, fraction: (value * 10 + reservedRials) / extentRials });
  }
  return ticks;
}
