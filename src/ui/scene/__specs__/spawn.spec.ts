import { describe, expect, it } from 'vitest';
import type { TradeSide } from '../../../feed/market-feed';
import { planSpawns } from '../spawn';

const total = (xs: readonly { side: TradeSide; usd: number }[], side: TradeSide) =>
  xs.filter((x) => x.side === side).reduce((a, x) => a + x.usd, 0);

describe('planSpawns', () => {
  it('gives every trade its own particle under budget, flagging big ones', () => {
    const trades = [
      { side: 'buy' as const, usd: 1_000 },
      { side: 'sell' as const, usd: 300_000 },
    ];
    expect(planSpawns(trades, 10, 200_000)).toEqual([
      { side: 'buy', usd: 1_000, big: false },
      { side: 'sell', usd: 300_000, big: true },
    ]);
  });

  it('merges a burst over budget, keeping per-side notional and big trades', () => {
    const trades = Array.from({ length: 1_000 }, (_, i) => ({
      side: (i % 3 === 0 ? 'sell' : 'buy') as TradeSide,
      usd: i === 500 ? 1_000_000 : 1_000,
    }));
    for (const budget of [2, 7, 50, 120]) {
      const spawns = planSpawns(trades, budget, 200_000);
      expect(spawns.length).toBeLessThanOrEqual(budget);
      expect(total(spawns, 'buy')).toBe(total(trades, 'buy'));
      expect(total(spawns, 'sell')).toBe(total(trades, 'sell'));
      expect(spawns.filter((s) => s.big)).toHaveLength(1);
    }
  });
});
