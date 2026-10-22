import { HISTORY_WINDOW_MS, type HistorySeries, VOLUME_BUCKET_MS } from '../../metrics/history';
import { css, DOWN_COLOR, tensionColor, UP_COLOR } from '../palette';

const MAX_DPR = 2;
/** Share of the height for the price line; the rest is the volume band. */
const PRICE_SHARE = 0.66;
/** Vertical padding of the price range so the line never touches the edges. */
const PRICE_PAD = 0.12;
/** Tension colour stops along the fill: every Nth point is plenty for a gradient. */
const GRADIENT_EVERY = 6;
/** Shortest span drawn: a fresh live session fills the width instead of hugging the right edge. */
const MIN_SPAN_MS = 2 * 60_000;

/**
 * Bottom strip: up to the last 15 minutes of price with the area under the line
 * tinted by tension at each moment, buy volume up / sell volume down per
 * 10 s below it, and event markers on the line. No axes — it is ambience,
 * the exact numbers live in the readout.
 */
export class Chart {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  draw(h: HistorySeries, now: number): void {
    const { ctx, canvas } = this;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const ht = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(ht * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(ht * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);
    // Grow with the history until it covers the full window.
    const oldest = Math.min(h.prices[0]?.ts ?? now, h.volumes[0]?.ts ?? now);
    const span = Math.min(HISTORY_WINDOW_MS, Math.max(MIN_SPAN_MS, now - oldest));
    const from = now - span;
    const x = (ts: number) => ((ts - from) / span) * w;
    this.drawVolume(h, x, (VOLUME_BUCKET_MS / span) * w, ht, from);
    this.drawPrice(h, x, ht, from);
  }

  private drawPrice(h: HistorySeries, x: (ts: number) => number, ht: number, from: number): void {
    const pts = h.prices.filter((p) => p.ts >= from);
    if (pts.length < 2) return;
    const { ctx } = this;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      lo = Math.min(lo, p.price);
      hi = Math.max(hi, p.price);
    }
    const span = hi - lo || hi * 1e-4 || 1;
    lo -= span * PRICE_PAD;
    hi += span * PRICE_PAD;
    const bottom = ht * PRICE_SHARE;
    const y = (price: number) => bottom - ((price - lo) / (hi - lo)) * bottom;

    const first = pts[0];
    const last = pts.at(-1);
    if (!first || !last) return;
    const x0 = x(first.ts);
    const x1 = x(last.ts);

    // Area under the line, coloured by tension at each moment.
    const fill = ctx.createLinearGradient(x0, 0, x1, 0);
    for (let i = 0; i < pts.length; i += GRADIENT_EVERY) {
      const p = pts[i];
      if (!p) continue;
      fill.addColorStop((x(p.ts) - x0) / (x1 - x0 || 1), css(tensionColor(p.tension), 0.3));
    }
    fill.addColorStop(1, css(tensionColor(last.tension), 0.3));
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (const p of pts) ctx.lineTo(x(p.ts), y(p.price));
    ctx.lineTo(x1, bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // Fade the area toward its base so it reads as a glow under the line, not a slab.
    const fade = ctx.createLinearGradient(0, y(hi - (hi - lo) * PRICE_PAD), 0, bottom);
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(x0, 0, x1 - x0 + 1, bottom);
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    for (const [i, p] of pts.entries()) {
      if (i === 0) ctx.moveTo(x(p.ts), y(p.price));
      else ctx.lineTo(x(p.ts), y(p.price));
    }
    const glow = tensionColor(last.tension);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = css(glow, 0.9);
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (const m of h.markers) {
      if (m.ts < from) continue;
      const price = h.priceAt(m.ts);
      if (Number.isNaN(price)) continue;
      const down = m.side === 'long' || m.side === 'sell';
      const color = css(down ? DOWN_COLOR : UP_COLOR, 0.95);
      const r = 2 + Math.min(4, Math.max(0, Math.log10(m.usd / 10_000)) * 1.5);
      ctx.beginPath();
      ctx.arc(x(m.ts), y(price), r, 0, Math.PI * 2);
      if (m.kind === 'liquidation') {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Head of the line.
    ctx.beginPath();
    ctx.arc(x1, y(last.price), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = css(glow, 1);
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private drawVolume(
    h: HistorySeries,
    x: (ts: number) => number,
    bucketPx: number,
    ht: number,
    from: number,
  ): void {
    const bars = h.volumes.filter((b) => b.ts + VOLUME_BUCKET_MS > from);
    if (bars.length === 0) return;
    const { ctx } = this;
    let peak = 0;
    for (const b of bars) peak = Math.max(peak, b.buyUsd, b.sellUsd);
    if (peak === 0) return;
    const top = ht * PRICE_SHARE + 4;
    const mid = top + (ht - top) / 2;
    const half = (ht - top) / 2 - 1;
    const barW = Math.max(1, bucketPx - 1.5);
    for (const b of bars) {
      const bx = x(b.ts);
      const up = (b.buyUsd / peak) * half;
      const down = (b.sellUsd / peak) * half;
      ctx.fillStyle = css(UP_COLOR, 0.55);
      ctx.fillRect(bx, mid - up, barW, up);
      ctx.fillStyle = css(DOWN_COLOR, 0.55);
      ctx.fillRect(bx, mid, barW, down);
    }
  }
}
