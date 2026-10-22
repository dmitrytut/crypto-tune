import { describe, expect, it } from 'vitest';
import type { Trade } from '../market-feed';
import { decodeTrades, encodeTrades } from '../trade-cache';

describe('trade columns', () => {
  it('round-trips trades, including the aggressor side', () => {
    const trades: Trade[] = [
      { ts: 1_792_700_000_123, price: 81_305.9, qty: 0.066, side: 'sell' },
      { ts: 1_792_700_000_456, price: 81_306.1, qty: 1.25, side: 'buy' },
    ];
    expect(decodeTrades(encodeTrades(trades))).toEqual(trades);
  });
});
