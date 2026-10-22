import type { LiquidationSide, TradeSide } from '../../feed/market-feed';
import { usdFmt } from '../format';
import { css, DOWN_COLOR, type Rgb, sideColor, UP_COLOR } from '../palette';
import { fitCanvas } from './canvas';
import { bubbleStart, planSpawns, sizeDecades } from './spawn';

/** Live bubbles cap; above it the oldest are recycled. */
const MAX_BUBBLES = 1_500;
/** Bubbles created per frame; a burst beyond this merges into larger ones. */
const SPAWN_BUDGET = 120;
const SPRITE_PX = 128;
const FADE_IN_SEC = 0.35;
/** Last share of a bubble's life spent fading out. */
const FADE_OUT_SHARE = 0.4;
const RING_SEC = 1.8;
const SHARD_SEC = 1.1;
const LABEL_SEC = 2.4;

/**
 * Side effects outside the overlay: the aura reacts where the event happened.
 * @package
 */
export interface FxHooks {
  bloom(x: number, y: number, color: Rgb, strength: number): void;
  shock(x: number, y: number, strength: number): void;
  shake(strength: number): void;
}

interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  r: number;
  age: number;
  life: number;
  phase: number;
  sprite: HTMLCanvasElement;
  halo: HTMLCanvasElement | null;
}

interface Ring {
  age: number;
  delay: number;
  maxR: number;
  width: number;
  alpha: number;
  color: Rgb;
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  color: Rgb;
}

interface Label {
  x: number;
  y: number;
  age: number;
  text: string;
  color: Rgb;
  size: number;
}

/** A sprite square filled with a radial gradient through `stops` (offset, CSS colour). */
function radialSprite(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = SPRITE_PX;
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/** Soap bubble: clear centre, bright rim, specular glint. Reads as "rising, light". */
function bubbleSprite(c: Rgb): HTMLCanvasElement {
  const s = radialSprite([
    [0, css(c, 0.16)],
    [0.62, css(c, 0.22)],
    [0.84, css(c, 0.95)],
    [0.92, css(c, 0.4)],
    [1, css(c, 0)],
  ]);
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const glint = g.createRadialGradient(h * 0.68, h * 0.62, 0, h * 0.68, h * 0.62, h * 0.24);
  glint.addColorStop(0, 'rgba(255,255,255,0.9)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/** Ember drop: hot white core in a coloured glow. Reads as "falling, heavy". */
const dropSprite = (c: Rgb) =>
  radialSprite([
    [0, 'rgba(255,255,255,0.95)'],
    [0.22, css(c, 0.95)],
    [0.55, css(c, 0.35)],
    [1, css(c, 0)],
  ]);

const haloSprite = (c: Rgb) =>
  radialSprite([
    [0, css(c, 0.5)],
    [0.4, css(c, 0.16)],
    [1, css(c, 0)],
  ]);

/**
 * Overlay canvas for market events.
 * - Every buy is a bubble rising from the chart, every sell a glowing drop
 *   sinking from the top; size by log notional. Big trades get a halo, a
 *   floating amount and a light burst in the aura.
 * - Every liquidation bursts at the price: double ring, shards, and (above the
 *   threshold) an aura shock wave, a label and, for huge ones, a screen shake.
 * @package
 */
export class Fx {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: Record<TradeSide, HTMLCanvasElement>;
  private readonly halos: Record<TradeSide, HTMLCanvasElement>;
  private bubbles: Bubble[] = [];
  private rings: Ring[] = [];
  private shards: Shard[] = [];
  private labels: Label[] = [];
  private queued: { side: TradeSide; usd: number }[] = [];
  private origin = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: FxHooks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.sprites = { buy: bubbleSprite(UP_COLOR), sell: dropSprite(DOWN_COLOR) };
    this.halos = { buy: haloSprite(UP_COLOR), sell: haloSprite(DOWN_COLOR) };
  }

  /** Where liquidations burst, CSS pixels (centre of the price). */
  setOrigin(x: number, y: number): void {
    this.origin = { x, y };
  }

  trade(side: TradeSide, usd: number): void {
    this.queued.push({ side, usd });
  }

  liquidation(side: LiquidationSide, usd: number, thresholdUsd: number): void {
    const color = sideColor(side);
    const short = Math.min(this.canvas.clientWidth, this.canvas.clientHeight);
    const d = sizeDecades(usd);
    const above = Math.log10(usd / thresholdUsd);
    const major = above >= 0;
    // Below-threshold liquidations still ripple, faintly: you see the cascade build.
    const alpha = major ? Math.min(1, 0.65 + 0.2 * above) : 0.22;
    const maxR = short * (0.22 + 0.13 * d);
    this.rings.push({ age: 0, delay: 0, maxR, width: major ? 7 : 2, alpha, color });
    if (!major) return;
    this.rings.push({ age: 0, delay: 0.14, maxR: maxR * 0.7, width: 3, alpha: alpha * 0.7, color });
    const { x, y } = this.origin;
    const n = Math.round(18 + 12 * Math.min(2, above));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const v = (180 + 220 * Math.random()) * (1 + 0.3 * d);
      this.shards.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, color });
    }
    this.labels.push({
      x,
      y: y - 90,
      age: 0,
      text: `LIQUIDATION ${side.toUpperCase()} ${usdFmt.format(usd)}`,
      color,
      size: 15,
    });
    this.hooks.shock(x, y, Math.min(1, 0.55 + 0.25 * above));
    if (above >= 1) this.hooks.shake(Math.min(1, above / 2));
  }

  /** Drop anything queued, e.g. while the tab was hidden. */
  clear(): void {
    this.queued = [];
    this.bubbles = [];
    this.rings = [];
    this.shards = [];
    this.labels = [];
  }

  frame(dtSec: number, bigTradeUsd: number): void {
    const dt = Math.min(dtSec, 0.1);
    const dpr = fitCanvas(this.canvas);
    this.spawn(bigTradeUsd);
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    this.drawBubbles(dt, h);
    this.drawRings(dt);
    this.drawShards(dt);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.drawLabels(dt);
  }

  private spawn(bigTradeUsd: number): void {
    if (this.queued.length === 0) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const s of planSpawns(this.queued, SPAWN_BUDGET, bigTradeUsd)) {
      const b = bubbleStart(s.side, s.usd, s.big, w, h, Math.random);
      this.bubbles.push({
        ...b,
        age: 0,
        phase: Math.random() * Math.PI * 2,
        sprite: this.sprites[s.side],
        halo: s.big ? this.halos[s.side] : null,
      });
      if (s.big) {
        const color = sideColor(s.side);
        const sign = s.side === 'buy' ? '+' : '−';
        this.labels.push({
          x: b.x,
          y: b.y - b.r - 14,
          age: 0,
          text: `${sign}${usdFmt.format(s.usd)}`,
          color,
          size: 13,
        });
        this.hooks.bloom(b.x, b.y, color, 0.45 + 0.25 * Math.log10(s.usd / bigTradeUsd + 1));
      }
    }
    this.queued = [];
    if (this.bubbles.length > MAX_BUBBLES)
      this.bubbles.splice(0, this.bubbles.length - MAX_BUBBLES);
  }

  private drawBubbles(dt: number, h: number): void {
    const { ctx } = this;
    let alive = 0;
    for (const b of this.bubbles) {
      b.age += dt;
      if (b.age >= b.life || b.y < -b.r * 4 || b.y > h + b.r * 4) continue;
      b.vy += b.ay * dt;
      // Gentle sideways sway; bigger bubbles sway slower and wider, like real ones.
      b.x += (b.vx + Math.sin(b.age * (2.6 - b.r * 0.05) + b.phase) * (8 + b.r)) * dt;
      b.y += b.vy * dt;
      const fadeIn = Math.min(1, b.age / FADE_IN_SEC);
      const outStart = b.life * (1 - FADE_OUT_SHARE);
      const fadeOut = b.age < outStart ? 1 : 1 - (b.age - outStart) / (b.life - outStart);
      const a = fadeIn * fadeOut;
      if (b.halo) {
        ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(b.age * 5));
        const hr = b.r * 4;
        ctx.drawImage(b.halo, b.x - hr, b.y - hr, hr * 2, hr * 2);
      }
      ctx.globalAlpha = a;
      ctx.drawImage(b.sprite, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      this.bubbles[alive++] = b;
    }
    this.bubbles.length = alive;
  }

  private drawRings(dt: number): void {
    const { ctx, origin } = this;
    let alive = 0;
    for (const r of this.rings) {
      r.age += dt;
      const t = (r.age - r.delay) / RING_SEC;
      if (t >= 1) continue;
      this.rings[alive++] = r;
      if (t < 0) continue;
      const eased = 1 - (1 - t) ** 4;
      ctx.globalAlpha = r.alpha * (1 - t) ** 1.6;
      ctx.strokeStyle = css(r.color, 1);
      ctx.lineWidth = Math.max(1, r.width * (1 - t));
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 8 + r.maxR * eased, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings.length = alive;
  }

  private drawShards(dt: number): void {
    const { ctx } = this;
    const drag = Math.exp(-3.2 * dt);
    let alive = 0;
    ctx.lineCap = 'round';
    for (const s of this.shards) {
      s.age += dt;
      if (s.age >= SHARD_SEC) continue;
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = 1 - s.age / SHARD_SEC;
      ctx.globalAlpha = k;
      ctx.strokeStyle = css(s.color, 1);
      ctx.lineWidth = 2.2 * k + 0.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      // Streak along the velocity: motion blur for free.
      ctx.lineTo(s.x - s.vx * 0.05, s.y - s.vy * 0.05);
      ctx.stroke();
      this.shards[alive++] = s;
    }
    this.shards.length = alive;
  }

  private drawLabels(dt: number): void {
    const { ctx } = this;
    let alive = 0;
    ctx.textAlign = 'center';
    for (const l of this.labels) {
      l.age += dt;
      if (l.age >= LABEL_SEC) continue;
      const t = l.age / LABEL_SEC;
      ctx.globalAlpha = Math.min(1, l.age / 0.15) * (1 - t) ** 1.5;
      ctx.font = `700 ${l.size}px "Onest Variable", system-ui, sans-serif`;
      // White text, coloured glow: readable on any aura, still carries the side colour.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.shadowColor = css(l.color, 1);
      ctx.shadowBlur = 14;
      ctx.fillText(l.text, l.x, l.y - 28 * t);
      this.labels[alive++] = l;
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    this.labels.length = alive;
  }
}
