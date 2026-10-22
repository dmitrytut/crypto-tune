import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  binanceStreamUrl,
  fetchBinanceTradesSince,
  parseAggTrade,
  parseForceOrder,
} from '../binance';

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

describe('fetchBinanceTradesSince', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Fake REST: `total` consecutive trades from id 1, served in pages of up to 1000. */
  function stubRest(total: number) {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const q = new URL(url).searchParams;
      const from = q.has('fromId') ? Number(q.get('fromId')) : 1;
      const rows: { a: number; p: string; q: string; T: number; m: boolean }[] = [];
      for (let a = from; a <= Math.min(total, from + 999); a++) {
        rows.push({ a, p: '100.5', q: '2', T: 1_000 + a, m: a % 2 === 0 });
      }
      return { ok: true, json: async () => rows } as Response;
    });
    return urls;
  }

  it('locates the first page by time, then follows ids until the newest trade', async () => {
    const urls = stubRest(2_500);
    const trades = await fetchBinanceTradesSince('btcusdt', 1_234.9);
    expect(trades).toHaveLength(2_500);
    expect(trades[0]).toEqual({ ts: 1_001, price: 100.5, qty: 2, side: 'buy' });
    expect(trades.at(-1)?.ts).toBe(3_500);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('symbol=BTCUSDT');
    expect(urls[0]).toContain('startTime=1234');
    expect(urls[0]).not.toContain('fromId');
    expect(urls[1]).toContain('fromId=1001');
    expect(urls[2]).toContain('fromId=2001');
    expect(urls[1]).not.toContain('startTime');
  });

  it('stops at the page cap during a very busy market', async () => {
    const urls = stubRest(1_000_000);
    const trades = await fetchBinanceTradesSince('BTCUSDT', 0);
    expect(urls).toHaveLength(30);
    expect(trades).toHaveLength(30_000);
  });

  it('fails loudly on an HTTP error so the caller can fall back to live only', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429 }) as Response);
    await expect(fetchBinanceTradesSince('BTCUSDT', 0)).rejects.toThrow('429');
  });
});
