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

/** Decades above $1k, 0…3: the size scale for every event visual. */
export function sizeDecades(usd: number): number {
  return Math.min(3, Math.max(0, Math.log10(usd / 1_000)));
}

/** Initial state of a trade bubble, CSS px and px/s. */
export interface BubbleStart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Vertical acceleration: buoyancy for buys (negative), weight for sells. */
  ay: number;
  r: number;
  life: number;
}

/** Buys lean right and sells left, matching the stereo pan of their sounds. */
const SIDE_CENTER: Record<TradeSide, number> = { buy: 0.6, sell: 0.4 };

/**
 * Buys are bubbles rising out of the chart band; sells are drops sinking from
 * the top. Size, speed and lifetime grow with log notional, so a $1M print is
 * unmistakable next to $1k noise. `rand` is injected for determinism in specs.
 */
export function bubbleStart(
  side: TradeSide,
  usd: number,
  big: boolean,
  w: number,
  h: number,
  rand: () => number,
): BubbleStart {
  const d = sizeDecades(usd);
  const r = 4.5 + 6 * d + (big ? 8 : 0);
  const x = Math.min(w - r, Math.max(r, w * (SIDE_CENTER[side] + (rand() - 0.5) * 0.85)));
  const speed = (26 + 14 * d) * (0.8 + 0.4 * rand());
  const buy = side === 'buy';
  return {
    x,
    y: buy ? h * (0.62 + 0.3 * rand()) : h * (0.04 + 0.3 * rand()),
    vx: (rand() - 0.5) * 12,
    vy: buy ? -speed : speed,
    ay: buy ? -10 : 14,
    r,
    life: 4 + 1.5 * d + (big ? 2 : 0),
  };
}
