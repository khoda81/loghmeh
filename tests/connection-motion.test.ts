import { expect, test } from 'bun:test';
import { connectionMotionState, type ConnectionMotionState } from '../src/lib/connection-motion.ts';
import { SaffronOrbit } from '../src/lib/saffron-orbit.ts';
import type { ConnectionPhase } from '../src/lib/connection-state.ts';

test('every connection phase has a drawing, and only verified sessions get a filled bowl', () => {
  const expected: Record<ConnectionPhase, ConnectionMotionState> = {
    checking: 'checking', waiting: 'open', redirect: 'open', login: 'open', permission: 'open',
    connected: 'connected', 'read-only': 'connected', network: 'failed', timeout: 'failed', server: 'failed', error: 'failed',
  };
  for (const [phase, state] of Object.entries(expected)) expect(connectionMotionState(phase as ConnectionPhase)).toBe(state);
});

// Drive the real renderer with a virtual frame clock. Painting is stubbed, while
// the frame queue, observers and visibility/preference listeners remain observable.
function motionEnvironment(reduced = false) {
  let now = 0, sequence = 0, paints = 0, disconnected = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { at: number; callback(): void }>();
  const listeners = new Map<string, Set<() => void>>();
  const events = {
    addEventListener: (name: string, callback: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
    },
    removeEventListener: (name: string, callback: () => void) => listeners.get(name)?.delete(callback),
  };
  const emit = (name: string) => listeners.get(name)?.forEach(callback => callback());
  const preference = { matches: reduced, ...events };
  const context = new Proxy({
    setTransform() { paints++; },
    createLinearGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
  }, { get: (target, key) => key in target ? target[key] : () => {} }) as unknown as CanvasRenderingContext2D;
  const canvas = { clientWidth: 320, clientHeight: 190, width: 0, height: 0 } as HTMLCanvasElement;
  const document = { hidden: false, createElement: () => ({ getContext: () => context }), ...events };
  let intersection: (entries: { isIntersecting: boolean }[]) => void;
  let resized: () => void;
  const globals = {
    window: { matchMedia: () => preference, devicePixelRatio: 3 }, document,
    performance: { now: () => now },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void, delay: number) => { timers.set(++sequence, { at: now + delay, callback }); return sequence; },
    clearTimeout: (id: number) => timers.delete(id),
    ResizeObserver: class {
      constructor(callback: () => void) { resized = callback; }
      observe() {} disconnect() { disconnected++; }
    },
    IntersectionObserver: class {
      constructor(callback: typeof intersection) { intersection = callback; }
      observe() {} disconnect() { disconnected++; }
    },
  };
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true });
  return {
    canvas, context, frames, timers, preference,
    get paints() { return paints; },
    get disconnected() { return disconnected; },
    get listenerCount() { return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0); },
    intersect(visible: boolean) { intersection([{ isIntersecting: visible }]); },
    hidden(hidden: boolean) { document.hidden = hidden; emit('visibilitychange'); },
    reduce(reduce: boolean) { preference.matches = reduce; emit('change'); },
    resize(width: number) { Object.assign(canvas, { clientWidth: width }); resized(); },
    advance(seconds: number) {
      for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
        now += 1000 / 60;
        const pending = [...frames.values()]; frames.clear();
        pending.forEach(callback => callback(now));
        for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
    restore() {
      for (const [name, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('checking keeps orbiting; waiting, failed and connected drawings settle without idle frame loops', () => {
  const env = motionEnvironment();
  let orbit: SaffronOrbit;
  try {
    orbit = new SaffronOrbit(env.canvas, env.context, 'checking');
    expect(env.frames.size).toBe(0); // Not observed in the viewport yet.
    env.intersect(true);
    env.advance(20);
    expect(env.frames.size).toBe(1);
    for (const state of ['open', 'failed'] as const) {
      orbit.setState(state);
      env.advance(3);
      expect(env.frames.size).toBe(0);
    }
    orbit.setState('connected');
    env.advance(5);
    expect(env.frames.size).toBe(0);
    const settledPaints = env.paints;
    orbit.setState('connected');
    env.advance(5);
    expect(env.paints).toBe(settledPaints);
  } finally { orbit?.destroy(); env.restore(); }
});

test('pause, hidden tabs and offscreen canvases freeze playback; destroying releases every resource', () => {
  const env = motionEnvironment();
  let orbit: SaffronOrbit;
  try {
    orbit = new SaffronOrbit(env.canvas, env.context, 'connected');
    env.intersect(true); env.advance(1);
    for (const [stop, resume] of [
      [() => orbit.setPaused(true), () => orbit.setPaused(false)],
      [() => env.hidden(true), () => env.hidden(false)],
      [() => env.intersect(false), () => env.intersect(true)],
    ]) {
      stop();
      const before = env.paints;
      env.advance(30);
      expect(env.paints).toBe(before);
      expect(env.frames.size).toBe(0);
      resume(); env.advance(.2);
      expect(env.frames.size).toBe(1);
    }
    env.advance(4);
    expect(env.frames.size).toBe(0);
    orbit.setState('checking');
    expect(env.frames.size).toBe(1);
    orbit.destroy();
    expect(env.frames.size).toBe(0);
    expect(env.disconnected).toBe(2);
    expect(env.listenerCount).toBe(0);
  } finally { orbit?.destroy(); env.restore(); }
});

test('reduced motion renders stills, responds to preference changes, and caps the canvas pixel ratio', () => {
  const env = motionEnvironment(true);
  let orbit: SaffronOrbit;
  try {
    orbit = new SaffronOrbit(env.canvas, env.context, 'checking');
    env.intersect(true);
    expect(env.canvas.width).toBe(640);
    expect(env.canvas.height).toBe(380);
    expect(env.frames.size).toBe(0);
    const before = env.paints;
    env.advance(20);
    expect(env.paints).toBe(before);
    orbit.setState('failed');
    expect(env.paints).toBeGreaterThan(before);
    expect(env.frames.size).toBe(0);
    orbit.setState('checking'); env.reduce(false);
    expect(env.frames.size).toBe(1);
    env.resize(0);
    expect(env.frames.size).toBe(0);
    env.resize(240);
    expect(env.canvas.width).toBe(480);
    expect(env.frames.size).toBe(1);
    env.reduce(true);
    expect(env.frames.size).toBe(0);
  } finally { orbit?.destroy(); env.restore(); }
});

test('a reduced-motion connected bowl stays in place without idle frames or dismissal timers', () => {
  const env = motionEnvironment(true);
  let orbit: SaffronOrbit;
  try {
    orbit = new SaffronOrbit(env.canvas, env.context, 'connected');
    env.intersect(true); env.advance(.5);
    env.hidden(true); env.advance(10);
    expect(env.timers.size).toBe(0);
    env.hidden(false); env.advance(2);
    expect(env.frames.size).toBe(0);
    orbit.setState('checking'); orbit.setState('connected');
    expect(env.timers.size).toBe(0);
    orbit.destroy();
    expect(env.timers.size).toBe(0);
    env.advance(10);
  } finally { orbit?.destroy(); env.restore(); }
});

test('a connection result received while paused renders its still and stays settled on resume', () => {
  const env = motionEnvironment();
  let orbit: SaffronOrbit;
  try {
    orbit = new SaffronOrbit(env.canvas, env.context, 'checking');
    env.intersect(true); orbit.setPaused(true);
    const before = env.paints;
    orbit.setState('connected'); env.advance(10);
    expect(env.paints).toBeGreaterThan(before);
    expect(env.frames.size).toBe(0);
    orbit.setPaused(false);
    expect(env.frames.size).toBe(0);
  } finally { orbit?.destroy(); env.restore(); }
});
