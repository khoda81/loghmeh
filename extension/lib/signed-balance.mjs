const total = choices => choices.reduce((sum, choice) => sum + choice.priceRials, 0);

// The ruler is signed, but food rectangles live in fixed funding coordinates.
// A normal payment/refund changes B and R equally and oppositely, keeping B + R fixed.
export class SignedBalanceLedger {
  constructor() {
    this.geometry = new Map();
    this.previous = null;
  }

  update(model) {
    const reservedRials = total([...model.confirmed.values()]);
    const fundingRials = reservedRials + model.balanceRials;
    const extentRials = Math.max(1, fundingRials);
    const entries = new Map([...model.confirmed].map(([id, choice]) => [id, { choice, state: 'reserved' }]));
    for (const [id, draft] of model.drafts) {
      if (draft.desired && !model.confirmed.has(id)) entries.set(id, { choice: draft.choice, state: 'adding' });
      if (draft.desired && model.confirmed.has(id) && model.inflightDrafts.get(id)?.desired === false) {
        entries.set(id, { choice: draft.choice, state: 'adding', provisional: true });
      }
      if (!draft.desired && (model.confirmed.has(id) || model.inflightDrafts.get(id)?.desired)) {
        entries.set(id, { choice: draft.choice, state: 'removing', provisional: !model.confirmed.has(id) });
      }
    }
    const captures = [...model.inflightDrafts.values()].map(draft => `${draft.choice.id}:${draft.revision}`);
    const confirmed = [...model.confirmed].map(([id, choice]) => `${id}:${choice.priceRials}`).sort().join('|');
    const previous = this.previous;
    const committed = previous && previous.commitRevision !== model.commitRevision;
    const sameIntent = previous?.revision === model.revision;
    const sameFunding = previous?.fundingRials === fundingRials;
    const newCapture = captures.some(key => !previous?.captures.includes(key));
    const replan = !previous || !sameFunding || !sameIntent
      || (!committed && (previous.activeId !== model.activeId || previous.confirmed !== confirmed || newCapture));

    if (replan) {
      const restaurantOrder = new Map();
      for (const draft of model.inflightDrafts.values()) {
        if (!restaurantOrder.has(draft.choice.restaurantId)) restaurantOrder.set(draft.choice.restaurantId, restaurantOrder.size);
      }
      if (!restaurantOrder.has(model.activeId)) restaurantOrder.set(model.activeId, restaurantOrder.size);
      for (const draft of model.changes().sort((a, b) => a.revision - b.revision)) {
        if (!restaurantOrder.has(draft.choice.restaurantId)) restaurantOrder.set(draft.choice.restaurantId, restaurantOrder.size);
      }
      // Controller saves one restaurant at a time, in ascending week order.
      const saveOrder = (a, b) => restaurantOrder.get(a.choice.restaurantId) - restaurantOrder.get(b.choice.restaurantId)
        || a.choice.week.localeCompare(b.choice.week) || a.choice.id.localeCompare(b.choice.id);
      const unchanged = [...entries.values()].filter(entry => entry.state === 'reserved')
        .sort((a, b) => a.choice.restaurantId.localeCompare(b.choice.restaurantId) || a.choice.id.localeCompare(b.choice.id));
      const removals = [...entries.values()].filter(entry => entry.state === 'removing' && !entry.provisional).sort(saveOrder).reverse();
      const additions = [...entries.values()].filter(entry => entry.state === 'adding' || entry.provisional).sort(saveOrder);
      this.geometry.clear();
      const place = (items, startRials, lane) => {
        for (const { choice } of items) {
          this.geometry.set(choice.id, { startRials, endRials: startRials + choice.priceRials, lane });
          startRials += choice.priceRials;
        }
        return startRials;
      };
      const base = place(unchanged, 0, 'full');
      const split = removals.length && additions.length;
      place(removals, base, split ? 'release' : 'full');
      place(additions, base, split ? 'purchase' : 'full');
    }
    // Confirmation only updates status and zero. Surviving rectangles retain their positions.
    for (const id of this.geometry.keys()) if (!entries.has(id)) this.geometry.delete(id);
    this.previous = { fundingRials, revision: model.revision, commitRevision: model.commitRevision,
      activeId: model.activeId, confirmed, captures };
    const segments = [...entries].map(([id, entry]) => ({ ...entry, ...this.geometry.get(id) }));
    return { segments, reservedRials, fundingRials, extentRials, balanceRials: model.balanceRials,
      zeroFraction: reservedRials / extentRials, projectedRials: model.balanceRials - model.delta(),
      spendingRials: total(segments.filter(entry => entry.state === 'adding' && !entry.provisional).map(entry => entry.choice)),
      recoveryRials: total(segments.filter(entry => entry.state === 'removing' && !entry.provisional).map(entry => entry.choice)) };
  }
}

export function signedBalanceTicks({ reservedRials, extentRials, balanceRials }, width, minimumGap = 72) {
  const extent = extentRials / 10;
  const target = extent / Math.max(1, Math.floor(width / minimumGap));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= target) * magnitude;
  const ticks = [];
  const minimum = -reservedRials / 10;
  const maximum = balanceRials / 10;
  for (let index = Math.ceil(minimum / step); index <= Math.floor(maximum / step); index++) {
    const value = index * step || 0;
    ticks.push({ value, fraction: (value * 10 + reservedRials) / extentRials });
  }
  return ticks;
}
