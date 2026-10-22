import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceFuturesFeed, binanceStreamUrl, parseAggTrade, parseForceOrder } from '../binance';
import type { Trade } from '../market-feed';
import type { CachedTrade, TradeStore } from '../trade-cache';

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

describe('BinanceFuturesFeed history', () => {
  /** One trade per second; aggregate id ↔ time is a bijection so tests can read ids back. */
  const T0 = 1_792_000_000_000;
  const at = (a: number) => T0 + a * 1000;
  const idOf = (t: Trade) => (t.ts - T0) / 1000;
  const row = (a: number) => ({ a, p: '100', q: '1', T: at(a), m: false });

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static last: FakeWebSocket | null = null;
    readyState = FakeWebSocket.OPEN;
    onmessage: ((e: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      FakeWebSocket.last = this;
    }
    close(): void {}
    live(a: number): void {
      const data = { e: 'aggTrade', E: at(a), ...row(a) };
      this.onmessage?.({ data: JSON.stringify({ stream: 'x@aggTrade', data }) });
    }
  }

  /** REST stub over ids [0, latest]: no fromId → newest page, fromId → page from there. */
  function stubRest(latest: number) {
    const fetchMock = vi.fn(async (url: string) => {
      const from = new URL(url).searchParams.get('fromId');
      const lo = from === null ? Math.max(0, latest - 999) : Number(from);
      const hi = Math.min(latest, lo + 999);
      const rows = Array.from({ length: hi - lo + 1 }, (_, i) => row(lo + i));
      return { ok: true, status: 200, json: async () => rows };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function connect(store?: TradeStore) {
    const feed = new BinanceFuturesFeed('BTCUSDT', { historyMs: 30 * 60_000, store });
    const ids: number[] = [];
    feed.onTrade((t) => ids.push(idOf(t)));
    feed.connect();
    return { feed, ids, ws: FakeWebSocket.last as FakeWebSocket };
  }

  const cachedRow = (a: number): CachedTrade => ({
    id: a,
    ts: at(a),
    price: 100,
    qty: 1,
    side: 'buy',
  });
  const contiguous = (ids: number[]) =>
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => (ids[0] as number) + i));

  beforeEach(() => vi.stubGlobal('WebSocket', FakeWebSocket));
  afterEach(() => vi.unstubAllGlobals());

  it('emits 30 min of REST history before buffered live trades, once per id, in order', async () => {
    // REST already has 5002; the live stream delivered 5001…5003 while history loaded.
    stubRest(5002);
    const { feed, ids, ws } = connect();
    ws.live(5001);
    ws.live(5002);
    ws.live(5003);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(5003));
    ws.live(5004);

    // Pages go back from the newest until one starts at or before 30 min ago (id 3201).
    expect(ids[0]).toBeLessThanOrEqual(5001 - 1800);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => (ids[0] as number) + i));
    expect(ids.at(-1)).toBe(5004);
    feed.disconnect();
  });

  it('stops at id 0 on a young symbol without repeating the clamped page overlap', async () => {
    const rest = stubRest(1500);
    const { feed, ids, ws } = connect();
    ws.live(1501);
    ws.live(1502);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(1502));

    expect(ids).toEqual(Array.from({ length: 1503 }, (_, i) => i));
    expect(rest).toHaveBeenCalledTimes(2);
    expect(rest.mock.calls[1]?.[0]).toContain('fromId=0');
    feed.disconnect();
  });

  it('falls back to a live warm-up when history fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => [] })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { feed, ids, ws } = connect();
    ws.live(7);
    ws.live(8);
    await vi.waitFor(() => expect(ids).toEqual([7, 8]));
    ws.live(9);
    expect(ids).toEqual([7, 8, 9]);
    feed.disconnect();
  });

  it('caps the REST pages on a busy pair', async () => {
    // 1 trade/s still needs 1800 ids for 30 min; a pair with ids this dense never gets there.
    const busy = vi.fn(async (url: string) => {
      const from = new URL(url).searchParams.get('fromId');
      const lo = from === null ? 1_000_000 : Number(from);
      const rows = Array.from({ length: 1000 }, (_, i) => ({ ...row(0), a: lo + i, T: at(5000) }));
      return { ok: true, status: 200, json: async () => rows };
    });
    vi.stubGlobal('fetch', busy);
    const { feed, ids, ws } = connect();
    ws.live(5000);
    await vi.waitFor(() => expect(ids.length).toBeGreaterThan(1));
    expect(busy).toHaveBeenCalledTimes(20);
    feed.disconnect();
  });

  it('restores the cache and fetches only the gap after it', async () => {
    const rest = stubRest(5002);
    const cache = Array.from({ length: 991 }, (_, i) => cachedRow(4000 + i));
    const { feed, ids, ws } = connect({ load: async () => cache, save: async () => {} });
    ws.live(5001);
    ws.live(5002);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(5002));
    expect(rest).toHaveBeenCalledTimes(1);
    expect(ids[0]).toBe(4000);
    contiguous(ids);
    feed.disconnect();
  });

  it('drops a cache the fetch could not reach, rather than leave a hole', async () => {
    stubRest(5000);
    // Inside the 30-min window by time, but its id is far below where the walk back stops.
    const stale = [{ ...cachedRow(10), ts: at(4500) }];
    const { feed, ids, ws } = connect({ load: async () => stale, save: async () => {} });
    ws.live(5001);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(5001));
    contiguous(ids);
    feed.disconnect();
  });

  it('ignores the cache when history cannot be fetched: live only, no hole', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => [] })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const old = Array.from({ length: 10 }, (_, i) => cachedRow(3500 + i));
    const { feed, ids, ws } = connect({ load: async () => old, save: async () => {} });
    ws.live(5001);
    ws.live(5002);
    await vi.waitFor(() => expect(ids).toEqual([5001, 5002]));
    feed.disconnect();
  });

  it('saves only the newest unbroken run of ids, so a reload never replays a gap', async () => {
    stubRest(5000);
    let saved: readonly CachedTrade[] = [];
    const { feed, ids, ws } = connect({
      load: async () => [],
      save: async (rows) => {
        saved = rows;
      },
    });
    ws.live(5001);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(5001));
    // A reconnect skipped 5002…5009.
    ws.live(5010);
    ws.live(5011);
    feed.disconnect();
    await vi.waitFor(() => expect(saved.map((r) => r.id)).toEqual([5010, 5011]));
  });

  it('does not let a cache that never answers hold the stream back', async () => {
    stubRest(5000);
    const { feed, ids, ws } = connect({ load: () => new Promise(() => {}), save: async () => {} });
    ws.live(5001);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(5001), { timeout: 3_000 });
    expect(ids[0]).toBeLessThanOrEqual(5001 - 1800);
    feed.disconnect();
  });

  it('saves the trailing 30 min with ids on disconnect', async () => {
    stubRest(5000);
    let saved: readonly CachedTrade[] = [];
    const { feed, ids, ws } = connect({
      load: async () => [],
      save: async (rows) => {
        saved = rows;
      },
    });
    ws.live(5001);
    await vi.waitFor(() => expect(ids.at(-1)).toBe(5001));
    ws.live(5002);
    feed.disconnect();
    await vi.waitFor(() => expect(saved.at(-1)?.id).toBe(5002));
    expect((saved.at(-1)?.ts ?? 0) - (saved[0]?.ts ?? 0)).toBeLessThanOrEqual(30 * 60_000);
    expect(saved.map((r) => r.id)).toEqual(saved.map((r) => idOf(r)));
  });
});
