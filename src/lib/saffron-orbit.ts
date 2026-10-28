// Adapted from Saffron Orbit in docs/design/motion/studies.html.
// Keep its grain choreography, bowl, rice rain and composited layers local to the extension.
import type { ConnectionMotionState } from './connection-motion.ts';
interface Point {
  x: number;
  y: number;
}
interface Pose extends Point {
  rot: number;
  sc: number;
  a: number;
  layer: number;
}
interface Grain extends Pose {
  type: string;
  len: number;
  wid: number;
}
interface OrbitParticle extends Grain {
  i: number;
  ring: number;
  m: number;
  dr: number;
  micro: number;
  r1: number;
  r2: number;
  r3: number;
  k: number;
  from: Pose;
  th0: number;
  sj: number;
  archS: number;
  archPt: Point & {
    ang: number;
  };
  mound: Point & {
    rot: number;
  };
  rank: number;
  tab: Point & {
    rot: number;
  };
}
interface RainParticle extends Grain {
  i: number;
  mound: Point & {
    rot: number;
  };
  start: Pose;
  from: Pose;
  tab: Point & {
    rot: number;
  };
  delay: number;
  duration: number;
}
interface Ring {
  R: number;
  tilt: number;
  rot: number;
  dir: number;
  step: number;
}
interface Decoration {
  guide: number;
  niche: number;
  broken: number;
  steam: number;
  fill: number;
}
const TAU = Math.PI * 2;
const clamp = (x: number, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAng = (a: number, b: number, k: number) => { let d = (b - a) % TAU; if (d > Math.PI)
  d -= TAU; if (d < -Math.PI)
  d += TAU; return a + d * k; };
const E = {
  inOut: (k: number) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
  out: (k: number) => 1 - Math.pow(1 - k, 3),
  sine: (k: number) => (1 - Math.cos(Math.PI * k)) / 2,
};
function rng(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const COL = { paper: '#f7f5ee', ink: '#263a2e', forest: '#315b46', copper: '#aa7848', sage: '#dfe3d9' };
let grainTex: HTMLCanvasElement | null = null;
function grain() {
  if (grainTex)
    return grainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 180;
  const g = c.getContext('2d')!, r = rng(19);
  for (let i = 0; i < 1600; i++) {
    const a = (r() * .06).toFixed(3);
    g.fillStyle = r() < .7 ? `rgba(38,58,46,${a})` : `rgba(170,120,72,${a})`;
    const s = r() < .85 ? 1 : 1.6;
    g.fillRect(r() * 180, r() * 180, s, s);
  }
  return grainTex = c;
}
export class SaffronOrbit {
  private readonly gs = 1.85;
  private cx = 300;
  private cy = 244;
  private b = { x: 300, y: 262, rx: 86, ry: 16, d: 76 };
  private table = 352;
  private rings: Ring[] = [];
  private P: OrbitParticle[] = [];
  private rain: RainParticle[] = [];
  private saff: OrbitParticle[] = [];
  private key!: OrbitParticle;
  private nRice = 0;
  private arch: number[][] = [];
  private archL: number[] = [];
  private apexY = 0;
  private dec: Decoration = { guide: 0, niche: 0, broken: 0, steam: 0, fill: 0 };
  private decFrom = { ...this.dec };
  private state: ConnectionMotionState;
  private t = 0;
  private T = 0;
  private paused = false;
  private reduced: boolean;
  private visible = false;
  private destroyed = false;
  private settled = false;
  private raf = 0;
  private last = 0;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private pattern: CanvasPattern | null = null;
  private readonly preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private stillTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly ctx: CanvasRenderingContext2D, state: ConnectionMotionState, private readonly onsettled: () => void = () => { }) {
    this.state = state;
    this.reduced = this.preference.matches;
    this.init();
    this.capture(state, true);
    if (this.reduced)
      this.t = this.staticTime();
    this.update();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(entries => {
      this.visible = entries[entries.length - 1].isIntersecting;
      this.kick();
    });
    this.intersectionObserver.observe(canvas);
    this.preference.addEventListener('change', this.changePreference);
    document.addEventListener('visibilitychange', this.kick);
    this.resize();
  }
  setState(state: ConnectionMotionState) {
    if (state === this.state || this.destroyed)
      return;
    this.capture(state, false);
    this.state = state;
    this.settled = false;
    this.t = this.reduced || this.paused ? this.staticTime() : 0;
    this.update();
    this.draw();
    this.kick();
  }
  setPaused(paused: boolean) {
    if (paused === this.paused || this.destroyed) return;
    this.paused = paused;
    this.kick();
  }
  private changePreference = () => {
    this.reduced = this.preference.matches;
    if (this.reduced) {
      this.t = this.staticTime();
      this.update();
      this.draw();
    }
    this.kick();
  };
  private resize() {
    const w = Math.round(this.canvas.clientWidth), h = Math.round(this.canvas.clientHeight);
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== this.W || h !== this.H || d !== this.dpr) {
      this.W = w;
      this.H = h;
      this.dpr = d;
      if (w && h) {
        this.canvas.width = Math.round(w * d);
        this.canvas.height = Math.round(h * d);
        this.pattern = null;
        this.draw();
      }
    }
    this.kick();
  }
  private get active() {
    return !this.destroyed && !this.paused && this.visible && !document.hidden && this.W > 0 && this.H > 0;
  }
  private get endTime() {
    return { checking: Infinity, open: 1.85, connected: 4.8, failed: 1.6 }[this.state];
  }
  private get running() { return this.active && !this.reduced && this.t < this.endTime; }
  private kick = () => {
    clearTimeout(this.stillTimer);
    if (this.active && !this.reduced && this.t >= this.endTime) this.resolve();
    // A reduced-motion success still stays visible briefly without running a frame loop.
    if (this.active && this.reduced && this.state === 'connected' && !this.settled) {
      this.stillTimer = setTimeout(() => this.resolve(), 1800);
    }
    if (this.running) {
      if (!this.raf) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.tick);
      }
    }
    else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  };
  private tick = (now: number) => {
    this.raf = 0;
    if (!this.running)
      return;
    const dt = Math.min(.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t = Math.min(this.endTime, this.t + dt);
    if (this.t >= this.endTime) this.t = this.staticTime();
    this.T += dt;
    this.update();
    this.draw();
    if (this.t >= this.endTime)
      this.resolve();
    if (this.running)
      this.raf = requestAnimationFrame(this.tick);
  };
  private resolve() {
    if (this.destroyed || this.settled)
      return;
    this.settled = true;
    if (this.state === 'connected')
      this.onsettled();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf)
      cancelAnimationFrame(this.raf);
    clearTimeout(this.stillTimer);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.preference.removeEventListener('change', this.changePreference);
    document.removeEventListener('visibilitychange', this.kick);
  }
  private begin() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = COL.paper;
    ctx.fillRect(0, 0, W, H);
    if (!this.pattern)
      this.pattern = ctx.createPattern(grain(), 'repeat');
    if (this.pattern) {
      ctx.fillStyle = this.pattern;
      ctx.fillRect(0, 0, W, H);
    }
    const k = Math.min(W / 600, H / 450);
    ctx.translate((W - 600 * k) / 2, (H - 450 * k) / 2);
    ctx.scale(k, k);
    return ctx;
  }
  private init() {
    const N = 44, r = rng(11);
    this.cx = 300;
    this.cy = 244;
    this.b = { x: 300, y: 262, rx: 86, ry: 16, d: 76 };
    this.table = 352;
    this.rings = [{ R: 146, tilt: .30, rot: -.09, dir: 1, step: TAU / 7 }, { R: 186, tilt: .26, rot: .07, dir: -1, step: TAU / 9 }, { R: 226, tilt: .33, rot: -.03, dir: 1, step: TAU / 7 }];
    const cnt = [0, 0, 0];
    this.P = [];
    for (let i = 0; i < N; i++) {
      const ring = i % 3, type = i % 11 === 5 ? 'saffron' : i % 7 === 3 ? 'herb' : i % 5 === 2 ? 'gold' : 'rice';
      this.P.push({ i, ring, type, m: cnt[ring]++, dr: (r() - .5) * 12, len: 8.2 + r() * 2.6, wid: 3.1 + r() * .7, micro: r() * .12, r1: r(), r2: r(), r3: r(), x: 300, y: 262, rot: 0, sc: 1, a: 0, layer: 1, k: 1, from: { x: 300, y: 262, rot: 0, sc: 1, a: 0, layer: 1 }, th0: 0, sj: 0, archS: 0, archPt: { x: 300, y: 262, ang: 0 }, mound: { x: 300, y: 262, rot: 0 }, rank: 0, tab: { x: 300, y: 352, rot: 0 } });
    }
    for (const p of this.P)
      p.th0 = p.m / cnt[p.ring] * TAU + p.ring * .6 + (p.r1 - .5) * .16;
    this.saff = this.P.filter(p => p.type === 'saffron');
    this.saff.forEach((p, j) => p.sj = j);
    this.key = this.saff[0];
    this.buildArch();
    const ap = this.P.filter(p => p !== this.key).map(p => [p, this.orbitPose(p, 0).x] as const).sort((a, b) => a[1] - b[1]);
    ap.forEach(([p], j) => { p.archS = j / (ap.length - 1); p.archPt = this.archAt(p.archS); });
    const rice = this.P.filter(p => p.type !== 'saffron');
    this.nRice = rice.length;
    const spots = rice.map(() => { const u = r() * 2 - 1, v = r(); return { x: 300 + u * 74, y: this.b.y - 2 - Math.sqrt(1 - u * u) * 42 * Math.sqrt(v), rot: r() * TAU }; }).sort((a, b) => b.y - a.y);
    rice.forEach((p, j) => { p.mound = spots[j]; p.rank = j; });
    const ns = this.saff.length;
    this.saff.forEach((p, j) => { const u = (ns > 1 ? j / (ns - 1) : .5) * 1.4 - .7 + (r() - .5) * .12; p.mound = { x: 300 + u * 74, y: this.b.y - 3 - Math.sqrt(Math.max(0, 1 - u * u)) * 42, rot: (r() - .5) * 1.2 }; });
    for (const p of this.P) {
      const s = r() < .5 ? -1 : 1, d = 18 + Math.pow(r(), 1.25) * 185;
      p.tab = { x: 300 + s * d, y: this.table - (p.type === 'saffron' ? 1.6 : p.wid * .5 * this.gs) - .4, rot: (r() - .5) * .5 + (r() < .5 ? 0 : Math.PI) };
    }
    // These grains join only after a confirmed connection; the checking orbit
    // never fills the bowl or suggests progress.
    const rainRandom = rng(211), rainCount = 64;
    this.rain = Array.from({ length: rainCount }, (_, i) => {
      const u = rainRandom() * 2 - 1, v = rainRandom(), x = 300 + u * 74;
      const mound = { x, y: this.b.y + Math.sqrt(1 - u * u) * (12 - 54 * v), rot: rainRandom() * TAU };
      const start = { x: x + (rainRandom() - .5) * 34, y: 58 + rainRandom() * 35, rot: rainRandom() * TAU, sc: 1, a: 0, layer: 2 };
      const side = rainRandom() < .5 ? -1 : 1;
      return { i, type: i % 13 === 0 ? 'gold' : 'rice', len: 8 + rainRandom() * 2, wid: 3 + rainRandom() * .7,
        mound, start, tab: { x: 300 + side * (25 + rainRandom() * 173), y: this.table - 2, rot: (rainRandom() - .5) * .3 },
        ...start, from: { ...start }, delay: .5 + i / rainCount * 1.5, duration: .65 + rainRandom() * .2 };
    });
    this.dec = { guide: 0, niche: 0, broken: 0, steam: 0, fill: 0 };
    this.decFrom = { ...this.dec };
  }
  private buildArch() {
    const a = 112, base = 200, foot = 346, R = 168, cxL = 300 - a + R, al = Math.acos((R - a) / R), left: number[][] = [];
    for (let i = 0; i <= 12; i++)
      left.push([300 - a, foot - (foot - base) * i / 12]);
    for (let i = 1; i <= 28; i++) {
      const ph = Math.PI + al * i / 28;
      left.push([cxL + R * Math.cos(ph), base + R * Math.sin(ph)]);
    }
    const right = left.slice(0, -1).reverse().map(([x, y]) => [600 - x, y]);
    this.arch = left.concat(right);
    const L = [0];
    for (let i = 1; i < this.arch.length; i++)
      L.push(L[i - 1] + Math.hypot(this.arch[i][0] - this.arch[i - 1][0], this.arch[i][1] - this.arch[i - 1][1]));
    this.archL = L;
    this.apexY = left[left.length - 1][1];
  }
  private archAt(s: number) {
    const g = .035, u = s <= .5 ? s / .5 * (.5 - g) : .5 + g + (s - .5) / .5 * (.5 - g), L = this.archL, d = u * L[L.length - 1];
    let i = 1;
    while (i < L.length - 1 && L[i] < d)
      i++;
    const a = this.arch[i - 1], b = this.arch[i], k = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
    return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  private orbitPose(p: OrbitParticle, t: number): Pose {
    const r = this.rings[p.ring], tb = t - p.ring * .22 - p.micro, P = 1.7, bb = tb / P, n = Math.floor(bb), f = bb - n;
    const kk = clamp(f / .6), e = E.inOut(kk), th = p.th0 + r.dir * (n + e) * r.step;
    const R = (r.R + p.dr) * (1 - .045 * Math.sin(Math.PI * kk));
    const lx = Math.cos(th) * R, ly = Math.sin(th) * R * r.tilt, tx = -Math.sin(th) * r.dir, ty = Math.cos(th) * r.tilt * r.dir;
    const cs = Math.cos(r.rot), sn = Math.sin(r.rot), depth = Math.sin(th);
    return { x: this.cx + lx * cs - ly * sn, y: this.cy + lx * sn + ly * cs, rot: Math.atan2(tx * sn + ty * cs, tx * cs - ty * sn), sc: .78 + .22 * (depth + 1) / 2, a: .55 + .45 * (depth + 1) / 2, layer: depth > 0 ? 2 : 0 };
  }
  private ringPt(r: Ring, th: number) { const lx = Math.cos(th) * r.R, ly = Math.sin(th) * r.R * r.tilt, c = Math.cos(r.rot), s = Math.sin(r.rot); return { x: this.cx + lx * c - ly * s, y: this.cy + lx * s + ly * c }; }
  private nod(t: number) { let ph = t - 1.5; if (ph < 0)
    return { sw: 0, ph: -1 }; ph %= 3.2; return { sw: ph < 1.3 ? .5 * Math.sin(ph * TAU / .62) * Math.exp(-ph * 2.6) : 0, ph }; }
  private archPose(p: OrbitParticle, t: number): Pose {
    if (p === this.key) {
      const n = this.nod(t), ang = Math.PI / 2 + n.sw, h = p.len * .75 * this.gs;
      return { x: 300 + Math.cos(ang) * h, y: this.apexY + 2 + Math.sin(ang) * h, rot: ang, sc: 1, a: 1, layer: 0 };
    }
    const q = p.archPt, nj = (p.r2 - .5) * 4 * this.gs;
    return { x: q.x - Math.sin(q.ang) * nj, y: q.y + Math.cos(q.ang) * nj, rot: q.ang + (p.r3 - .5) * .3, sc: 1, a: 1, layer: 0 };
  }
  private pose(st: ConnectionMotionState, p: OrbitParticle, t: number): Pose {
    if (st === 'checking')
      return this.orbitPose(p, t);
    if (st === 'open')
      return this.archPose(p, t);
    if (st === 'connected') {
      const s = p.mound;
      return { x: s.x, y: s.y, rot: s.rot, sc: 1, a: 1, layer: 1 };
    }
    const s = p.tab;
    return { x: s.x, y: s.y, rot: s.rot, sc: 1, a: 1, layer: 2 };
  }
  private trans(st: ConnectionMotionState, p: OrbitParticle) {
    if (st === 'checking')
      return [p.ring * .12 + p.i * .0035, 1.25];
    if (st === 'open')
      return p === this.key ? [.8, 1] : [p.archS * .55, 1];
    if (st === 'connected')
      return p.type === 'saffron' ? [2.55 + p.sj * .06, .7] : [p.rank / this.nRice, .85];
    return [p.r1 * .3, 1.15];
  }
  private origin(st: ConnectionMotionState, p: OrbitParticle): Pose {
    if (st === 'checking')
      return { x: 300 + (p.r1 - .5) * 24, y: this.b.y - 2 + (p.r2 - .5) * 6, rot: p.th0, sc: .3, a: 0, layer: 1 };
    return this.orbitPose(p, 0);
  }
  private capture(st: ConnectionMotionState, replay: boolean) {
    for (const p of this.P)
      p.from = replay ? this.origin(st, p) : { x: p.x, y: p.y, rot: p.rot, sc: p.sc, a: p.a, layer: p.layer };
    for (const p of this.rain)
      p.from = replay ? { ...p.start } : { x: p.x, y: p.y, rot: p.rot, sc: p.sc, a: p.a, layer: p.layer };
    this.decFrom = replay ? { guide: 0, niche: 0, broken: 0, steam: 0, fill: 0 } : { ...this.dec };
  }
  private blend(st: ConnectionMotionState, f: Pose, to: Pose, k: number): Pose {
    const o: Pose = { x: 0, y: 0, rot: 0, sc: lerp(f.sc, to.sc, k), a: lerp(f.a, to.a, Math.min(1, k * 1.6)), layer: k < .5 ? f.layer : to.layer };
    if (st === 'connected') {
      const e = E.inOut(k), ox = 300, oy = 232;
      const r0 = Math.hypot(f.x - ox, f.y - oy), a0 = Math.atan2(f.y - oy, f.x - ox), r1 = Math.hypot(to.x - ox, to.y - oy), a1 = Math.atan2(to.y - oy, to.x - ox);
      const d = (((a1 - a0) % TAU) + TAU) % TAU + Math.PI * .85, rr = lerp(r0, r1, e), aa = a0 + d * e;
      o.x = ox + Math.cos(aa) * rr;
      o.y = oy + Math.sin(aa) * rr;
      o.rot = lerpAng(f.rot, to.rot, e) + Math.sin(Math.PI * e) * 1.8;
      o.layer = k < .82 ? 2 : to.layer;
    }
    else if (st === 'failed') {
      const e = E.out(k);
      o.x = lerp(f.x, to.x, e);
      o.y = lerp(f.y, to.y, k * k);
      o.rot = lerpAng(f.rot, to.rot, e);
      o.layer = 2;
    }
    else {
      const e = E.inOut(k);
      o.x = lerp(f.x, to.x, e);
      o.y = lerp(f.y, to.y, e) - (st === 'open' ? Math.sin(Math.PI * e) * 22 : 0);
      o.rot = lerpAng(f.rot, to.rot, e);
    }
    return o;
  }
  private update() {
    const st = this.state, t = this.t;
    for (const p of this.P) {
      const [d, dur] = this.trans(st, p), to = this.pose(st, p, t), k = clamp((t - d) / dur);
      const v = k < 1 ? this.blend(st, p.from, to, k) : to;
      p.x = v.x;
      p.y = v.y;
      p.rot = v.rot;
      p.sc = v.sc;
      p.a = v.a;
      p.layer = v.layer;
      p.k = k;
    }
    for (const p of this.rain) {
      const f = p.from;
      if (st === 'connected') {
        const k = clamp((t - p.delay) / p.duration), start = f.a > .01 ? f : p.start;
        p.x = lerp(start.x, p.mound.x, E.sine(k));
        p.y = lerp(start.y, p.mound.y, k * k);
        p.rot = lerpAng(start.rot, p.mound.rot, k);
        p.a = lerp(start.a, 1, clamp(k * 5));
        p.layer = k < .96 ? 2 : 1;
      }
      else if (st === 'failed') {
        const k = clamp(t / .95);
        p.x = lerp(f.x, p.tab.x, E.out(k));
        p.y = lerp(f.y, p.tab.y, k * k);
        p.rot = lerpAng(f.rot, p.tab.rot, E.out(k));
        p.a = f.a;
        p.layer = 2;
      }
      else {
        p.a = f.a * (1 - clamp(t / .35));
      }
    }
    const f = this.decFrom, out = clamp(t / .45), dv = (n: keyof Decoration, on: boolean, val: number) => on ? Math.max(val, f[n] * (1 - out)) : f[n] * (1 - out);
    this.dec = { guide: dv('guide', st === 'checking', clamp((t - .3) / .8)), niche: dv('niche', st === 'open', clamp((t - .95) / .7)),
      broken: dv('broken', st === 'failed', clamp((t - 1.05) / .5)), steam: dv('steam', st === 'connected', clamp((t - 2.8) / 1.1)),
      fill: dv('fill', st === 'connected', E.sine(clamp((t - 1.1) / 1.65))) };
  }
  private staticTime() { return { checking: 3.32, open: 6.3, connected: 4.8, failed: 3 }[this.state]; }
  private draw() {
    if (!this.W)
      return;
    const ctx = this.begin(), gs = this.gs;
    ctx.fillStyle = 'rgba(38,58,46,.07)';
    ctx.beginPath();
    ctx.ellipse(300, this.table - 2, 96, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(38,58,46,.15)';
    ctx.lineWidth = gs * .9;
    ctx.beginPath();
    ctx.moveTo(92, this.table);
    ctx.lineTo(508, this.table);
    ctx.stroke();
    this.seal(ctx);
    if (this.dec.niche > .001)
      this.niche(ctx, this.dec.niche);
    this.layer(ctx, 0);
    this.bowlBack(ctx);
    this.riceBed(ctx);
    this.layer(ctx, 1);
    this.bowlFront(ctx);
    // Draw orbit ink above the bowl, then the foreground grains above the ink.
    this.guides(ctx, true);
    this.guides(ctx, false);
    if (this.dec.broken > .001)
      this.broken(ctx, this.dec.broken);
    this.layer(ctx, 2);
    if (this.dec.steam > .001)
      this.steam(ctx, this.dec.steam);
    this.knock(ctx);
  }
  private guides(ctx: CanvasRenderingContext2D, back: boolean) {
    const a = this.dec.guide;
    if (a <= .001)
      return;
    ctx.save();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = `rgba(49,91,70,${(this.reduced ? .32 : .18) * a})`;
    if (this.reduced)
      ctx.setLineDash([5, 8]);
    for (const r of this.rings) {
      ctx.beginPath();
      ctx.ellipse(this.cx, this.cy, r.R, r.R * r.tilt, r.rot, back ? Math.PI : 0, back ? TAU : Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }
  private niche(ctx: CanvasRenderingContext2D, a: number) {
    ctx.save();
    const path = () => { ctx.beginPath(); this.arch.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
    path();
    ctx.fillStyle = `rgba(223,227,217,${.8 * a})`;
    ctx.fill();
    ctx.translate(300, 346);
    ctx.scale(.86, .9);
    ctx.translate(-300, -346);
    path();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = `rgba(170,120,72,${.45 * a})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  private broken(ctx: CanvasRenderingContext2D, a: number) {
    const r = this.rings[2];
    ctx.save();
    ctx.strokeStyle = `rgba(170,120,72,${.6 * a})`;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.ellipse(this.cx, this.cy, r.R, r.R * r.tilt, r.rot, .42, TAU - .3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(170,120,72,${.85 * a})`;
    for (const th of [.42, TAU - .3]) {
      const q = this.ringPt(r, th);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  private riceBed(ctx: CanvasRenderingContext2D) {
    const amount = this.dec.fill;
    if (amount <= .001)
      return;
    const b = this.b, rx = 78 * Math.sqrt(amount), height = 44 * amount;
    ctx.save();
    this.bowlXf(ctx);
    ctx.fillStyle = '#f5eddb';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, rx, height, 0, Math.PI, TAU);
    ctx.ellipse(b.x, b.y, rx, 14, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  private layer(ctx: CanvasRenderingContext2D, L: number) {
    for (const p of this.rain)
      if (p.layer === L)
        this.grain(ctx, p);
    for (const p of this.P)
      if (p.layer === L && p.type !== 'saffron')
        this.grain(ctx, p);
    for (const p of this.saff)
      if (p.layer === L)
        this.grain(ctx, p);
  }
  private trail(ctx: CanvasRenderingContext2D, p: OrbitParticle) {
    let prev: {
      x: number;
      y: number;
    } | null = null;
    ctx.save();
    ctx.lineCap = 'round';
    for (let j = 0; j <= 9; j++) {
      const q = this.orbitPose(p, this.t - j * .03);
      if (prev) {
        ctx.strokeStyle = `rgba(170,120,72,${(1 - j / 10) * .55 * q.a})`;
        ctx.lineWidth = (1.8 - j * .12) * this.gs;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      prev = q;
    }
    ctx.restore();
  }
  private grain(ctx: CanvasRenderingContext2D, p: Grain) {
    if (p.a <= .01)
      return;
    const gs = this.gs * p.sc;
    if (p.type === 'saffron' && this.state === 'checking' && 'k' in p && Number(p.k) >= 1 && !this.reduced)
      this.trail(ctx, p as OrbitParticle);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.a;
    if (p.type === 'saffron') {
      const L = p.len * .75 * gs;
      ctx.strokeStyle = COL.copper;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.5 * gs;
      ctx.beginPath();
      ctx.moveTo(-L, 0);
      ctx.bezierCurveTo(-L * .3, -2.6 * gs, L * .3, 2.2 * gs, L, -.4 * gs);
      ctx.stroke();
      ctx.fillStyle = '#9a5f30';
      ctx.beginPath();
      ctx.ellipse(L, -.4 * gs, 2.1 * gs, 1.3 * gs, 0, 0, TAU);
      ctx.fill();
    }
    else {
      const L = p.len * .5 * gs, W = p.wid * .5 * gs;
      ctx.beginPath();
      ctx.moveTo(-L, 0);
      ctx.quadraticCurveTo(0, -W * 2, L, 0);
      ctx.quadraticCurveTo(0, W * 2, -L, 0);
      ctx.closePath();
      ctx.fillStyle = p.type === 'herb' ? COL.forest : p.type === 'gold' ? '#e3c193' : '#fffdf7';
      ctx.fill();
      if (p.type !== 'herb') {
        ctx.lineWidth = .85 * this.gs;
        ctx.strokeStyle = p.type === 'gold' ? 'rgba(170,120,72,.75)' : 'rgba(38,58,46,.55)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  private bowlXf(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'connected' || this.reduced)
      return;
    const q = clamp((this.t - .95) / .5);
    if (q <= 0 || q >= 1)
      return;
    const s = Math.sin(Math.PI * q) * .03, fy = this.b.y + this.b.d + 6;
    ctx.translate(300, fy);
    ctx.scale(1 + s * .6, 1 - s);
    ctx.translate(-300, -fy);
  }
  private bowlBack(ctx: CanvasRenderingContext2D) {
    const b = this.b;
    ctx.save();
    this.bowlXf(ctx);
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, TAU);
    const g = ctx.createLinearGradient(0, b.y - b.ry, 0, b.y + b.ry);
    g.addColorStop(0, '#1b2a21');
    g.addColorStop(1, '#2d4a3a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
  private bowlFront(ctx: CanvasRenderingContext2D) {
    const b = this.b, lw = Math.min(this.gs, 1.4);
    ctx.save();
    this.bowlXf(ctx);
    ctx.fillStyle = COL.ink;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + b.d + 1, 32, 7, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI);
    ctx.bezierCurveTo(b.x - b.rx, b.y + b.d * .78, b.x - b.rx * .5, b.y + b.d, b.x, b.y + b.d);
    ctx.bezierCurveTo(b.x + b.rx * .5, b.y + b.d, b.x + b.rx, b.y + b.d * .78, b.x + b.rx, b.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(b.x - b.rx, 0, b.x + b.rx, 0);
    g.addColorStop(0, '#3f6d56');
    g.addColorStop(.5, COL.forest);
    g.addColorStop(1, '#284a3a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = COL.copper;
    ctx.lineWidth = 2.2 * lw;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 15, b.rx * .95, b.ry * 1.05, 0, .1, Math.PI - .1);
    ctx.stroke();
    ctx.fillStyle = COL.copper;
    for (let i = 0; i < 7; i++) {
      const th = Math.PI * (.2 + i * .6 / 6);
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(th) * b.rx * .86, b.y + 28 + Math.sin(th) * b.ry * .95, 1.7 * lw, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(247,245,238,.22)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 2, b.rx * .84, b.d * .84, 0, Math.PI * .64, Math.PI * .84);
    ctx.stroke();
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 2.2 * lw;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  private steam(ctx: CanvasRenderingContext2D, a: number) {
    const t = this.t, T = this.T, con = this.state === 'connected';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4;
    for (let w = 0; w < 3; w++) {
      const g = con ? clamp((t - 2.8 - w * .2) / 1.1) : 1;
      if (g <= 0)
        continue;
      const x0 = 300 + (w - 1) * 18, y0 = this.b.y - 44, H = 64 * E.out(g);
      const grd = ctx.createLinearGradient(0, y0, 0, y0 - H);
      grd.addColorStop(0, 'rgba(49,91,70,0)');
      grd.addColorStop(.3, `rgba(49,91,70,${.38 * a})`);
      grd.addColorStop(1, 'rgba(49,91,70,0)');
      ctx.strokeStyle = grd;
      ctx.beginPath();
      for (let j = 0; j <= 18; j++) {
        const q = j / 18, y = y0 - q * H, x = x0 + Math.sin(q * 5.4 - T * 1.5 + w * 2.1) * (2 + 7 * q) * 1.3;
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  private seal(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'connected')
      return;
    for (const off of [0, .16]) {
      const q = clamp((this.t - 2.9 - off) / 1.25);
      if (q <= 0 || q >= 1)
        continue;
      const rx = 84 + E.out(q) * 150;
      ctx.save();
      ctx.strokeStyle = `rgba(170,120,72,${.55 * (1 - q)})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(300, this.table - 1, rx, rx * .12, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
  private knock(ctx: CanvasRenderingContext2D) {
    if (this.state !== 'open' || this.reduced)
      return;
    const n = this.nod(this.t);
    if (n.ph < 0 || n.ph >= 1)
      return;
    ctx.save();
    ctx.strokeStyle = `rgba(170,120,72,${.5 * (1 - n.ph)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(300, this.apexY + 4, 4 + E.out(n.ph) * 22, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}
