import { addDays, tehranToday, weekOf } from './planner-model.ts';

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
