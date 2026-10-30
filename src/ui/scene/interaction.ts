/** More than a frame's normal input; discard overflow without drawing imaginary shortcuts. */
const MAX_SEGMENTS = 64;
const STRIDE = 7;
/** Natural finger jitter must not turn a single press into repeated pops. @package */
export const DRAG_SLOP_PX = 4;

/** Buffered viewport-CSS-pixel path, consumed by the scene once per frame. @package */
export class PointerStroke {
  // Segment start, delta and reciprocal squared length. Allocated once, not per pointermove.
  private readonly segments = new Float64Array(MAX_SEGMENTS * STRIDE);
  private count = 0;
  private active = false;
  private dragged = false;
  private hitPadding = 0;
  private tapIndex = -1;
  private x = 0;
  private y = 0;

  get length(): number {
    return this.count;
  }

  begin(x: number, y: number, padding: number): void {
    this.active = true;
    this.dragged = false;
    this.hitPadding = padding;
    this.x = x;
    this.y = y;
    this.tapIndex = this.count < MAX_SEGMENTS ? this.count : -1;
    this.append(x, y, 0, 0, true);
  }

  move(x: number, y: number): void {
    if (!this.active || (x === this.x && y === this.y)) return;
    if (!this.dragged && (x - this.x) ** 2 + (y - this.y) ** 2 <= DRAG_SLOP_PX ** 2) {
      return;
    }
    this.dragged = true;
    if (this.tapIndex >= 0) this.segments[this.tapIndex * STRIDE + 5] = 0;
    this.append(this.x, this.y, x - this.x, y - this.y, false);
    // Even after overflow the next frame starts at the real last point, never a diagonal
    // from the last stored point across the omitted part of the gesture.
    this.x = x;
    this.y = y;
  }

  finish(): void {
    this.active = false;
  }

  cancel(): void {
    this.active = false;
    this.drain();
  }

  drain(): void {
    this.count = 0;
    this.tapIndex = -1;
  }

  isTap(index: number): boolean {
    return this.segments[index * STRIDE + 5] === 1;
  }

  distanceSq(x: number, y: number, index = 0): number {
    if (index >= this.count) return Number.POSITIVE_INFINITY;
    const i = index * STRIDE;
    return (x - (this.segments[i] as number)) ** 2 + (y - (this.segments[i + 1] as number)) ** 2;
  }

  hits(x: number, y: number, radius: number, index = -1): boolean {
    const from = Math.max(0, index);
    const until = index < 0 ? this.count : index + 1;
    for (let i = from * STRIDE; i < until * STRIDE; i += STRIDE) {
      // count is bounded by the fixed buffer; every component in this range was written.
      const ax = this.segments[i] as number;
      const ay = this.segments[i + 1] as number;
      const dx = this.segments[i + 2] as number;
      const dy = this.segments[i + 3] as number;
      const inv = this.segments[i + 4] as number;
      const r2 = (radius + (this.segments[i + 6] as number)) ** 2;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) * inv));
      if ((x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r2) return true;
    }
    return false;
  }

  private append(x: number, y: number, dx: number, dy: number, tap: boolean): void {
    if (this.count === MAX_SEGMENTS) return;
    const i = this.count++ * STRIDE;
    this.segments[i] = x;
    this.segments[i + 1] = y;
    this.segments[i + 2] = dx;
    this.segments[i + 3] = dy;
    const lengthSq = dx * dx + dy * dy;
    this.segments[i + 4] = lengthSq > 0 ? 1 / lengthSq : 0;
    this.segments[i + 5] = tap ? 1 : 0;
    this.segments[i + 6] = this.hitPadding;
  }
}
