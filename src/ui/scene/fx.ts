import type { LiquidationSide, TradeSide } from '../../feed/market-feed';
import { css, DOWN_COLOR, type Rgb, UP_COLOR } from '../palette';
import { planSpawns } from './spawn';

/** Live particles cap; above it the oldest are recycled. */
const MAX_PARTICLES = 2_000;
/** Particles created per frame; a burst beyond this merges into larger sparks. */
const SPAWN_BUDGET = 120;
const MAX_DPR = 2;
/** Base heading per side (radians, canvas y down): buys up-right, sells down-left — like the audio pan. */
const HEADING: Record<TradeSide, number> = { buy: -Math.PI / 4, sell: (3 * Math.PI) / 4 };
const HEADING_SPREAD = 0.75;
const DRAG_PER_SEC = 0.9;
const WAVE_SEC = 2.4;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r: number;
  color: Rgb;
  big: boolean;
}

interface Wave {
  age: number;
  maxR: number;
  strength: number;
  color: Rgb;
}

/** Decades above $1k, 0…3: the size scale for both sparks and waves. */
const decades = (usd: number) => Math.min(3, Math.max(0, Math.log10(usd / 1_000)));

/**
 * Overlay canvas for market events. Every trade becomes a spark flying from
 * the price (buys up-right teal, sells down-left magenta, size by log
 * notional, big trades glow). Every liquidation sends a ring outward (long
 * magenta, short teal, radius and opacity by log notional).
 */
export class Fx {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private waves: Wave[] = [];
  private queued: { side: TradeSide; usd: number }[] = [];
  private origin = { x: 0, y: 0 };
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  /** Where sparks and waves start, CSS pixels (centre of the price). */
  setOrigin(x: number, y: number): void {
    this.origin = { x, y };
  }

  trade(side: TradeSide, usd: number): void {
    this.queued.push({ side, usd });
  }

  liquidation(side: LiquidationSide, usd: number, thresholdUsd: number): void {
    const above = Math.max(0, Math.log10(usd / thresholdUsd));
    const short = Math.min(this.canvas.clientWidth, this.canvas.clientHeight);
    this.waves.push({
      age: 0,
      maxR: short * (0.18 + 0.12 * decades(usd)),
      // Below-threshold liquidations still ripple, faintly.
      strength: Math.min(1, 0.25 + 0.4 * above),
      color: side === 'long' ? DOWN_COLOR : UP_COLOR,
    });
  }

  /** Drop anything queued, e.g. while the tab was hidden. */
  clear(): void {
    this.queued = [];
    this.particles = [];
    this.waves = [];
  }

  frame(dtSec: number, bigTradeUsd: number): void {
    const dt = Math.min(dtSec, 0.1);
    this.resize();
    this.spawn(bigTradeUsd);
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.globalCompositeOperation = 'lighter';
    this.drawWaves(dt);
    this.drawParticles(dt);
    ctx.globalCompositeOperation = 'source-over';
  }

  private spawn(bigTradeUsd: number): void {
    if (this.queued.length === 0) return;
    for (const s of planSpawns(this.queued, SPAWN_BUDGET, bigTradeUsd)) {
      const d = decades(s.usd);
      const angle = HEADING[s.side] + (Math.random() - 0.5) * 2 * HEADING_SPREAD;
      const speed = (50 + 45 * d) * (0.6 + 0.8 * Math.random());
      this.particles.push({
        x: this.origin.x + (Math.random() - 0.5) * 40,
        y: this.origin.y + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: s.big ? 2.8 : 1.6 + 0.5 * d,
        r: 1.4 + 1.8 * d,
        color: s.side === 'buy' ? UP_COLOR : DOWN_COLOR,
        big: s.big,
      });
    }
    this.queued = [];
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  private drawParticles(dt: number): void {
    const { ctx } = this;
    const drag = Math.exp(-DRAG_PER_SEC * dt);
    let alive = 0;
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = 1 - p.age / p.life;
      if (p.big) {
        ctx.fillStyle = css(p.color, 0.18 * fade);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = css(p.color, 0.85 * fade);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      this.particles[alive++] = p;
    }
    this.particles.length = alive;
  }

  private drawWaves(dt: number): void {
    const { ctx, origin } = this;
    let alive = 0;
    for (const w of this.waves) {
      w.age += dt;
      const k = w.age / WAVE_SEC;
      if (k >= 1) continue;
      const eased = 1 - (1 - k) ** 3;
      const r = w.maxR * eased;
      ctx.strokeStyle = css(w.color, w.strength * (1 - k) ** 2);
      ctx.lineWidth = 1 + 5 * (1 - k) * w.strength;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.stroke();
      this.waves[alive++] = w;
    }
    this.waves.length = alive;
  }

  private resize(): void {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }
}
