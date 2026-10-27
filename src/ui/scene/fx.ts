import type { LiquidationSide, TradeSide } from '../../feed/market-feed';
import { usdFmt } from '../format';
import { css, DOWN_COLOR, type Rgb, sideColor, UP_COLOR } from '../palette';
import { fitCanvas } from './canvas';
import { popDroplets, popHeight } from './pop';
import { floorSparks, sparkColor } from './sparks';
import { bubbleStart, planSpawns, sizeDecades } from './spawn';
import { bubbleSprite, dropSprite, haloSprite } from './sprites';

/** Live bubbles cap; above it the oldest are recycled. */
const MAX_BUBBLES = 1_500;
/** Bubbles created per frame; a burst beyond this merges into larger ones. */
const SPAWN_BUDGET = 120;
const FADE_IN_SEC = 0.35;
const RING_SEC = 1.8;
const SHARD_SEC = 1.1;
const TRADE_LABEL_SEC = 2.4;
/** Liquidation labels stay at full opacity for the hold, then fade out over the rest. */
const LIQ_LABEL_SEC = 5;
const LIQ_LABEL_HOLD_SEC = 1.5;
/** Bubble pop: the torn film snaps outward over FILM_SNAP_SEC, the ring spreads over POP_SEC. */
const FILM_SNAP_SEC = 0.12;
const POP_SEC = 0.45;
/** Pops per frame that throw droplets; past it a cascade pops with the ring only. */
const MAX_SPRAYS_PER_FRAME = 30;
/** Droplets fall back, px/s², and slow in the air, 1/s. */
const DROPLET_GRAVITY = 260;
const DROPLET_DRAG = 2.4;
/** Aura flash where a big-trade bubble pops. */
const BIG_POP_BLOOM = 0.3;
/** Drop hitting the floor: sparks fall px/s² and slow sideways 1/s, on through the chart to the
 * screen bottom; the impact flash lasts IMPACT_SEC. */
const SPARK_GRAVITY = 520;
const SPARK_DRAG = 1.2;
const IMPACT_SEC = 0.15;
/** Drops per frame that throw sparks; past it a cascade lands with the flash only. */
const MAX_SPLASHES_PER_FRAME = 30;
/** Precomputed spark colours along the cooling, so a frame builds no colour strings. */
const SPARK_COLOR_STEPS = 16;

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
  phase: number;
  /** Height a buy bubble pops at, CSS px from the top; null for drops, which fall to the floor. */
  popY: number | null;
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

interface Pop {
  x: number;
  y: number;
  r: number;
  age: number;
  sprite: HTMLCanvasElement;
}

interface Spray {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifeSec: number;
  sizePx: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifeSec: number;
}

interface Impact {
  x: number;
  y: number;
  r: number;
  age: number;
}

interface Label {
  x: number;
  y: number;
  age: number;
  text: string;
  color: Rgb;
  size: number;
  /** Total lifetime, s. */
  life: number;
  /** Time at full opacity before the fade starts, s. */
  hold: number;
}

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
  private pops: Pop[] = [];
  private sprays: Spray[] = [];
  /** Droplets glow like tiny teal embers. */
  private readonly droplet = dropSprite(UP_COLOR);
  private sparks: Spark[] = [];
  private impacts: Impact[] = [];
  private readonly sparkCss = Array.from({ length: SPARK_COLOR_STEPS }, (_, i) =>
    css(sparkColor(i / (SPARK_COLOR_STEPS - 1))),
  );
  private floor: number | null = null;
  private labels: Label[] = [];
  private queued: { side: TradeSide; usd: number }[] = [];
  private origin = { x: 0, y: 0 };
  /** The page font stack (--font-sans), inherited by the canvas: one source for CSS and labels. */
  private readonly fontFamily: string;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: FxHooks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.fontFamily = getComputedStyle(canvas).fontFamily;
    this.sprites = { buy: bubbleSprite(UP_COLOR), sell: dropSprite(DOWN_COLOR) };
    this.halos = { buy: haloSprite(UP_COLOR), sell: haloSprite(DOWN_COLOR) };
  }

  /** Where liquidations burst, CSS pixels (centre of the price). */
  setOrigin(x: number, y: number): void {
    this.origin = { x, y };
  }

  /** Top of the chart strip, CSS px: drops break into sparks there. Null: the screen bottom. */
  setFloor(y: number | null): void {
    this.floor = y;
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
      life: LIQ_LABEL_SEC,
      hold: LIQ_LABEL_HOLD_SEC,
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
    this.pops = [];
    this.sprays = [];
    this.sparks = [];
    this.impacts = [];
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
    this.drawPops(dt);
    this.drawSprays(dt);
    this.drawSparks(dt, h);
    this.drawImpacts(dt);
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
        popY: s.side === 'buy' ? popHeight(h, Math.random) : null,
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
          life: TRADE_LABEL_SEC,
          hold: 0,
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
    const floor = this.floor ?? h;
    let sprays = 0;
    let splashes = 0;
    let alive = 0;
    for (const b of this.bubbles) {
      b.age += dt;
      if (b.y < -b.r * 4 || b.y > h + b.r * 4) continue;
      // A bubble rises until its pop height; a drop falls until the floor.
      if (b.popY === null ? b.y >= floor : b.y <= b.popY) {
        if (b.popY === null) this.splash(b, floor, splashes++ < MAX_SPLASHES_PER_FRAME);
        else this.pop(b, sprays++ < MAX_SPRAYS_PER_FRAME);
        continue;
      }
      b.vy += b.ay * dt;
      // Gentle sideways sway; bigger bubbles sway slower and wider, like real ones.
      b.x += (b.vx + Math.sin(b.age * (2.6 - b.r * 0.05) + b.phase) * (8 + b.r)) * dt;
      b.y += b.vy * dt;
      const a = Math.min(1, b.age / FADE_IN_SEC);
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

  /** A drop hits the floor like hot metal: a flash and, within budget, sparks that skitter. */
  private splash(b: Bubble, floor: number, sparks: boolean): void {
    this.impacts.push({ x: b.x, y: floor, r: b.r, age: 0 });
    if (!sparks) return;
    for (const s of floorSparks(b.r, Math.random)) {
      this.sparks.push({ x: b.x, y: floor - 1, age: 0, ...s });
    }
  }

  /** A bubble bursts: its film snaps away, a ring spreads and, within budget, droplets fly. */
  private pop(b: Bubble, spray: boolean): void {
    this.pops.push({ x: b.x, y: b.y, r: b.r, age: 0, sprite: b.sprite });
    if (spray) {
      for (const d of popDroplets(b.r, Math.random)) {
        // Droplets fly off the film, so they start on the rim, heading outward.
        const k = b.r / Math.hypot(d.vx, d.vy);
        this.sprays.push({ x: b.x + d.vx * k, y: b.y + d.vy * k, age: 0, ...d });
      }
    }
    if (b.halo) this.hooks.bloom(b.x, b.y, UP_COLOR, BIG_POP_BLOOM);
  }

  private drawPops(dt: number): void {
    const { ctx } = this;
    let alive = 0;
    ctx.strokeStyle = css(UP_COLOR, 1);
    for (const p of this.pops) {
      p.age += dt;
      const t = p.age / POP_SEC;
      if (t >= 1) continue;
      // The torn film snaps outward and is gone.
      const snap = p.age / FILM_SNAP_SEC;
      if (snap < 1) {
        const s = p.r * (1 + 0.35 * snap);
        ctx.globalAlpha = 1 - snap;
        ctx.drawImage(p.sprite, p.x - s, p.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 0.75 * (1 - t) ** 1.5;
      ctx.lineWidth = Math.max(0.5, 1.6 * (1 - t));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + 1.4 * (1 - (1 - t) ** 3)), 0, Math.PI * 2);
      ctx.stroke();
      this.pops[alive++] = p;
    }
    this.pops.length = alive;
  }

  private drawSprays(dt: number): void {
    const { ctx } = this;
    const drag = Math.exp(-DROPLET_DRAG * dt);
    let alive = 0;
    for (const s of this.sprays) {
      s.age += dt;
      if (s.age >= s.lifeSec) continue;
      s.vx *= drag;
      s.vy = s.vy * drag + DROPLET_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = 1 - s.age / s.lifeSec;
      // The ember sprite's bright core is about a third of its size.
      const r = s.sizePx * 3 * (0.5 + 0.5 * k);
      ctx.globalAlpha = k;
      ctx.drawImage(this.droplet, s.x - r, s.y - r, r * 2, r * 2);
      this.sprays[alive++] = s;
    }
    this.sprays.length = alive;
  }

  private drawSparks(dt: number, h: number): void {
    const { ctx } = this;
    const drag = Math.exp(-SPARK_DRAG * dt);
    let alive = 0;
    ctx.lineCap = 'round';
    for (const s of this.sparks) {
      s.age += dt;
      if (s.age >= s.lifeSec || s.y > h) continue;
      s.vx *= drag;
      s.vy += SPARK_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const t = s.age / s.lifeSec;
      ctx.globalAlpha = 1 - 0.6 * t;
      ctx.strokeStyle = this.sparkCss[Math.floor(t * SPARK_COLOR_STEPS)] as string;
      ctx.lineWidth = 1.8 * (1 - t) + 0.6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      // Streak along the velocity: motion blur for free.
      ctx.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035);
      ctx.stroke();
      this.sparks[alive++] = s;
    }
    this.sparks.length = alive;
  }

  private drawImpacts(dt: number): void {
    const { ctx } = this;
    let alive = 0;
    for (const f of this.impacts) {
      f.age += dt;
      const t = f.age / IMPACT_SEC;
      if (t >= 1) continue;
      const r = f.r * (1.6 + t);
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(this.sprites.sell, f.x - r, f.y - r, r * 2, r * 2);
      this.impacts[alive++] = f;
    }
    this.impacts.length = alive;
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
      if (l.age >= l.life) continue;
      const t = l.age / l.life;
      const fade = l.age < l.hold ? 1 : 1 - (l.age - l.hold) / (l.life - l.hold);
      ctx.globalAlpha = Math.min(1, l.age / 0.15) * fade ** 1.5;
      ctx.font = `700 ${l.size}px ${this.fontFamily}`;
      // Side-coloured text over a neutral dark scrim: readable on any aura, no glow.
      ctx.fillStyle = css(l.color, 1);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8;
      ctx.fillText(l.text, l.x, l.y - 28 * t);
      this.labels[alive++] = l;
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    this.labels.length = alive;
  }
}
