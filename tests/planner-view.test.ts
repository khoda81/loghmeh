import { expect, test } from 'bun:test';
import { calendarClock, restaurantStatus, restoreCalendarWeek, slotView } from '../src/lib/planner-view.ts';
import { PlannerController } from '../src/lib/planner-controller.ts';
import { RESTAURANTS, DemoDiningService } from '../src/lib/planner-demo.ts';
import { PlannerModel } from '../src/lib/planner-model.ts';

test('calendar clock follows Tehran date, Saturday weeks, and the 16:00 meal boundary', () => {
  expect(calendarClock(new Date('2026-10-26T12:29:59Z'))).toEqual({
    today: '2026-10-26', currentWeek: '2026-10-24', nextWeek: '2026-10-31', currentMeal: '1',
  });
  expect(calendarClock(new Date('2026-10-26T12:30:00Z')).currentMeal).toBe('3');
  expect(calendarClock(new Date('2026-10-30T20:30:00Z'))).toEqual({
    today: '2026-10-31', currentWeek: '2026-10-31', nextWeek: '2026-11-07', currentMeal: '1',
  });
});

test('calendar restores only a valid Saturday date and uses the requested storage key', () => {
  const storage = { getItem: key => key === 'live' ? '2026-10-24' : '2026-10-31' };
  expect(restoreCalendarWeek(storage, 'live', '2026-11-07')).toBe('2026-10-24');
  expect(restoreCalendarWeek(storage, 'demo', '2026-11-07')).toBe('2026-10-31');
  for (const value of [null, '', 'broken', '2026-10-26', '2026-02-31', '2026-13-01', '2026-1-03']) {
    expect(restoreCalendarWeek({ getItem: () => value }, 'live', '2026-11-07')).toBe('2026-11-07');
  }
});

test('calendar remains usable when local storage is blocked', () => {
  expect(restoreCalendarWeek({ getItem() { throw new Error('Storage blocked'); } }, 'live', '2026-10-31')).toBe('2026-10-31');
});

const today = '2026-10-22';
const week = '2026-10-24';
async function loaded(selectedIds = ['kooy', 'garden']) {
  const service = new DemoDiningService({ today, wait: async () => {} });
  const model = new PlannerModel({ restaurants: RESTAURANTS, balanceRials: service.balanceRials, selectedIds, activeId: selectedIds[0] });
  const controller = new PlannerController({ model, service });
  controller.showWeek(week);
  await controller.idle();
  return { model, controller, service };
}

test('a slot offers the active place’s unlocked foods until one is booked, then shows its card', async () => {
  const { model, controller } = await loaded();
  const empty = slotView(model, '2026-10-25', '1', week);
  expect(empty.cards).toEqual([]);
  expect(empty.ghosts.map(choice => choice.name)).toEqual(['زرشک پلو با مرغ', 'خوراک آبگوشت']);
  expect(empty.state).toBeNull();
  controller.choose(empty.ghosts[0]);
  const booked = slotView(model, '2026-10-25', '1', week);
  expect(booked.hasActiveBooking).toBe(true);
  expect(booked.ghosts).toEqual([]);
  expect(booked.cards.map(card => [card.choice.name, card.removing])).toEqual([['زرشک پلو با مرغ', false]]);
  expect(restaurantStatus(model, 'kooy', week)).toEqual({ text: '1 change' });
});

test('a staged cancellation stays in its slot as a removing card', async () => {
  const { model, controller } = await loaded();
  const choice = slotView(model, '2026-10-25', '1', week).ghosts[0];
  controller.choose(choice);
  await controller.submit();
  controller.removeChoice(choice);
  const slot = slotView(model, '2026-10-25', '1', week);
  expect(slot.cards.map(card => [card.choice.id, card.removing])).toEqual([[choice.id, true]]);
  expect(slot.ghosts.map(ghost => ghost.id)).toContain(choice.id);
});

test('slots explain loading, failed, and closed menus; conflicts mark the slot', async () => {
  const { model, controller, service } = await loaded(['kooy', 'engineering']);
  expect(slotView(model, '2026-10-25', '1', '2026-10-31').state).toBe(null);
  expect(slotView(model, '2026-10-30', '1', week).state).toBeNull(); // The sample Kooy has no Friday menu: nothing to say.
  controller.showWeek('2026-10-17');
  await controller.idle();
  expect(slotView(model, '2026-10-21', '1', '2026-10-17').state).toBe('closed');
  service.failNextRead = true;
  controller.showWeek('2026-10-31');
  await controller.idle();
  expect(slotView(model, '2026-11-01', '1', '2026-10-31').state).toBe('retry');
  expect(restaurantStatus(model, 'kooy', '2026-10-31')).toMatchObject({ text: 'Load failed', error: true, title: 'Could not load this menu. Try again.' });
  controller.showWeek(week);
  await controller.idle();
  controller.choose(slotView(model, '2026-10-25', '1', week).ghosts[0]);
  controller.select('engineering', { submitPrevious: false });
  controller.choose(slotView(model, '2026-10-25', '1', week).ghosts[0]);
  expect(slotView(model, '2026-10-25', '1', week).conflict).toBe(true);
  expect(slotView(model, '2026-10-26', '1', week).conflict).toBe(false);
});
