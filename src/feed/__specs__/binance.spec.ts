import { describe, expect, it } from 'vitest';
import { binanceStreamUrl, parseAggTrade, parseForceOrder } from '../binance';

describe('parseAggTrade', () => {
  // Captured from wss://fstream.binance.com/market/stream (2026-10).
  const msg = {
    e: 'aggTrade',
    E: 1792697689309,
    T: 1792697689158,
    p: '81460.10',
    q: '0.002',
  } as const;

  it('maps buyer-is-maker to an aggressive sell', () => {
    expect(parseAggTrade({ ...msg, m: true })).toEqual({
      ts: 1792697689158,
      price: 81460.1,
      qty: 0.002,
      side: 'sell',
    });
    expect(parseAggTrade({ ...msg, m: false }).side).toBe('buy');
  });
});

describe('parseForceOrder', () => {
  const order = (S: 'BUY' | 'SELL') => ({
    e: 'forceOrder' as const,
    E: 1792697691089,
    o: { S, ap: '0.5606000', z: '532', T: 1792697690086 },
  });

  it('treats a forced SELL as a long liquidation and BUY as short', () => {
    expect(parseForceOrder(order('SELL')).side).toBe('long');
    expect(parseForceOrder(order('BUY')).side).toBe('short');
  });

  it('uses average fill price and filled quantity for notional', () => {
    const l = parseForceOrder(order('SELL'));
    expect(l.ts).toBe(1792697690086);
    expect(l.price).toBe(0.5606);
    expect(l.qty).toBe(532);
    expect(l.usd).toBeCloseTo(298.2392, 9);
  });
});

describe('binanceStreamUrl', () => {
  it('lowercases the symbol on the routed /market endpoint', () => {
    expect(binanceStreamUrl('ETHUSDT')).toBe(
      'wss://fstream.binance.com/market/stream?streams=ethusdt@aggTrade/ethusdt@forceOrder/ethusdt@markPrice@1s',
    );
  });
});
