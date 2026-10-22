import { Emitter } from './emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade, Unsubscribe } from './market-feed';

/** Deterministic 32-bit PRNG in [0, 1); also seeds other modules' specs. */
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

/** Per-regime multipliers over the calm baseline; calm is all ones. */
interface Regime {
  kind: 'calm' | 'impulse';
  until: number;
  /** Log-price drift per second. */
  drift: number;
  volMult: number;
  rateMult: number;
  sizeMult: number;
  /** Added to the 0.5 buy probability; signed toward the move. */
  buyBias: number;
  /** Liquidations per second. */
  liqRate: number;
}

export interface SimulatorParams {
  seed: number;
  startPrice: number;
  /** Price increment trade prints are rounded to. */
  priceTick: number;
  /** Diffusion of log price per √second in calm regime (BTC ≈ 7e-5). */
  sigma: number;
  /** Mean trade arrivals per second in calm regime. */
  tradeRate: number;
  /** Median trade notional, quote units. */
  medianTradeUsd: number;
  /** Lognormal σ of trade notional; ~1.2 yields an occasional block trade. */
  tradeSizeSigma: number;
  /** Mean liquidations per second in each regime. */
  liqRateCalm: number;
  liqRateImpulse: number;
  /** Median liquidation notional, quote units. */
  medianLiqUsd: number;
  /** Lognormal σ of liquidation notional. */
  liqSizeSigma: number;
  calmMs: [number, number];
  impulseMs: [number, number];
  /** Total log move of an impulse, absolute, e.g. 0.003 = 0.3%. */
  impulseMove: [number, number];
  /** Impulse multipliers over calm: diffusion, trade arrival rate, trade size. */
  impulseVolMult: number;
  impulseRateMult: number;
  impulseSizeMult: number;
  /** Shift of buy probability toward the impulse direction, 0…0.5. */
  impulseBuyBias: number;
}

/** @package */
export const DEFAULT_SIM_PARAMS: SimulatorParams = {
  seed: 42,
  startPrice: 60_000,
  priceTick: 0.01,
  sigma: 7e-5,
  tradeRate: 8,
  medianTradeUsd: 3_000,
  tradeSizeSigma: 1.2,
  liqRateCalm: 0.01,
  liqRateImpulse: 0.7,
  medianLiqUsd: 30_000,
  liqSizeSigma: 1.3,
  calmMs: [90_000, 300_000],
  impulseMs: [15_000, 90_000],
  impulseMove: [0.003, 0.015],
  impulseVolMult: 3,
  impulseRateMult: 5,
  impulseSizeMult: 3,
  impulseBuyBias: 0.3,
};

/**
 * Synthetic market: calm stretches of pure diffusion alternating with
 * directional impulses (higher vol, trade rate, size, and liquidations).
 * Pure stepper: output depends only on params and the target times passed.
 * @package
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
    this.nextLiqAt = startTs + this.expMs(this.regime.liqRate);
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
        this.nextLiqAt = next + this.expMs(this.regime.liqRate);
      } else if (next === this.nextTradeAt) {
        onTrade(this.makeTrade(next));
        this.nextTradeAt = next + this.expMs(this.tradeRate());
      } else {
        onLiq(this.makeLiquidation(next));
        this.nextLiqAt = next + this.expMs(this.regime.liqRate);
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
    const { sizeMult, buyBias } = this.regime;
    const usd = this.p.medianTradeUsd * sizeMult * Math.exp(this.p.tradeSizeSigma * this.gauss());
    const side = this.rand() < 0.5 + buyBias ? 'buy' : 'sell';
    return { ts, price: this.roundToTick(price), qty: usd / price, side };
  }

  private makeLiquidation(ts: number): Liquidation {
    const price = Math.exp(this.logPrice);
    const usd = this.p.medianLiqUsd * Math.exp(this.p.liqSizeSigma * this.gauss());
    // Falling price liquidates longs, rising price liquidates shorts.
    const down = this.regime.kind === 'impulse' ? this.regime.drift < 0 : this.rand() < 0.5;
    return {
      ts,
      price: this.roundToTick(price),
      qty: usd / price,
      usd,
      side: down ? 'long' : 'short',
    };
  }

  private roundToTick(price: number): number {
    // Multiply/divide by the integer ticks-per-unit: exact for decimal ticks, no 0.1 + 0.2 residue.
    const perUnit = Math.round(1 / this.p.priceTick);
    return Math.round(price * perUnit) / perUnit;
  }

  private calm(from: number): Regime {
    return {
      kind: 'calm',
      until: from + this.uniform(this.p.calmMs),
      drift: 0,
      volMult: 1,
      rateMult: 1,
      sizeMult: 1,
      buyBias: 0,
      liqRate: this.p.liqRateCalm,
    };
  }

  private impulse(from: number): Regime {
    const dur = this.uniform(this.p.impulseMs);
    const magnitude = this.uniform(this.p.impulseMove);
    const dir = this.rand() < 0.5 ? -1 : 1;
    const move = magnitude * dir;
    return {
      kind: 'impulse',
      until: from + dur,
      drift: move / (dur / 1000),
      volMult: this.p.impulseVolMult,
      rateMult: this.p.impulseRateMult,
      sizeMult: this.p.impulseSizeMult,
      buyBias: this.p.impulseBuyBias * dir,
      liqRate: this.p.liqRateImpulse,
    };
  }

  private tradeRate(): number {
    return this.p.tradeRate * this.regime.rateMult;
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
  /** Pre-generated history so metrics are warm immediately: the metrics stats window. */
  historyMs: number;
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
  /** Wall time up to which all events have been emitted; the feed clock. */
  private emittedUntil = 0;

  constructor(private readonly opts: SimulatorFeedOptions) {}

  connect(): void {
    if (this.sim) return;
    const now = Date.now();
    this.sim = new MarketSimulator(now - this.opts.historyMs, this.opts.params);
    this.status.emit({ state: 'open' });
    this.pump();
    this.timer = setInterval(() => this.pump(), STEP_MS);
  }

  disconnect(): void {
    clearInterval(this.timer);
    this.sim = null;
    this.status.emit({ state: 'closed' });
  }

  now(): number {
    // Not Date.now(): the metrics timer may fire before the next pump and would
    // close ticks whose trades have not been generated yet.
    return this.emittedUntil;
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
    if (!this.sim) return;
    const until = Date.now();
    this.sim.advance(
      until,
      (t) => this.trades.emit(t),
      (l) => this.liquidations.emit(l),
    );
    this.emittedUntil = until;
  }
}
