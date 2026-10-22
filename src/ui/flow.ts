import type { TradeSide } from '../feed/market-feed';

/** Order flow felt "right now": the window the eye reads as the current push. */
const FAST_TAU_MS = 4_000;
/** Baseline the current activity is compared against. */
const SLOW_TAU_MS = 120_000;

/**
 * Live order-flow reading; needs no warm-up, so visuals react from the first trade.
 * @package
 */
export interface FlowState {
  /** Aggressor balance over the last few seconds: +1 all buys, −1 all sells. */
  imbalance: number;
  /** Trading pace vs the last two minutes: 0 quieter than usual, ~⅓ usual, 1 four times busier. */
  activity: number;
}

/** @package */
export const QUIET_FLOW: FlowState = { imbalance: 0, activity: 0 };

/**
 * Exponentially decaying notional sums by side. A constant flow `r` decays to
 * r·τ·(1 − e^(−elapsed/τ)); dividing by that window gives `r` exactly, so the
 * first seconds of a session are not mistaken for a burst.
 * @package
 */
export class FlowMeter {
  private buy = 0;
  private sell = 0;
  private total = 0;
  private at = Number.NaN;
  private startedAt = Number.NaN;

  add(side: TradeSide, usd: number, ts: number): void {
    if (Number.isNaN(this.at)) this.at = this.startedAt = ts;
    this.decayTo(ts);
    if (side === 'buy') this.buy += usd;
    else this.sell += usd;
    this.total += usd;
  }

  read(now: number): FlowState {
    if (Number.isNaN(this.at)) return QUIET_FLOW;
    this.decayTo(now);
    const elapsed = Math.max(1, now - this.startedAt);
    const window = (tau: number) => tau * (1 - Math.exp(-elapsed / tau));
    const fast = (this.buy + this.sell) / window(FAST_TAU_MS);
    const slow = this.total / window(SLOW_TAU_MS);
    const ratio = slow > 0 ? fast / slow : 0;
    const octaves = ratio > 0 ? Math.min(2, Math.max(-1, Math.log2(ratio))) : -1;
    const sum = this.buy + this.sell;
    return {
      imbalance: sum > 0 ? (this.buy - this.sell) / sum : 0,
      activity: (octaves + 1) / 3,
    };
  }

  private decayTo(ts: number): void {
    const dt = ts - this.at;
    if (dt <= 0) return;
    const fast = Math.exp(-dt / FAST_TAU_MS);
    this.buy *= fast;
    this.sell *= fast;
    this.total *= Math.exp(-dt / SLOW_TAU_MS);
    this.at = ts;
  }
}
