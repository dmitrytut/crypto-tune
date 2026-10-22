import type { Trade } from '../feed/market-feed';
import { RollingStats } from './rolling';
import {
  DEFAULT_TENSION_PARAMS,
  INITIAL_TENSION,
  stepTension,
  type TensionParams,
  type TensionState,
} from './tension';

export const TICK_MS = 250;
const TICKS_PER_SEC = 1000 / TICK_MS;

export interface MetricsConfig {
  /** Return horizon N, seconds. */
  windowSec: number;
  /** Rolling window for ret/volume statistics, minutes. */
  statsWindowMin: number;
  /** Minimum statistics history before tension is released, minutes. */
  warmupMin: number;
  tension: TensionParams;
}

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  windowSec: 10,
  statsWindowMin: 30,
  warmupMin: 5,
  tension: DEFAULT_TENSION_PARAMS,
};

export interface MetricsSnapshot extends TensionState {
  /** Tick boundary, source-clock ms. */
  ts: number;
  price: number;
  ret: number;
  volPerSec: number;
  ready: boolean;
  /** Warm-up progress 0…1. */
  warmup: number;
}

/**
 * Buckets trades into fixed 250 ms ticks on the feed's clock and runs the
 * tension pipeline once per tick. Ticks are processed by source time, so
 * throttled timers or replay speed-ups never distort the statistics.
 */
export class MetricsEngine {
  private readonly lagTicks: number;
  private readonly warmupTicks: number;
  private readonly pending: Trade[] = [];
  private pendingHead = 0;
  /** Price per tick, ring of lagTicks + 1. */
  private readonly prices: Float64Array;
  /** Quote volume per tick over the trailing second. */
  private readonly vols = new Float64Array(TICKS_PER_SEC);
  private readonly retStats: RollingStats;
  private readonly volStats: RollingStats;
  /** Monotonic tick index; addresses the rings. */
  private tick = 0;
  /** Ticks processed since start or the last resync; gates `ret` until window N refills. */
  private sinceResync = 0;
  /** End of the last processed tick; NaN until the first trade. */
  private boundary = Number.NaN;
  private price = Number.NaN;
  private state: TensionState = INITIAL_TENSION;
  private params: TensionParams;

  constructor(cfg: MetricsConfig = DEFAULT_METRICS_CONFIG) {
    this.lagTicks = Math.max(1, Math.round(cfg.windowSec * TICKS_PER_SEC));
    this.warmupTicks = Math.round(cfg.warmupMin * 60 * TICKS_PER_SEC);
    const statsTicks = Math.round(cfg.statsWindowMin * 60 * TICKS_PER_SEC);
    this.prices = new Float64Array(this.lagTicks + 1);
    this.retStats = new RollingStats(statsTicks);
    this.volStats = new RollingStats(statsTicks);
    this.params = cfg.tension;
  }

  /** Change smoothing/sensitivity without losing history. */
  setTensionParams(params: TensionParams): void {
    this.params = params;
  }

  /**
   * Data gap (disconnect/reconnect): an absent feed is not a calm market.
   * Forgets tick-level state — price history, trailing volume, pending trades,
   * smoothed tension — but keeps the rolling statistics. Ticking resumes on
   * the next trade; tension stays 0 until window N has refilled with fresh data.
   */
  resync(): void {
    this.boundary = Number.NaN;
    this.price = Number.NaN;
    this.pending.length = 0;
    this.pendingHead = 0;
    this.vols.fill(0);
    this.sinceResync = 0;
    this.state = INITIAL_TENSION;
  }

  addTrade(t: Trade): void {
    if (Number.isNaN(this.boundary)) this.boundary = Math.floor(t.ts / TICK_MS) * TICK_MS;
    this.pending.push(t);
  }

  /** Process every whole tick ending at or before `now`. Returns the latest snapshot, if any. */
  advanceTo(now: number): MetricsSnapshot | null {
    let snap: MetricsSnapshot | null = null;
    while (this.boundary + TICK_MS <= now) {
      snap = this.step(this.boundary + TICK_MS);
    }
    this.compactPending();
    return snap;
  }

  private step(end: number): MetricsSnapshot {
    let vol = 0;
    // Late trades (ts before the previous boundary) land in the current tick.
    while (this.pendingHead < this.pending.length) {
      const t = this.pending[this.pendingHead] as Trade;
      if (t.ts >= end) break;
      vol += t.price * t.qty;
      this.price = t.price;
      this.pendingHead++;
    }
    this.boundary = end;
    const i = this.tick++;
    const fresh = this.sinceResync++;
    this.prices[i % this.prices.length] = this.price;
    this.vols[i % TICKS_PER_SEC] = vol;
    let volPerSec = 0;
    for (const v of this.vols) volPerSec += v;

    const hasRet = fresh >= this.lagTicks;
    const past = this.prices[(i - this.lagTicks) % this.prices.length] as number;
    const ret = hasRet ? Math.log(this.price / past) : 0;
    const warmup =
      (Math.min(fresh, this.lagTicks) + Math.min(this.retStats.count, this.warmupTicks)) /
      (this.lagTicks + this.warmupTicks);
    const ready = hasRet && this.retStats.count >= this.warmupTicks;

    this.state = stepTension(
      this.state,
      {
        ret,
        retStd: this.retStats.std,
        volPerSec,
        volMean: this.volStats.mean,
        volStd: this.volStats.std,
        ready,
      },
      this.params,
    );
    // Push after scoring so the current sample does not dampen its own z.
    if (hasRet) this.retStats.push(ret);
    this.volStats.push(volPerSec);

    return { ...this.state, ts: end, price: this.price, ret, volPerSec, ready, warmup };
  }

  private compactPending(): void {
    if (this.pendingHead > 4096 && this.pendingHead * 2 > this.pending.length) {
      this.pending.splice(0, this.pendingHead);
      this.pendingHead = 0;
    }
  }
}
