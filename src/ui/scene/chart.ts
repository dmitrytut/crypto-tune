import { type EventMarker, type HistorySeries, SIZE_CLASSES } from '../../metrics/history';
import { durationLabel } from '../format';
import {
  css,
  DOWN_COLOR,
  isDown,
  sideColor,
  spectrumColor,
  tensionColor,
  UP_COLOR,
} from '../palette';
import { fitCanvas } from './canvas';
import { sizeDecades } from './spawn';
import { spectrumCells } from './spectrum';
import { haloSprite } from './sprites';
import { lineColumns, smoothLine } from './surface';

/** Spectrogram band along the bottom and its gap to the price area above, CSS px. */
const BAND_PX = 20;
const BAND_GAP_PX = 6;
/** Spectrogram column width to aim for, CSS px: the time a column covers follows the width. */
const CELL_PX = 5;
/** Gaps between spectrogram cells, CSS px. */
const CELL_GAP_PX = 0.7;
const ROW_GAP_PX = 0.6;
/** Opacity of a silent spectrogram cell (the grid stays faintly visible) and the busiest one. */
const EMPTY_CELL_ALPHA = 0.08;
const FULL_CELL_ALPHA = 0.93;
/** Vertical padding of the price range so the line never touches the edges. */
const PRICE_PAD = 0.12;
/** Tension colour stops along the fill: every Nth point is plenty for a gradient. */
const GRADIENT_EVERY = 6;
/** Shortest span drawn: a fresh live session fills the width instead of hugging the right edge. */
const MIN_SPAN_MS = 30_000;
/** Marker radius at the smallest size; each decade of `sizeDecades` adds MARKER_GROWTH px. */
const MARKER_BASE_R = 1.5;
const MARKER_GROWTH = 0.8;
/** A chart narrower than this (a phone) draws its markers MARKER_NARROW_SCALE smaller, CSS px. */
const NARROW_PX = 600;
const MARKER_NARROW_SCALE = 0.75;
/** Glow around a marker: its radius over the marker's. */
const HALO_SCALE = 2.6;
/** Fill of a trade marker inside its ring. */
const RING_FILL_ALPHA = 0.15;
/** The oldest marker on the chart keeps this much of its opacity; the newest has all of it. */
const OLDEST_MARKER_ALPHA = 0.35;
/** A new marker sends a ring out this long (wall clock), this many px past its edge. */
const RIPPLE_MS = 400;
const RIPPLE_PX = 12;
/** Markers older than this on arrival (feed clock) are catch-up: no ripple. */
const RIPPLE_MAX_AGE_MS = 2_000;
/** Pointer tolerance around a marker, CSS px: small markers stay easy to hit. */
const HIT_SLOP_PX = 5;
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
 * tension at each moment, event markers on the line, and below it a spectrogram of trade
 * sizes (rows) over time (columns). No axes: it is ambience, the exact numbers live in the
 * readout.
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
  /** Ripple bookkeeping: the history drawn last, its newest marker, and when new ones arrived. */
  private rippleHistory: HistorySeries | null = null;
  private seenMarkerTs = Number.NEGATIVE_INFINITY;
  /** Markers after this timestamp are the ones that arrived at `rippleAt` (wall clock). */
  private rippleSince = Number.NEGATIVE_INFINITY;
  private rippleAt = 0;
  /** Price range on screen, easing toward the data's; `history` null makes the next draw snap. */
  private readonly scale = { lo: 0, hi: 0, at: 0, history: null as HistorySeries | null };
  /** The spectrogram band as last rendered, and the view it was rendered for. */
  private readonly band = {
    canvas: document.createElement('canvas'),
    key: '',
    history: null as HistorySeries | null,
  };

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
    const oldest = Math.min(h.prices[0]?.ts ?? now, h.spectrum[0]?.ts ?? now);
    const span = Math.min(periodMs, Math.max(MIN_SPAN_MS, now - oldest));
    const from = now - span;
    view.history = null;
    this.line = null;
    view.from = from;
    view.span = span;
    view.w = w;
    view.markerScale = w < NARROW_PX ? MARKER_NARROW_SCALE : 1;
    const x = (ts: number) => ((ts - from) / span) * w;
    this.drawSpectrum(h, from, span, w, ht - BAND_PX, dpr);
    return this.drawPrice(h, x, ht, from, now);
  }

  /**
   * The event marker under a point of the canvas (CSS pixels), nearest first, with its
   * centre and radius as last drawn; null when the pointer is not on one.
   */
  markerAt(px: number, py: number): MarkerHit | null {
    const { history: h, from, span, w, lo, hi, bottom } = this.view;
    if (!h) return null;
    let best: MarkerHit | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const m of h.markers) {
      if (m.ts < from) continue;
      const price = h.priceAt(m.ts);
      if (Number.isNaN(price)) continue;
      const x = ((m.ts - from) / span) * w;
      // On the line as drawn (smoothed); at its very ends, at the price.
      const y = this.lineY(x) ?? bottom - ((price - lo) / (hi - lo)) * bottom;
      const r = markerRadius(m.usd, this.view.markerScale);
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (d2 <= (r + HIT_SLOP_PX) ** 2 && d2 < bestD2) {
        bestD2 = d2;
        best = { marker: m, x, y, r };
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
    const bottom = ht - BAND_PX - BAND_GAP_PX;
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

    const rippling = this.drawMarkers(h, x, y, from, now);
    // Head of the line, in the current tension colour.
    ctx.beginPath();
    ctx.arc(x1, y(last.price), 3, 0, Math.PI * 2);
    ctx.fillStyle = css(tensionColor(last.tension));
    ctx.fill();
    return rippling || easing;
  }

  /**
   * Event markers on the line: a ring (trades) or a dot (liquidations) in a soft halo, fading
   * toward the past. Markers new since the last draw send a ring out; returns whether one is
   * still spreading.
   */
  private drawMarkers(
    h: HistorySeries,
    x: (ts: number) => number,
    y: (price: number) => number,
    from: number,
    now: number,
  ): boolean {
    const { ctx, view } = this;
    const wall = performance.now();
    const newest = h.markers.at(-1)?.ts ?? Number.NEGATIVE_INFINITY;
    if (h !== this.rippleHistory) {
      // A new pair or freshly loaded history: what is there already is not news.
      this.rippleHistory = h;
      this.rippleSince = newest;
      this.seenMarkerTs = newest;
    } else if (newest > this.seenMarkerTs) {
      this.rippleSince = this.seenMarkerTs;
      this.seenMarkerTs = newest;
      this.rippleAt = wall;
    }
    const progress = this.reducedMotion.matches ? 1 : (wall - this.rippleAt) / RIPPLE_MS;
    let rippling = false;
    for (const m of h.markers) {
      if (m.ts < from) continue;
      const price = h.priceAt(m.ts);
      if (Number.isNaN(price)) continue;
      const c = sideColor(m.side);
      const r = markerRadius(m.usd, view.markerScale);
      const mx = x(m.ts);
      const my = this.lineY(mx) ?? y(price);
      ctx.globalAlpha = OLDEST_MARKER_ALPHA + (1 - OLDEST_MARKER_ALPHA) * Math.min(1, mx / view.w);
      const halo = r * HALO_SCALE;
      ctx.drawImage(
        isDown(m.side) ? this.halos.down : this.halos.up,
        mx - halo,
        my - halo,
        halo * 2,
        halo * 2,
      );
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      if (m.kind === 'liquidation') {
        ctx.fillStyle = css(c, 0.95);
        ctx.fill();
      } else {
        ctx.fillStyle = css(c, RING_FILL_ALPHA);
        ctx.fill();
        ctx.strokeStyle = css(c, 0.95);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (progress < 1 && m.ts > this.rippleSince && m.ts >= now - RIPPLE_MAX_AGE_MS) {
        rippling = true;
        ctx.beginPath();
        ctx.arc(mx, my, r + RIPPLE_PX * progress, 0, Math.PI * 2);
        ctx.strokeStyle = css(c, 0.6 * (1 - progress));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    return rippling;
  }

  /**
   * Trade sizes over time in a band along the bottom: a column per CELL_PX, a row per size class
   * (the biggest on top), brighter where that class trades more, tinted by who is buying.
   * Rendered once per view and reused while only the line animates.
   */
  private drawSpectrum(
    h: HistorySeries,
    from: number,
    span: number,
    w: number,
    top: number,
    dpr: number,
  ): void {
    const b = this.band;
    const key = `${from}|${span}|${w}|${dpr}`;
    if (key !== b.key || h !== b.history) {
      b.key = key;
      b.history = h;
      // Resizing also clears the canvas and resets its transform.
      b.canvas.width = Math.ceil(w * dpr);
      b.canvas.height = Math.ceil(BAND_PX * dpr);
      const g = b.canvas.getContext('2d');
      if (!g) return;
      g.scale(dpr, dpr);
      const cols = Math.max(1, Math.floor(w / CELL_PX));
      const cells = spectrumCells(h.spectrum, from, span, cols);
      const cw = w / cols;
      const rh = BAND_PX / SIZE_CLASSES;
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < SIZE_CLASSES; k++) {
          const i = c * SIZE_CLASSES + k;
          const level = cells.level[i] as number;
          g.fillStyle = css(
            spectrumColor(cells.buyShare[i] as number),
            EMPTY_CELL_ALPHA + (FULL_CELL_ALPHA - EMPTY_CELL_ALPHA) * level,
          );
          g.fillRect(c * cw, (SIZE_CLASSES - 1 - k) * rh, cw - CELL_GAP_PX, rh - ROW_GAP_PX);
        }
      }
    }
    this.ctx.drawImage(b.canvas, 0, top, w, BAND_PX);
  }
}
