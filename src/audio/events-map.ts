import type { LiquidationSide, TradeSide } from '../feed/market-feed';

/** A market event that passed its size threshold, waiting for the next tick. */
export interface PendingEvent<S extends string> {
  ts: number;
  side: S;
  /** Quote notional. */
  usd: number;
}

/** What one tick plays for one kind of event: at most one voice. */
export interface EventCue<S extends string> {
  side: S;
  /** Total notional of the winning side within the tick. */
  usd: number;
  /** Events merged into this cue (a cascade counts once). */
  count: number;
}

/**
 * Merges everything since the last tick into one cue so a cascade is one
 * strike, not a machine gun. The side with the larger total notional wins.
 * Events older than `minTs` are dropped: replayed history on connect or a
 * backlog after a throttled tab must not fire as a burst.
 */
export function collapse<S extends string>(
  events: readonly PendingEvent<S>[],
  minTs: number,
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
    if (!best || t.usd > best.usd) best = { side, usd: t.usd, count: t.count };
  }
  return best;
}

/** Notional range above the threshold that spans quiet → full velocity: 100×. */
const VELOCITY_DECADES = 2;
const MIN_VELOCITY = 0.35;

/**
 * Loudness from size on a log scale: MIN_VELOCITY at the threshold, 1 at
 * 100× the threshold and above. Log because notionals span orders of magnitude.
 */
export function eventVelocity(usd: number, thresholdUsd: number): number {
  const decades = Math.log10(usd / thresholdUsd) / VELOCITY_DECADES;
  return MIN_VELOCITY + (1 - MIN_VELOCITY) * Math.min(1, Math.max(0, decades));
}

/** Where a voice sits: scale degree from the tonic in `octave`, and stereo position. */
export interface VoicePlacement {
  octave: number;
  degree: number;
  /** −1 left … 1 right. */
  pan: number;
}

/**
 * Long liquidations (forced sells, price falling) strike a low tonic gong;
 * short liquidations (forced buys, price rising) a bell on the fifth an octave up.
 */
export const LIQUIDATION_VOICES: Record<LiquidationSide, VoicePlacement> = {
  long: { octave: 2, degree: 0, pan: 0 },
  short: { octave: 3, degree: 3, pan: 0 },
};

/** Aggressive buys pluck above the arpeggio on the right, sells below it on the left. */
export const TRADE_VOICES: Record<TradeSide, VoicePlacement> = {
  buy: { octave: 4, degree: 2, pan: 0.35 },
  sell: { octave: 4, degree: -2, pan: -0.35 },
};
