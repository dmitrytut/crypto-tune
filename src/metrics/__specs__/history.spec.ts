import { describe, expect, it } from 'vitest';
import type { Trade } from '../../feed/market-feed';
import { HISTORY_WINDOW_MS, MarketHistory, VOLUME_BUCKET_MS } from '../history';

const T0 = 1_700_000_000_000;
const trade = (ts: number, side: Trade['side'], usd: number): Trade => ({
  ts,
  price: 100,
  qty: usd / 100,
  side,
});

describe('MarketHistory', () => {
  it('keeps one price point per second, the last value in the second winning', () => {
    const h = new MarketHistory();
    h.addSnapshot({ ts: T0 + 0, price: 100, tension: 0.1 });
    h.addSnapshot({ ts: T0 + 750, price: 101, tension: 0.2 });
    h.addSnapshot({ ts: T0 + 1_000, price: 102, tension: 0.3 });
    expect(h.prices).toEqual([
      { ts: T0, price: 101, tension: 0.2 },
      { ts: T0 + 1_000, price: 102, tension: 0.3 },
    ]);
  });

  it('splits aggressor volume into buy and sell per 10 s bucket', () => {
    const h = new MarketHistory();
    h.addTrade(trade(T0 + 1_000, 'buy', 500));
    h.addTrade(trade(T0 + 9_000, 'sell', 200));
    h.addTrade(trade(T0 + VOLUME_BUCKET_MS, 'buy', 50));
    expect(h.volumes).toEqual([
      { ts: T0, buyUsd: 500, sellUsd: 200 },
      { ts: T0 + VOLUME_BUCKET_MS, buyUsd: 50, sellUsd: 0 },
    ]);
  });

  it('folds a late trade into the newest bucket instead of reordering', () => {
    const h = new MarketHistory();
    h.addTrade(trade(T0 + VOLUME_BUCKET_MS, 'buy', 10));
    h.addTrade(trade(T0 + 1, 'sell', 5));
    expect(h.volumes).toEqual([{ ts: T0 + VOLUME_BUCKET_MS, buyUsd: 10, sellUsd: 5 }]);
  });

  it('forgets prices, volume and markers older than the window', () => {
    const h = new MarketHistory();
    h.addSnapshot({ ts: T0, price: 1, tension: 0 });
    h.addTrade(trade(T0, 'buy', 1));
    h.addMarker({ ts: T0, kind: 'liquidation', side: 'long', usd: 1 });
    const later = T0 + HISTORY_WINDOW_MS + VOLUME_BUCKET_MS;
    h.addSnapshot({ ts: later, price: 2, tension: 0 });
    h.addTrade(trade(later, 'sell', 1));
    expect(h.prices.map((p) => p.price)).toEqual([2]);
    expect(h.volumes).toHaveLength(1);
    expect(h.markers).toHaveLength(0);
  });

  it('ignores snapshots without a price yet', () => {
    const h = new MarketHistory();
    h.addSnapshot({ ts: T0, price: Number.NaN, tension: 0 });
    expect(h.prices).toHaveLength(0);
  });

  it('finds the price nearest to a timestamp', () => {
    const h = new MarketHistory();
    expect(h.priceAt(T0)).toBeNaN();
    for (let i = 0; i < 5; i++) h.addSnapshot({ ts: T0 + i * 1_000, price: 100 + i, tension: 0 });
    expect(h.priceAt(T0 + 2_400)).toBe(102);
    expect(h.priceAt(T0 + 2_600)).toBe(103);
    expect(h.priceAt(T0 - 50_000)).toBe(100);
    expect(h.priceAt(T0 + 50_000)).toBe(104);
  });
});
