import { expect, test } from 'bun:test';
import { leaveWelcome, placeConnection, revealPlanner } from '../src/lib/connection-handoff.ts';

function environment(reduced = false) {
  const listeners = new Map<string, Set<() => void>>();
  const events = {
    addEventListener(name: string, callback: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
    },
    removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
  };
  const emit = (name: string) => listeners.get(name)?.forEach(callback => callback());
  const animations: { cancelled: boolean; frames: Keyframe[]; cancel(): void }[] = [];
  const animate = (frames: Keyframe[]) => {
    const animation = { cancelled: false, frames, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation as unknown as Animation;
  };
  const scene = { style: { transform: '' }, animate };
  const node = { style: {}, querySelector: () => scene, animate } as unknown as HTMLElement;
  const box = { left: 80, top: 170, width: 440, height: 206 };
  const brandBox = { left: 28, top: 7, width: 42, height: 36 };
  const welcome = { getBoundingClientRect: () => box } as HTMLElement;
  const brand = { getBoundingClientRect: () => brandBox } as HTMLElement;
  const preference = { matches: reduced, ...events };
  let resize = () => {}, disconnected = 0, focused = 0;
  const document = { hidden: false, activeElement: {}, querySelector: () => ({ focus: () => focused++ }), ...events };
  const globals = {
    window: { matchMedia: () => preference, scrollX: 0, scrollY: 0, scrollTo() { this.scrollX = this.scrollY = 0; }, ...events }, document,
    ResizeObserver: class {
      constructor(callback: () => void) { resize = callback; }
      observe() {} disconnect() { disconnected++; }
    },
  };
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true });
  return {
    node, scene, animations, box, brandBox,
    options: { welcome, brand, docked: false, paused: false, phase: 'checking' },
    get focused() { return focused; },
    get disconnected() { return disconnected; },
    get listeners() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
    reduce(value: boolean) { preference.matches = value; emit('change'); },
    hide(value: boolean) { document.hidden = value; emit('visibilitychange'); },
    resize() { resize(); },
    scroll(y: number) { globals.window.scrollY = y; emit('scroll'); },
    restore() {
      for (const [name, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('one scene moves home once; later connection phases and scrolling keep it anchored without replay', async () => {
  const env = environment();
  let action: ReturnType<typeof placeConnection> | undefined;
  try {
    action = placeConnection(env.node, env.options);
    await Promise.resolve();
    expect(env.node.style.transform).toBe('translate(80px, 170px)');
    expect(env.animations).toHaveLength(0);
    action.update({ ...env.options, docked: true, phase: 'connected' });
    await Promise.resolve();
    expect(env.animations).toHaveLength(2);
    expect(env.animations[0].frames[0].transform).toBe('translate(80px, 170px)');
    expect(env.animations[0].frames[1].transform).toBe('translate(28px, 7px)');
    expect(env.node.style.width).toBe('42px');
    for (const phase of ['checking', 'failed', 'connected']) {
      action.update({ ...env.options, docked: true, phase });
      await Promise.resolve();
    }
    expect(env.animations).toHaveLength(2);
    expect(env.animations.every(animation => !animation.cancelled)).toBe(true);
    env.scroll(120); await Promise.resolve();
    expect(env.node.style.transform).toBe('translate(28px, 127px)');
    expect(env.animations.every(animation => animation.cancelled)).toBe(true);
    env.brandBox.left = 14; env.resize(); await Promise.resolve();
    expect(env.node.style.transform).toBe('translate(14px, 127px)');
    expect(env.animations).toHaveLength(2);
  } finally { action?.destroy(); env.restore(); }
});

test('paused and reduced motion skip travel; changing either preference or visibility ends active travel', async () => {
  for (const mode of ['paused', 'reduced', 'hide', 'reduce-during', 'pause-during'] as const) {
    const env = environment(mode === 'reduced');
    let action: ReturnType<typeof placeConnection> | undefined;
    try {
      action = placeConnection(env.node, env.options); await Promise.resolve();
      const next = { ...env.options, docked: true, paused: mode === 'paused', phase: 'connected' };
      action.update(next); await Promise.resolve();
      expect(env.node.style.width).toBe('42px');
      if (mode === 'paused' || mode === 'reduced') expect(env.animations).toHaveLength(0);
      else {
        expect(env.animations).toHaveLength(2);
        if (mode === 'hide') env.hide(true);
        if (mode === 'reduce-during') env.reduce(true);
        if (mode === 'pause-during') action.update({ ...next, paused: true });
        expect(env.animations.every(animation => animation.cancelled)).toBe(true);
      }
      action.destroy();
      expect(env.listeners).toBe(0);
      expect(env.disconnected).toBeGreaterThan(0);
      await Promise.resolve(); // A previously queued placement must not run after disposal.
    } finally { action?.destroy(); env.restore(); }
  }
});

test('the calendar is usable without motion and an interrupted reveal releases its animations and listeners', () => {
  for (const reduced of [false, true]) {
    const env = environment(reduced);
    let action: ReturnType<typeof revealPlanner> | undefined;
    try {
      action = revealPlanner(env.node, false);
      expect(env.animations).toHaveLength(reduced ? 0 : 1);
      env.reduce(true);
      expect(env.animations.every(animation => animation.cancelled)).toBe(true);
      action.destroy();
      expect(env.listeners).toBe(0);
    } finally { action?.destroy(); env.restore(); }
  }
});

test('leaving welcome releases its layout immediately and transfers focus only from its own controls', async () => {
  const env = environment();
  try {
    for (const hasFocus of [false, true]) {
      const node = { style: {}, inert: false, contains: () => hasFocus, getBoundingClientRect: () => env.box } as unknown as HTMLElement;
      const transition = leaveWelcome(node, { paused: false });
      expect(node.style.position).toBe('absolute');
      expect(node.inert).toBe(true);
      expect(transition.duration).toBe(220);
      await Promise.resolve();
      expect(env.focused).toBe(hasFocus ? 1 : 0);
    }
    env.reduce(true);
    const node = { style: {}, contains: () => false, getBoundingClientRect: () => env.box } as unknown as HTMLElement;
    expect(leaveWelcome(node, { paused: false }).duration).toBe(0);
    env.scroll(120);
    expect(leaveWelcome(node, { paused: false, compact: true }).duration).toBe(0);
    expect(window.scrollY).toBe(120); // Reconnecting must not move an existing calendar.
  } finally { env.restore(); }
});
