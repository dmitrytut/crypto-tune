import { DRAG_SLOP_PX } from './interaction';

const RING_MS = 280;
const TRAIL_MS = 180;
/** Fixed storage: pointer-event floods recycle old marks rather than grow the scene. */
const MAX_MARKS = 128;
const STRIDE = 5;

/** Quiet, neutral input marks, separate from the market's buy/sell colours. @package */
export class GestureFeedback {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly color: string;
  // Start, end and birth time. A zero-length mark is a press ring.
  private readonly marks = new Float64Array(MAX_MARKS * STRIDE);
  private next = 0;
  private count = 0;
  private active = false;
  private x = 0;
  private y = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly reducedMotion: MediaQueryList,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.color = getComputedStyle(canvas).color;
  }

  begin(x: number, y: number): void {
    this.active = true;
    this.x = x;
    this.y = y;
    this.append(x, y, x, y);
  }

  move(x: number, y: number): void {
    if (!this.active || (x - this.x) ** 2 + (y - this.y) ** 2 <= DRAG_SLOP_PX ** 2) return;
    if (!this.reducedMotion.matches) this.append(this.x, this.y, x, y);
    this.x = x;
    this.y = y;
  }

  finish(): void {
    this.active = false;
  }

  clear(): void {
    this.active = false;
    this.count = 0;
    this.next = 0;
  }

  /** Draw after Fx.frame, which already fits and clears the shared viewport canvas. */
  draw(now: number): void {
    if (this.count === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    for (let n = 0; n < this.count; n++) {
      const i = ((this.next - this.count + n + MAX_MARKS) % MAX_MARKS) * STRIDE;
      const x = this.marks[i] as number;
      const y = this.marks[i + 1] as number;
      const endX = this.marks[i + 2] as number;
      const endY = this.marks[i + 3] as number;
      const ring = x === endX && y === endY;
      // Input may arrive after this frame's rAF timestamp but before its draw callback.
      const age = Math.max(0, now - (this.marks[i + 4] as number));
      const t = age / (ring ? RING_MS : TRAIL_MS);
      if (t >= 1) continue;
      const fade = 1 - t;
      ctx.globalAlpha = (ring ? 0.4 : 0.28) * fade * fade;
      ctx.lineWidth = ring ? 1 : 1.5 * fade + 0.5;
      ctx.beginPath();
      if (ring) {
        const radius = this.reducedMotion.matches ? 8 : 6 + 16 * (1 - fade ** 3);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Expired marks at the front leave the ring buffer without copying its remaining path.
    while (this.count > 0) {
      const i = ((this.next - this.count + MAX_MARKS) % MAX_MARKS) * STRIDE;
      if (now - (this.marks[i + 4] as number) < RING_MS) break;
      this.count--;
    }
  }

  private append(x: number, y: number, endX: number, endY: number): void {
    const i = this.next * STRIDE;
    this.marks[i] = x;
    this.marks[i + 1] = y;
    this.marks[i + 2] = endX;
    this.marks[i + 3] = endY;
    this.marks[i + 4] = performance.now();
    this.next = (this.next + 1) % MAX_MARKS;
    this.count = Math.min(this.count + 1, MAX_MARKS);
  }
}
