import type { Liquidation, LiquidationSide, Trade, TradeSide } from '../feed/market-feed';

/** Events older than this on the feed clock are dropped instead of cued late. */
const EVENT_MAX_AGE_MS = 2_000;

/** Quote notionals at or above which an event is cued, USD. */
export interface EventThresholds {
  liquidationUsd: number;
  tradeUsd: number;
}

/** A market event that passed its size threshold, waiting for the next tick. */
interface PendingEvent<S extends string> {
  ts: number;
  side: S;
  /** Quote notional. */
  usd: number;
}

/** What one tick cues for one kind of event: at most one voice, one readout. */
export interface EventCue<S extends string> {
  side: S;
  /** Total notional of the winning side within the tick. */
  usd: number;
  /** `usd` in multiples of the threshold that let it through, ≥ 1. */
  size: number;
  /** Events merged into this cue (a cascade counts once). */
  count: number;
}

/** What one tick's events collapsed to. */
export interface EventCues {
  liquidation: EventCue<LiquidationSide> | null;
  trade: EventCue<TradeSide> | null;
}

/**
 * Merges everything since the last tick into one cue so a cascade is one
 * strike, not a machine gun. The side with the larger total notional wins.
 * Events older than `minTs` are dropped: replayed history on connect or a
 * backlog after a throttled tab must not fire as a burst.
 */
function collapse<S extends string>(
  events: readonly PendingEvent<S>[],
  minTs: number,
  thresholdUsd: number,
): EventCue<S> | null {
  const totals = new Map<S, { usd: number; count: number }>();
  for (const e of events) {
    if (e.ts < minTs) continue;
    const t = totals.get(e.side) ?? { usd: 0, count: 0 };
    t.usd += e.usd;
    t.count++;
    totals.set(e.side, t);
  }
  let best: EventCue<S> | null = null;
  for (const [side, t] of totals) {
    if (!best || t.usd > best.usd) {
      best = { side, usd: t.usd, size: t.usd / thresholdUsd, count: t.count };
    }
  }
  return best;
}

/**
 * Keeps trades and liquidations above their thresholds between ticks and
 * collapses them once per tick into cues for audio, readout and chart.
 */
export class EventBuffer {
  private liquidations: PendingEvent<LiquidationSide>[] = [];
  private trades: PendingEvent<TradeSide>[] = [];

  constructor(private thresholds: EventThresholds) {}

  setThresholds(next: EventThresholds): void {
    this.thresholds = next;
  }

  addTrade(t: Trade): void {
    const usd = t.price * t.qty;
    if (usd >= this.thresholds.tradeUsd) this.trades.push({ ts: t.ts, side: t.side, usd });
  }

  addLiquidation(l: Liquidation): void {
    if (l.usd >= this.thresholds.liquidationUsd) {
      this.liquidations.push({ ts: l.ts, side: l.side, usd: l.usd });
    }
  }

  /** Once per tick, with or without new events; `now` is the feed clock. */
  flush(now: number): EventCues {
    const minTs = now - EVENT_MAX_AGE_MS;
    const cues: EventCues = {
      liquidation: collapse(this.liquidations, minTs, this.thresholds.liquidationUsd),
      trade: collapse(this.trades, minTs, this.thresholds.tradeUsd),
    };
    this.liquidations = [];
    this.trades = [];
    return cues;
  }
}
