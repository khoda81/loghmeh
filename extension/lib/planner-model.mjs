export const MEALS = [{ id: '1', name: 'Lunch' }, { id: '3', name: 'Dinner' }];
export const isoDate = date => date.toISOString().slice(0, 10);
export const addDays = (day, count) => isoDate(new Date(Date.parse(day + 'T12:00:00Z') + count * 86_400_000));
export const weekOf = day => addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 1) % 7));
export const menuKey = (restaurantId, week) => `${restaurantId}|${week}`;
export const slotKey = choice => `${choice.date}|${choice.mealId}`;
export function tehranToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

// Confirmed bookings, local intent, and captured writes have separate ownership.
export class PlannerModel {
  constructor({ restaurants, balanceRials, selectedIds, activeId, drafts = [], menus = [] }) {
    this.restaurants = new Map(restaurants.map(restaurant => [restaurant.id, restaurant]));
    this.balanceRials = balanceRials;
    this.selectedIds = selectedIds.filter(id => this.restaurants.has(id));
    this.activeId = this.selectedIds.includes(activeId) ? activeId : this.selectedIds[0];
    this.menus = new Map();
    this.confirmed = new Map();
    this.drafts = new Map();
    this.inflight = new Map();
    this.inflightDrafts = new Map();
    this.loads = new Map();
    this.saves = new Map();
    this.revision = 0;
    this.commitRevision = 0;
    for (const menu of menus) this.receiveMenu(menu);
    for (const draft of drafts) {
      if (this.restaurants.has(draft.choice?.restaurantId) && typeof draft.desired === 'boolean'
          && Number.isSafeInteger(draft.choice.priceRials) && draft.choice.priceRials >= 0) {
        this.drafts.set(draft.choice.id, { choice: draft.choice, desired: draft.desired, revision: ++this.revision });
      }
    }
  }

  receiveMenu(menu) {
    this.menus.set(menuKey(menu.restaurantId, menu.week), menu);
    for (const [id, choice] of this.confirmed) {
      if (choice.restaurantId === menu.restaurantId && choice.week === menu.week) this.confirmed.delete(id);
    }
    for (const choice of menu.choices) if (menu.reservedIds.includes(choice.id)) this.confirmed.set(choice.id, choice);
  }

  bookings() {
    const result = new Map(this.confirmed);
    for (const [id, draft] of this.drafts) {
      if (draft.desired) result.set(id, draft.choice);
      else result.delete(id);
    }
    return [...result.values()];
  }

  changes(restaurantId) {
    return [...this.drafts.values()].filter(draft => !restaurantId || draft.choice.restaurantId === restaurantId);
  }

  delta(restaurantId) {
    return this.changes(restaurantId).reduce((total, draft) => total
      + (Number(draft.desired) - Number(this.confirmed.has(draft.choice.id))) * draft.choice.priceRials, 0);
  }

  setDesired(choice, desired) {
    if (choice.locked) throw new Error(choice.lockReason || 'This reservation is locked.');
    if (this.confirmed.has(choice.id) === desired && !this.inflight.has(choice.id)) {
      if (this.drafts.delete(choice.id)) this.revision++;
    }
    else this.drafts.set(choice.id, { choice, desired, revision: ++this.revision });
    if (this.saves.get(choice.restaurantId)?.state === 'error') this.saves.delete(choice.restaurantId);
  }

  choose(choice) {
    if (choice.locked) throw new Error(choice.lockReason || 'This food is locked.');
    const alternatives = this.bookings().filter(item => item.restaurantId === choice.restaurantId
      && slotKey(item) === slotKey(choice) && item.id !== choice.id);
    if (alternatives.some(item => item.locked)) throw new Error('The existing food in this slot is locked.');
    for (const alternative of alternatives) this.setDesired(alternative, false);
    this.setDesired(choice, true);
  }

  discard(restaurantId) {
    if (this.changes(restaurantId).some(draft => this.inflight.has(draft.choice.id))) return false;
    const changes = this.changes(restaurantId);
    for (const draft of changes) this.drafts.delete(draft.choice.id);
    if (changes.length) this.revision++;
    this.saves.delete(restaurantId);
    return true;
  }

  conflicts() {
    const buckets = new Map();
    for (const choice of this.bookings()) {
      const restaurant = this.restaurants.get(choice.restaurantId);
      if (!restaurant.quotaGroup) continue;
      const key = `${slotKey(choice)}|${restaurant.quotaGroup}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(choice);
    }
    return [...buckets.values()].filter(choices => choices.length > 1);
  }

  issueFor(restaurantId) {
    if (this.conflicts().some(choices => choices.some(choice => choice.restaurantId === restaurantId))) {
      return 'Only one student meal is allowed per slot. Keep one food or use a separate entitlement.';
    }
    if (this.delta(restaurantId) > this.balanceRials) return 'There is not enough balance for these changes.';
    return null;
  }

  capture(restaurantId) {
    const changes = this.changes(restaurantId).map(draft => ({ ...draft }));
    for (const draft of changes) {
      this.inflight.set(draft.choice.id, draft.revision);
      this.inflightDrafts.set(draft.choice.id, draft);
    }
    return changes;
  }

  commit(changes, balanceRials) {
    this.balanceRials = balanceRials;
    this.commitRevision++;
    for (const submitted of changes) {
      const { choice, desired, revision } = submitted;
      if (desired) this.confirmed.set(choice.id, choice);
      else this.confirmed.delete(choice.id);
      const menu = this.menus.get(menuKey(choice.restaurantId, choice.week));
      if (menu) menu.reservedIds = [...new Set([...menu.reservedIds.filter(id => id !== choice.id), ...(desired ? [choice.id] : [])])];
      if (this.inflight.get(choice.id) === revision) {
        this.inflight.delete(choice.id);
        this.inflightDrafts.delete(choice.id);
      }
      const current = this.drafts.get(choice.id);
      if (current && (current.revision === revision || current.desired === desired)) this.drafts.delete(choice.id);
    }
  }

  release(changes) {
    for (const submitted of changes) {
      if (this.inflight.get(submitted.choice.id) === submitted.revision) {
        this.inflight.delete(submitted.choice.id);
        this.inflightDrafts.delete(submitted.choice.id);
      }
      const current = this.drafts.get(submitted.choice.id);
      if (current && current.desired === this.confirmed.has(submitted.choice.id)) this.drafts.delete(submitted.choice.id);
    }
  }

  exportState() {
    return { selectedIds: this.selectedIds, activeId: this.activeId,
      drafts: this.changes(), menus: [...this.menus.values()] };
  }
}
