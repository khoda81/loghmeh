// Wheel events arrive in pixels, lines, or pages. Consume one gesture at a time
// so trackpad momentum cannot race through several weeks and queue menu requests.
export class WeekScrollGesture {
  private lastEvent = -Infinity;
  private distance = 0;
  private navigated = false;

  reset() {
    this.lastEvent = -Infinity;
    this.distance = 0;
    this.navigated = false;
  }

  push(deltaX: number, deltaY: number, deltaMode: number, now: number): -1 | 0 | 1 {
    if (now - this.lastEvent > 220) this.reset();
    this.lastEvent = now;
    if (this.navigated) return 0;
    const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    this.distance += delta * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
    if (Math.abs(this.distance) < 48) return 0;
    this.navigated = true;
    return this.distance > 0 ? 1 : -1;
  }
}
