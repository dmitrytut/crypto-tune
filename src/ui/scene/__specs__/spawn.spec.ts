import { describe, expect, it } from 'vitest';
import type { TradeSide } from '../../../feed/market-feed';
import { bubbleStart, planSpawns } from '../spawn';

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

describe('bubbleStart', () => {
  const W = 1200;
  const H = 800;
  const rand = (() => {
    let s = 1;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();

  it('raises buys from the lower part of the screen and sinks sells from the top', () => {
    for (let i = 0; i < 200; i++) {
      const buy = bubbleStart('buy', 5_000, false, W, H, rand);
      const sell = bubbleStart('sell', 5_000, false, W, H, rand);
      expect(buy.y).toBeGreaterThan(H / 2);
      expect(buy.vy).toBeLessThan(0);
      expect(buy.ay).toBeLessThan(0);
      expect(sell.y).toBeLessThan(H / 2);
      expect(sell.vy).toBeGreaterThan(0);
      expect(sell.ay).toBeGreaterThan(0);
      for (const b of [buy, sell]) {
        expect(b.x).toBeGreaterThanOrEqual(b.r);
        expect(b.x).toBeLessThanOrEqual(W - b.r);
      }
    }
  });

  it('makes bigger prints visibly bigger', () => {
    const small = bubbleStart('buy', 1_000, false, W, H, () => 0.5);
    const large = bubbleStart('buy', 1_000_000, false, W, H, () => 0.5);
    const flagged = bubbleStart('buy', 1_000_000, true, W, H, () => 0.5);
    expect(large.r).toBeGreaterThan(small.r * 4);
    expect(flagged.r).toBeGreaterThan(large.r);
  });

  it('leans buys right and sells left on average, like the audio pan', () => {
    const mean = (side: 'buy' | 'sell') => {
      let sum = 0;
      for (let i = 0; i < 500; i++) sum += bubbleStart(side, 5_000, false, W, H, rand).x;
      return sum / 500;
    };
    expect(mean('buy')).toBeGreaterThan(W / 2);
    expect(mean('sell')).toBeLessThan(W / 2);
  });
});
