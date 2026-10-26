import { expect, test } from 'bun:test';
import { WeekScrollGesture } from '../src/lib/calendar-navigation.ts';

test('a trackpad gesture accumulates small movements and ignores its momentum after navigation', () => {
  const gesture = new WeekScrollGesture();
  expect(gesture.push(0, 20, 0, 0)).toBe(0);
  expect(gesture.push(0, 30, 0, 20)).toBe(1);
  expect(gesture.push(0, 160, 0, 40)).toBe(0);
  expect(gesture.push(0, -160, 0, 80)).toBe(0);
  expect(gesture.push(0, -60, 0, 400)).toBe(-1);
});

test('shifted horizontal deltas, line wheels, and page wheels navigate in either direction', () => {
  for (const [x, y, mode, expected] of [[80, 0, 0, 1], [-80, 2, 0, -1], [0, 3, 1, 1], [0, -3, 1, -1], [0, 1, 2, 1], [-1, 0, 2, -1]] as const) {
    expect(new WeekScrollGesture().push(x, y, mode, 0)).toBe(expected);
  }
});

test('separate small gestures do not accumulate and ordinary scrolling can reset the gesture', () => {
  const gesture = new WeekScrollGesture();
  expect(gesture.push(0, 30, 0, 0)).toBe(0);
  expect(gesture.push(0, 30, 0, 300)).toBe(0);
  gesture.reset();
  expect(gesture.push(0, -48, 0, 310)).toBe(-1);
  gesture.reset();
  expect(gesture.push(48, 0, 0, 320)).toBe(1);
});
