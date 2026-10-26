import { expect, test } from 'bun:test';
import { calendarClock, restoreCalendarWeek } from '../extension/lib/planner-view.ts';

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
