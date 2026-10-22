import { describe, expect, it } from 'vitest';
import type { Liquidation, LiquidationSide } from '../../feed/market-feed';
import { EventBuffer } from '../events';

const thresholds = { liquidationUsd: 20_000, tradeUsd: 200_000 };

const liq = (ts: number, side: LiquidationSide, usd: number): Liquidation => ({
  ts,
  side,
  price: 1,
  qty: usd,
  usd,
});

describe('EventBuffer', () => {
  it('cues nothing for an empty tick', () => {
    expect(new EventBuffer(thresholds).flush(0)).toEqual({ liquidation: null, trade: null });
  });

  it('merges a cascade into one cue for the side with the larger total notional', () => {
    const b = new EventBuffer(thresholds);
    b.addLiquidation(liq(10, 'long', 40_000));
    b.addLiquidation(liq(11, 'short', 70_000));
    b.addLiquidation(liq(12, 'long', 50_000));
    expect(b.flush(12).liquidation).toEqual({ side: 'long', usd: 90_000, size: 4.5, count: 2 });
  });

  it('keeps only events at or above their threshold', () => {
    const b = new EventBuffer(thresholds);
    b.addTrade({ ts: 1, price: 100, qty: 1_999, side: 'buy' });
    b.addTrade({ ts: 2, price: 100, qty: 2_000, side: 'sell' });
    b.addLiquidation(liq(3, 'long', 19_999));
    expect(b.flush(3)).toEqual({
      liquidation: null,
      trade: { side: 'sell', usd: 200_000, size: 1, count: 1 },
    });
  });

  it('drops stale events such as replayed history or a throttled-tab backlog', () => {
    const b = new EventBuffer(thresholds);
    b.addTrade({ ts: 100, price: 1, qty: 9e9, side: 'sell' });
    b.addTrade({ ts: 5_000, price: 1, qty: 300_000, side: 'buy' });
    expect(b.flush(6_000).trade).toEqual({ side: 'buy', usd: 300_000, size: 1.5, count: 1 });
  });

  it('starts every tick empty', () => {
    const b = new EventBuffer(thresholds);
    b.addLiquidation(liq(1, 'short', 50_000));
    b.flush(1);
    expect(b.flush(2).liquidation).toBeNull();
  });

  it('applies new thresholds to the following events', () => {
    const b = new EventBuffer(thresholds);
    b.setThresholds({ ...thresholds, liquidationUsd: 100_000 });
    b.addLiquidation(liq(1, 'short', 50_000));
    expect(b.flush(1).liquidation).toBeNull();
  });
});
