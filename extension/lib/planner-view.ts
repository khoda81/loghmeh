import { MEALS, addDays, menuKey, slotKey, tehranToday, weekOf, type PlannerModel } from './planner-model.ts';
import type { Choice } from './types.ts';

export function calendarClock(now = new Date()) {
  const today = tehranToday(now);
  const currentWeek = weekOf(today);
  const hour = Number(new Intl.DateTimeFormat('en', {
    hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran',
  }).format(now));
  // Visual time cue only; the server still owns reservation/serving windows.
  return { today, currentWeek, nextWeek: addDays(currentWeek, 7), currentMeal: hour < 16 ? '1' : '3' };
}

export function restoreCalendarWeek(storage: Pick<Storage, 'getItem'>, key: string, fallback: string) {
  try {
    const week = storage.getItem(key);
    if (week && /^\d{4}-\d{2}-\d{2}$/.test(week) && weekOf(week) === week) return week;
  } catch { /* Invalid dates or unavailable storage use the default week. */ }
  return fallback;
}

export const money = (rials: number) => (rials / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
export const mealName = (id: string) => MEALS.find(meal => meal.id === id)?.name || id;
const asDate = (day: string) => new Date(day + 'T12:00:00Z');
const formats = {
  shortFa: new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  short: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  weekday: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }),
  fullWeekday: new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }),
};
export const formatDay = (day: string, format: keyof typeof formats) => formats[format].format(asDate(day));

export interface RestaurantStatus { text: string; busy?: boolean; error?: boolean; title?: string }

export function restaurantStatus(model: PlannerModel, id: string, week: string): RestaurantStatus {
  const save = model.saves.get(id);
  const loads = [...model.loads.values()].filter(load => load.restaurantId === id && load.week === week);
  const pending = loads.filter(load => ['queued', 'loading'].includes(load.state));
  const count = model.changes(id).length;
  const changes = `${count} ${count === 1 ? 'change' : 'changes'}`;
  if (save?.state === 'error') return { text: 'Not saved', error: true, title: save.message };
  if (save?.state === 'queued' || save?.state === 'saving') return { text: save.state === 'queued' ? 'Save queued' : 'Saving…', busy: true };
  if (loads.some(load => load.state === 'error')) return { text: 'Load failed', error: true, title: 'Retry the menu request.' };
  if (pending.length) return { text: count ? changes : '', busy: true,
    title: pending.some(load => load.state === 'loading') ? 'Loading this week’s menu' : 'This week’s menu is queued' };
  return { text: count ? changes : '' };
}

export interface SlotView {
  key: string;
  // Bookings for every selected place, then confirmed reservations staged for cancellation.
  cards: { choice: Choice; removing: boolean }[];
  hasActiveBooking: boolean;
  ghosts: Choice[];
  state: 'retry' | 'loading' | 'closed' | null;
  conflict: boolean;
}

// What one calendar cell shows for the active restaurant's menu.
export function slotView(model: PlannerModel, date: string, mealId: string, week: string): SlotView {
  const key = `${date}|${mealId}`;
  const bookings = model.bookings().filter(choice => slotKey(choice) === key);
  const cancelling = model.changes().filter(draft => !draft.desired && model.confirmed.has(draft.choice.id) && slotKey(draft.choice) === key);
  const menu = model.menus.get(menuKey(model.activeId, week));
  const load = model.loads.get(menuKey(model.activeId, week));
  const foods = menu?.choices.filter(choice => choice.date === date && choice.mealId === mealId) || [];
  const ghosts = foods.filter(choice => !choice.locked);
  const hasActiveBooking = bookings.some(choice => choice.restaurantId === model.activeId);
  const state = hasActiveBooking || ghosts.length ? null : load?.state === 'error' ? 'retry' : !menu ? 'loading' : foods.length ? 'closed' : null;
  return {
    key,
    cards: [...bookings.map(choice => ({ choice, removing: false })), ...cancelling.map(draft => ({ choice: draft.choice, removing: true }))],
    hasActiveBooking,
    ghosts: hasActiveBooking ? [] : ghosts,
    state,
    conflict: model.conflicts().some(choices => choices.some(choice => slotKey(choice) === key)),
  };
}
