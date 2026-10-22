import type { TradeSide } from '../../feed/market-feed';

/** One particle to emit: possibly several trades merged when a frame overflows. */
export interface Spawn {
  side: TradeSide;
  usd: number;
  /** At least one merged trade was at or above the big-trade threshold. */
  big: boolean;
}

/**
 * Turns this frame's trades into at most `budget` particles. Under budget
 * every trade gets its own particle; over budget consecutive same-side trades
 * merge, preserving per-side notional and any big trade, so a cascade reads
 * as fewer, larger sparks instead of stalling the frame.
 */
export function planSpawns(
  trades: readonly { side: TradeSide; usd: number }[],
  budget: number,
  bigUsd: number,
): Spawn[] {
  if (trades.length <= budget) {
    return trades.map((t) => ({ side: t.side, usd: t.usd, big: t.usd >= bigUsd }));
  }
  // Each side's last group may be partial, so leave room for two of them.
  const group = Math.ceil(trades.length / Math.max(1, budget - 2));
  const open: Record<TradeSide, Spawn | null> = { buy: null, sell: null };
  const fill: Record<TradeSide, number> = { buy: 0, sell: 0 };
  const out: Spawn[] = [];
  for (const t of trades) {
    let s = open[t.side];
    if (!s) {
      s = { side: t.side, usd: 0, big: false };
      open[t.side] = s;
      out.push(s);
    }
    s.usd += t.usd;
    s.big ||= t.usd >= bigUsd;
    if (++fill[t.side] === group) {
      open[t.side] = null;
      fill[t.side] = 0;
    }
  }
  return out;
}
