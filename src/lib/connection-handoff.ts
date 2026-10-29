// One scene travels from the welcome card to its permanent place in the brand.
// These actions only present connection state; they never advance it.
interface Placement {
  welcome?: HTMLElement;
  brand?: HTMLElement;
  docked: boolean;
  paused: boolean;
  phase: string;
}
const travel = { duration: 1100, easing: 'cubic-bezier(.65, 0, .2, 1)' };
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)');

export function placeConnection(node: HTMLElement, initial: Placement) {
  const scene = node.querySelector<HTMLElement>('.connection-scene')!;
  const preference = reducedMotion();
  let options = initial;
  let docked = false;
  let placed = false;
  let disposed = false;
  let queued = false;
  let animations: Animation[] = [];
  let lastBox = '';
  let lastScene = '';
  let observed: HTMLElement | undefined;
  let welcomeOrigin = options.welcome;
  const cancel = () => { animations.forEach(animation => animation.cancel()); animations = []; };

  function position() {
    queued = false;
    if (disposed) return;
    const target = options.docked ? options.brand : options.welcome;
    if (!target) return;
    if (target !== observed) {
      observer.disconnect();
      observer.observe(target);
      // A changing welcome message can move the art without resizing the art itself.
      if (target.parentElement) observer.observe(target.parentElement);
      observed = target;
    }
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const box = {
      transform: `translate(${rect.left + window.scrollX}px, ${rect.top + window.scrollY}px)`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    };
    // At home, crop to the bowl and its steam, rather than shrinking the whole
    // illustration into an illegible miniature. The underlying canvas is unchanged.
    const scale = options.docked ? Math.min(rect.width / 132, rect.height / 146)
      : Math.min(rect.width / 400, rect.height / 300);
    const view = `translate(${rect.width / 2 - 200 * scale}px, ${rect.height / 2 - (options.docked ? 178 : 150) * scale}px) scale(${scale})`;
    const key = JSON.stringify(box);
    const movingHome = placed && !docked && options.docked;
    if (!options.docked && options.welcome) welcomeOrigin = options.welcome;
    docked = options.docked;
    if (key === lastBox && view === lastScene) return;
    const before = { transform: node.style.transform, width: node.style.width, height: node.style.height };
    // The old screen may have been scrolled. Its outro preserves the visible
    // origin while resetting the new planner to the top of its calendar.
    if (movingHome && welcomeOrigin?.isConnected) {
      const origin = welcomeOrigin.getBoundingClientRect();
      before.transform = `translate(${origin.left + window.scrollX}px, ${origin.top + window.scrollY}px)`;
    }
    const beforeScene = scene.style.transform;
    cancel();
    Object.assign(node.style, box, { visibility: 'visible' });
    scene.style.transform = view;
    if (movingHome && !options.paused && !preference.matches && !document.hidden) {
      animations = [node.animate([before, box], travel), scene.animate([{ transform: beforeScene }, { transform: view }], travel)];
    }
    placed = true;
    lastBox = key;
    lastScene = view;
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(position);
  }
  function finishIfNeeded() {
    if (options.paused || preference.matches || document.hidden) cancel();
  }
  const observer = new ResizeObserver(schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  preference.addEventListener('change', finishIfNeeded);
  document.addEventListener('visibilitychange', finishIfNeeded);
  schedule();
  return {
    update(next: Placement) { options = next; finishIfNeeded(); schedule(); },
    destroy() {
      disposed = true;
      cancel();
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      preference.removeEventListener('change', finishIfNeeded);
      document.removeEventListener('visibilitychange', finishIfNeeded);
    },
  };
}

export function revealPlanner(node: HTMLElement, paused: boolean) {
  const preference = reducedMotion();
  const animation = !paused && !preference.matches && !document.hidden
    ? node.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      { duration: 650, delay: 140, fill: 'backwards', easing: 'cubic-bezier(.2, .7, .2, 1)' }) : undefined;
  const finish = () => animation?.cancel();
  const preferenceChanged = () => { if (preference.matches) finish(); };
  const visibilityChanged = () => { if (document.hidden) finish(); };
  preference.addEventListener('change', preferenceChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  return {
    update(next: boolean) { if (next) finish(); },
    destroy() {
      finish();
      preference.removeEventListener('change', preferenceChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}

export function leaveWelcome(node: HTMLElement, { paused, compact = false }: { paused: boolean; compact?: boolean }) {
  if (compact) return { duration: 0 };
  const rect = node.getBoundingClientRect();
  const transferFocus = node.contains(document.activeElement);
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  // Release the layout immediately, while keeping the departing card in place.
  // The planner can be used as soon as its real model is available.
  Object.assign(node.style, { position: 'absolute', top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`, width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: 'none' });
  node.inert = true;
  // Defer until Svelte has mounted the destination. Inert would otherwise drop
  // keyboard focus on the body as the old connection controls disappear.
  if (transferFocus) queueMicrotask(() => document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true }));
  return { duration: paused || reducedMotion().matches ? 0 : 220, css: (t: number) => `opacity: ${t}` };
}
