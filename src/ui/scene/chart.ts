import { type EventMarker, type HistorySeries, VOLUME_BUCKET_MS } from '../../metrics/history';
import { durationLabel } from '../format';
import { css, DOWN_COLOR, isDown, sideColor, tensionColor, UP_COLOR } from '../palette';
import { fitCanvas } from './canvas';
import { sizeDecades } from './spawn';
import { haloSprite } from './sprites';
import { lineColumns, smoothLine } from './surface';

/** Share of the height for the price line; the rest is the volume band. */
const PRICE_SHARE = 0.66;
/** Vertical padding of the price range so the line never touches the edges. */
const PRICE_PAD = 0.12;
/** Tension colour stops along the fill: every Nth point is plenty for a gradient. */
const GRADIENT_EVERY = 6;
/** Shortest span drawn: a fresh live session fills the width instead of hugging the right edge. */
const MIN_SPAN_MS = 30_000;
/** Marker radius at the smallest size; each decade of `sizeDecades` adds MARKER_GROWTH px. */
const MARKER_BASE_R = 2;
const MARKER_GROWTH = 1.1;
/** A chart narrower than this (a phone) draws its markers MARKER_NARROW_SCALE smaller, CSS px. */
const NARROW_PX = 600;
const MARKER_NARROW_SCALE = 0.75;
/** Glow around a marker: its radius over the marker's. */
const HALO_SCALE = 2.6;
/** Fill of a trade marker inside its ring. */
const RING_FILL_ALPHA = 0.15;
/** The oldest marker on the chart keeps this much of its opacity; the newest has all of it. */
const OLDEST_MARKER_ALPHA = 0.35;
/** A new marker pops in: grows past its size by the ease-out-back overshoot and settles, ms. */
const POP_MS = 350;
const POP_OVERSHOOT = 2.2;
/** Its halo starts this much bigger and brighter (1 + HALO_FLASH times) and calms with the pop. */
const HALO_FLASH = 1.6;
/** With it sparks fly out this far past its edge at the fastest and fade, px, ms. */
const SPARK_MS = 420;
const SPARK_PX = 22;
/** The slowest spark goes this share of the way. */
const SPARK_MIN_SPEED = 0.5;
/** Sparks per trade and per liquidation. */
const SPARKS = 6;
const SPARKS_LIQ = 10;
/** The whole arrival, pop and sparks. */
const ARRIVAL_MS = Math.max(POP_MS, SPARK_MS);
/** Markers older than this on arrival (feed clock) are catch-up: they just appear. */
const ARRIVAL_MAX_AGE_MS = 2_000;
/** Pointer tolerance around a marker, CSS px: small markers stay easy to hit. */
const HIT_SLOP_PX = 5;
/** Room right of the newest point, so a marker arriving there shows whole with its sparks, CSS px. */
const PLOT_RIGHT_INSET_PX = 16;
/** The price range follows a new high or low with this time constant (≈95 % in 3τ), ms. */
const SCALE_TAU_MS = 120;
/** Longest step of that easing: the first frame after a quiet tick does not jump, ms. */
const SCALE_MAX_STEP_MS = 34;
/** No draw for this long (hidden tab): the range snaps instead of easing from stale, ms. */
const SCALE_SNAP_AFTER_MS = 2_000;
/** The easing stops within this share of the range (well under a pixel). */
const SCALE_SETTLE = 0.002;

const markerRadius = (usd: number, scale: number) =>
  (MARKER_BASE_R + sizeDecades(usd) * MARKER_GROWTH) * scale;

/** A marker found under the pointer: the event and its circle in canvas CSS px. */
export interface MarkerHit {
  marker: EventMarker;
  x: number;
  y: number;
  r: number;
}

/**
 * Bottom strip: the chosen period of price as a smooth line with the area under it tinted by
 * tension at each moment, buy volume up / sell volume down per VOLUME_BUCKET_MS below it, and
 * event markers on the line. No axes — it is ambience, the exact numbers live in the readout.
 * @package
 */
export class Chart {
  private readonly ctx: CanvasRenderingContext2D;
  private labelledMs = 0;
  /** Scale of the last draw, for hit-testing markers; `history` is null when none were drawn. */
  private readonly view = {
    history: null as HistorySeries | null,
    from: 0,
    span: 1,
    /** Plot width: the canvas less PLOT_RIGHT_INSET_PX, CSS px. */
    w: 0,
    lo: 0,
    hi: 1,
    bottom: 0,
    /** Marker size factor: smaller on a narrow (phone) chart. */
    markerScale: 1,
  };
  /** Price line height per pixel column as last drawn, CSS px; null when no line was drawn. */
  private line: Float32Array | null = null;
  private lineBuf: Float32Array | undefined;
  private readonly halos = { up: haloSprite(UP_COLOR), down: haloSprite(DOWN_COLOR) };
  /** Wall-clock arrival of each marker that came in while drawn, for its pop and sparks. */
  private readonly arrivals = new WeakMap<EventMarker, number>();
  /** The history drawn last and its newest marker: anything newer has just arrived. */
  private arrivalHistory: HistorySeries | null = null;
  private seenMarkerTs = Number.NEGATIVE_INFINITY;
  /** Price range on screen, easing toward the data's; `history` null makes the next draw snap. */
  private readonly scale = { lo: 0, hi: 0, at: 0, history: null as HistorySeries | null };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: MediaQueryList,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  /**
   * Draws up to `periodMs` of history ending at `now`; a shorter history fills the width.
   * Returns true while something is still animating: draw again next frame.
   */
  draw(h: HistorySeries, now: number, periodMs: number): boolean {
    const { ctx, canvas, view } = this;
    if (periodMs !== this.labelledMs) {
      this.labelledMs = periodMs;
      canvas.setAttribute('aria-label', `Price and volume, last ${durationLabel(periodMs)}`);
      // Another period is another picture, not a move: no easing into it.
      this.scale.history = null;
    }
    const dpr = fitCanvas(canvas);
    const w = canvas.clientWidth;
    const ht = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);
    // Grow with the history until it covers the full period.
    const oldest = Math.min(h.prices[0]?.ts ?? now, h.volumes[0]?.ts ?? now);
    const span = Math.min(periodMs, Math.max(MIN_SPAN_MS, now - oldest));
    const from = now - span;
    view.history = null;
    this.line = null;
    view.from = from;
    view.span = span;
    // The plot stops short of the right edge: a new marker sits at "now" and pops in there.
    const plotW = Math.max(1, w - PLOT_RIGHT_INSET_PX);
    view.w = plotW;
    view.markerScale = w < NARROW_PX ? MARKER_NARROW_SCALE : 1;
    const x = (ts: number) => ((ts - from) / span) * plotW;
    this.drawVolume(h, x, (VOLUME_BUCKET_MS / span) * plotW, ht, from);
    return this.drawPrice(h, x, ht, from, now);
  }

  /**
   * The event marker under a point of the canvas (CSS pixels), nearest first, with its
   * centre and radius as last drawn; null when the pointer is not on one.
   */
  markerAt(px: number, py: number): MarkerHit | null {
    const h = this.view.history;
    if (!h) return null;
    let best: MarkerHit | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const m of h.markers) {
      const at = this.place(m);
      if (!at) continue;
      const d2 = (px - at.x) ** 2 + (py - at.y) ** 2;
      if (d2 <= (at.r + HIT_SLOP_PX) ** 2 && d2 < bestD2) {
        bestD2 = d2;
        best = { marker: m, ...at };
      }
    }
    return best;
  }

  /** Height of the price line at canvas column `px` (CSS px) as last drawn; null where none. */
  lineY(px: number): number | null {
    const y = this.line?.[Math.round(px)];
    return y === undefined || Number.isNaN(y) ? null : y;
  }

  private drawPrice(
    h: HistorySeries,
    x: (ts: number) => number,
    ht: number,
    from: number,
    now: number,
  ): boolean {
    const pts = h.prices.filter((p) => p.ts >= from);
    if (pts.length < 2) return false;
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
    // A new high or low eases the range over instead of jumping the whole line.
    const s = this.scale;
    const wall = performance.now();
    const snap = s.history !== h || this.reducedMotion.matches || wall - s.at > SCALE_SNAP_AFTER_MS;
    const k = snap ? 1 : 1 - Math.exp(-Math.min(wall - s.at, SCALE_MAX_STEP_MS) / SCALE_TAU_MS);
    s.lo += (lo - s.lo) * k;
    s.hi += (hi - s.hi) * k;
    s.at = wall;
    s.history = h;
    const settle = (hi - lo) * SCALE_SETTLE;
    const easing = Math.abs(s.lo - lo) > settle || Math.abs(s.hi - hi) > settle;
    if (!easing) {
      s.lo = lo;
      s.hi = hi;
    }
    lo = s.lo;
    hi = s.hi;
    const bottom = ht * PRICE_SHARE;
    const y = (price: number) => bottom - ((price - lo) / (hi - lo)) * bottom;
    // Markers are drawn from here on: remember the scale so markerAt finds them.
    this.view.history = h;
    this.view.lo = lo;
    this.view.hi = hi;
    this.view.bottom = bottom;

    const first = pts[0];
    const last = pts.at(-1);
    if (!first || !last) return false;
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
    const line = smoothLine(
      pts.map((p) => x(p.ts)),
      pts.map((p) => y(p.price)),
    );
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (const [i, lx] of line.xs.entries()) ctx.lineTo(lx, line.ys[i] as number);
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
    for (const [i, lx] of line.xs.entries()) {
      if (i === 0) ctx.moveTo(lx, line.ys[i] as number);
      else ctx.lineTo(lx, line.ys[i] as number);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Remember the line so particles and markers land on it (lineY).
    this.lineBuf = lineColumns(line.xs, line.ys, Math.ceil(this.view.w), this.lineBuf);
    this.line = this.lineBuf;

    // Head of the line, in the current tension colour; markers over it, the newest sits here.
    ctx.beginPath();
    ctx.arc(x1, y(last.price), 3, 0, Math.PI * 2);
    ctx.fillStyle = css(tensionColor(last.tension));
    ctx.fill();
    const arriving = this.drawMarkers(h, now);
    return arriving || easing;
  }

  /**
   * Event markers on the line: a ring (trades) or a dot (liquidations) in a soft halo, fading
   * toward the past. A marker new since the last draw pops in with a flash of its halo and throws
   * out sparks; returns whether one still is.
   */
  private drawMarkers(h: HistorySeries, now: number): boolean {
    const { ctx, view } = this;
    const wall = performance.now();
    const newest = h.markers.at(-1)?.ts ?? Number.NEGATIVE_INFINITY;
    if (h !== this.arrivalHistory) {
      // A new pair or freshly loaded history (its clock may differ): what is there is not news.
      this.arrivalHistory = h;
    } else {
      for (let i = h.markers.length - 1; i >= 0; i--) {
        const m = h.markers[i] as EventMarker;
        if (m.ts <= this.seenMarkerTs) break;
        if (m.ts >= now - ARRIVAL_MAX_AGE_MS) this.arrivals.set(m, wall);
      }
    }
    this.seenMarkerTs = newest;
    let animating = false;
    for (const m of h.markers) {
      const at = this.place(m);
      if (!at) continue;
      const arrived = this.reducedMotion.matches ? undefined : this.arrivals.get(m);
      const elapsed = arrived === undefined ? ARRIVAL_MS : wall - arrived;
      const fresh = elapsed < ARRIVAL_MS;
      animating ||= fresh;
      // Pop: grows from nothing past its size and settles (ease-out-back); the halo flashes.
      const p = Math.min(1, elapsed / POP_MS);
      const pop = 1 + (POP_OVERSHOOT + 1) * (p - 1) ** 3 + POP_OVERSHOOT * (p - 1) ** 2;
      const glow = 1 + HALO_FLASH * (1 - p);
      const c = sideColor(m.side);
      const liq = m.kind === 'liquidation';
      const alpha = OLDEST_MARKER_ALPHA + (1 - OLDEST_MARKER_ALPHA) * Math.min(1, at.x / view.w);
      const halo = at.r * HALO_SCALE * glow;
      ctx.globalAlpha = Math.min(1, alpha * glow);
      ctx.drawImage(
        isDown(m.side) ? this.halos.down : this.halos.up,
        at.x - halo,
        at.y - halo,
        halo * 2,
        halo * 2,
      );
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(at.x, at.y, at.r * Math.max(0, pop), 0, Math.PI * 2);
      if (liq) {
        ctx.fillStyle = css(c, 0.95);
        ctx.fill();
      } else {
        ctx.fillStyle = css(c, RING_FILL_ALPHA);
        ctx.fill();
        ctx.strokeStyle = css(c, 0.95);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Sparks: fly out (ease-out) and fade.
      const s = elapsed / SPARK_MS;
      if (s < 1) {
        const n = liq ? SPARKS_LIQ : SPARKS;
        const far = SPARK_PX * view.markerScale * (1 - (1 - s) ** 3);
        // Fixed per marker (seeded by its time): the same sparks every frame.
        const rand = (i: number) => {
          const v = Math.sin(m.ts * 0.001 + i * 12.9898) * 43758.5453;
          return v - Math.floor(v);
        };
        ctx.fillStyle = css(c, 1 - s);
        for (let k = 0; k < n; k++) {
          const a = ((k + rand(2 * k)) / n) * Math.PI * 2;
          const d = at.r + far * (SPARK_MIN_SPEED + (1 - SPARK_MIN_SPEED) * rand(2 * k + 1));
          ctx.fillRect(at.x + Math.cos(a) * d - 0.8, at.y + Math.sin(a) * d - 0.8, 1.6, 1.6);
        }
      }
    }
    ctx.globalAlpha = 1;
    return animating;
  }

  /**
   * Where a marker sits as last drawn: on the smoothed line at its time, at its price past the
   * line's ends; null when it is out of view or there is no price.
   */
  private place(m: EventMarker): { x: number; y: number; r: number } | null {
    const { history: h, from, span, w, lo, hi, bottom, markerScale } = this.view;
    if (!h || m.ts < from) return null;
    const price = h.priceAt(m.ts);
    if (Number.isNaN(price)) return null;
    const x = ((m.ts - from) / span) * w;
    const y = this.lineY(x) ?? bottom - ((price - lo) / (hi - lo)) * bottom;
    return { x, y, r: markerRadius(m.usd, markerScale) };
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
