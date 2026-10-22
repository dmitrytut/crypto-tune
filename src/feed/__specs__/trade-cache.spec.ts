import { describe, expect, it } from 'vitest';
import { type CachedTrade, decodeTrades, encodeTrades } from '../trade-cache';

describe('trade columns', () => {
  it('round-trips trades with their ids and aggressor side', () => {
    const trades: CachedTrade[] = [
      { id: 3_493_873_489, ts: 1_792_700_000_123, price: 81_305.9, qty: 0.066, side: 'sell' },
      { id: 3_493_873_490, ts: 1_792_700_000_456, price: 81_306.1, qty: 1.25, side: 'buy' },
    ];
    expect(decodeTrades(encodeTrades(trades))).toEqual(trades);
  });
});
