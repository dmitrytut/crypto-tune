import { Emitter } from './emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade, Unsubscribe } from './types';

/** Deterministic 32-bit PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Regime {
  kind: 'calm' | 'impulse';
  until: number;
  /** Log-price drift per second. */
  drift: number;
  volMult: number;
  rateMult: number;
}

export interface SimulatorParams {
  seed: number;
  startPrice: number;
  /** Diffusion of log price per √second in calm regime (BTC ≈ 7e-5). */
  sigma: number;
  /** Mean trade arrivals per second in calm regime. */
  tradeRate: number;
  /** Median trade notional, quote units. */
  medianTradeUsd: number;
  calmMs: [number, number];
  impulseMs: [number, number];
  /** Total log move of an impulse, absolute, e.g. 0.003 = 0.3%. */
  impulseMove: [number, number];
}

export const DEFAULT_SIM_PARAMS: SimulatorParams = {
  seed: 42,
  startPrice: 60_000,
  sigma: 7e-5,
  tradeRate: 8,
  medianTradeUsd: 3_000,
  calmMs: [90_000, 300_000],
  impulseMs: [15_000, 90_000],
  impulseMove: [0.003, 0.015],
};

/**
 * Synthetic market: calm stretches of pure diffusion alternating with
 * directional impulses (higher vol, trade rate, size, and liquidations).
 * Pure stepper: output depends only on params and the target times passed.
 */
export class MarketSimulator {
  private readonly rand: () => number;
  private logPrice: number;
  private t: number;
  private nextTradeAt: number;
  private nextLiqAt: number;
  private regime: Regime;

  constructor(
    startTs: number,
    private readonly p: SimulatorParams = DEFAULT_SIM_PARAMS,
  ) {
    this.rand = mulberry32(p.seed);
    this.logPrice = Math.log(p.startPrice);
    this.t = startTs;
    this.regime = this.calm(startTs);
    this.nextTradeAt = startTs + this.expMs(this.tradeRate());
    this.nextLiqAt = startTs + this.expMs(this.liqRate());
  }

  advance(until: number, onTrade: (t: Trade) => void, onLiq: (l: Liquidation) => void): void {
    while (true) {
      const next = Math.min(this.nextTradeAt, this.nextLiqAt, this.regime.until);
      if (next > until) break;
      this.diffuseTo(next);
      if (next === this.regime.until) {
        this.regime = this.regime.kind === 'calm' ? this.impulse(next) : this.calm(next);
        // Rates changed: resample pending arrivals (memoryless, so this is exact).
        this.nextTradeAt = next + this.expMs(this.tradeRate());
        this.nextLiqAt = next + this.expMs(this.liqRate());
      } else if (next === this.nextTradeAt) {
        onTrade(this.makeTrade(next));
        this.nextTradeAt = next + this.expMs(this.tradeRate());
      } else {
        onLiq(this.makeLiquidation(next));
        this.nextLiqAt = next + this.expMs(this.liqRate());
      }
    }
  }

  private diffuseTo(ts: number): void {
    const dt = (ts - this.t) / 1000;
    if (dt <= 0) return;
    const { drift, volMult } = this.regime;
    this.logPrice += drift * dt + this.p.sigma * volMult * Math.sqrt(dt) * this.gauss();
    this.t = ts;
  }

  private makeTrade(ts: number): Trade {
    const price = Math.exp(this.logPrice);
    const sizeMult = this.regime.kind === 'impulse' ? 3 : 1;
    const usd = this.p.medianTradeUsd * sizeMult * Math.exp(1.2 * this.gauss());
    const buyBias = this.regime.kind === 'impulse' ? 0.3 * Math.sign(this.regime.drift) : 0;
    const side = this.rand() < 0.5 + buyBias ? 'buy' : 'sell';
    return { ts, price: Math.round(price * 100) / 100, qty: usd / price, side };
  }

  private makeLiquidation(ts: number): Liquidation {
    const price = Math.exp(this.logPrice);
    const usd = 30_000 * Math.exp(1.3 * this.gauss());
    // Falling price liquidates longs, rising price liquidates shorts.
    const down = this.regime.kind === 'impulse' ? this.regime.drift < 0 : this.rand() < 0.5;
    return {
      ts,
      price: Math.round(price * 100) / 100,
      qty: usd / price,
      usd,
      side: down ? 'long' : 'short',
    };
  }

  private calm(from: number): Regime {
    return {
      kind: 'calm',
      until: from + this.uniform(this.p.calmMs),
      drift: 0,
      volMult: 1,
      rateMult: 1,
    };
  }

  private impulse(from: number): Regime {
    const dur = this.uniform(this.p.impulseMs);
    const move = this.uniform(this.p.impulseMove) * (this.rand() < 0.5 ? -1 : 1);
    return {
      kind: 'impulse',
      until: from + dur,
      drift: move / (dur / 1000),
      volMult: 3,
      rateMult: 5,
    };
  }

  private tradeRate(): number {
    return this.p.tradeRate * this.regime.rateMult;
  }

  private liqRate(): number {
    return this.regime.kind === 'impulse' ? 0.7 : 0.01;
  }

  /** Exponential inter-arrival in ms for a per-second rate; at least 1 ms. */
  private expMs(ratePerSec: number): number {
    return Math.max(1, Math.round((-Math.log(1 - this.rand()) / ratePerSec) * 1000));
  }

  private uniform([lo, hi]: [number, number]): number {
    return lo + (hi - lo) * this.rand();
  }

  private gauss(): number {
    const u = 1 - this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }
}

export interface SimulatorFeedOptions {
  params?: SimulatorParams;
  /** Pre-generated history so metrics are warm immediately. */
  historyMs?: number;
}

const STEP_MS = 100;

/** Runs MarketSimulator against the wall clock; emits history synchronously on connect. */
export class SimulatorFeed implements MarketFeed {
  readonly label = 'Simulator';
  private readonly trades = new Emitter<Trade>();
  private readonly liquidations = new Emitter<Liquidation>();
  private readonly status = new Emitter<FeedStatus>();
  private sim: MarketSimulator | null = null;
  private timer: number | undefined;

  constructor(private readonly opts: SimulatorFeedOptions = {}) {}

  connect(): void {
    if (this.sim) return;
    const now = Date.now();
    this.sim = new MarketSimulator(now - (this.opts.historyMs ?? 30 * 60_000), this.opts.params);
    this.status.emit({ state: 'open' });
    this.pump();
    this.timer = window.setInterval(() => this.pump(), STEP_MS);
  }

  disconnect(): void {
    clearInterval(this.timer);
    this.sim = null;
    this.status.emit({ state: 'closed' });
  }

  now(): number {
    return Date.now();
  }

  onTrade(cb: (t: Trade) => void): Unsubscribe {
    return this.trades.on(cb);
  }

  onLiquidation(cb: (l: Liquidation) => void): Unsubscribe {
    return this.liquidations.on(cb);
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    return this.status.on(cb);
  }

  private pump(): void {
    this.sim?.advance(
      Date.now(),
      (t) => this.trades.emit(t),
      (l) => this.liquidations.emit(l),
    );
  }
}
