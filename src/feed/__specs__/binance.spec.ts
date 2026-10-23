import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BinanceFuturesFeed,
  binanceStreamUrl,
  olderPages,
  parseAggTrade,
  parseForceOrder,
} from '../binance';
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

describe('olderPages', () => {
  const SINCE = 1_792_000_000_000;
  const MIN = 60_000;
  /** The newest page: 1000 ids from `a`, its first trade at `T`, its last `spanMs` later. */
  const page = (a: number, T: number, spanMs: number) => [
    { a, T },
    { a: a + 999, T: T + spanMs },
  ];

  it('counts exactly the pages up to a reachable cache', () => {
    // Ids 7500…9999 are missing: 2500 ids → 3 pages.
    expect(olderPages(page(10_000, SINCE + 5 * MIN, MIN), SINCE, 7_499)).toBe(3);
  });

  it('needs none when the newest page already meets the cache', () => {
    expect(olderPages(page(10_000, SINCE + 5 * MIN, MIN), SINCE, 9_999)).toBe(0);
    expect(olderPages(page(10_000, SINCE + 5 * MIN, MIN), SINCE, 10_500)).toBe(0);
  });

  it("reaches back to the window start at the newest page's pace", () => {
    // 1000 trades per 2 min, the page starts 30 min after the window start → 15 pages.
    expect(olderPages(page(100_000, SINCE + 30 * MIN, 2 * MIN), SINCE, -1)).toBe(15);
    // A cache further back than 19 pages is out of reach: same estimate by pace.
    expect(olderPages(page(100_000, SINCE + 30 * MIN, 2 * MIN), SINCE, 50)).toBe(15);
  });

  it('needs none once the newest page reaches the window start', () => {
    expect(olderPages(page(100_000, SINCE, 2 * MIN), SINCE, -1)).toBe(0);
  });

  it('caps at 19 older pages, fewer near id 0', () => {
    expect(olderPages(page(100_000, SINCE + 30 * MIN, 10_000), SINCE, -1)).toBe(19);
    // All 1000 trades in one millisecond: the pace says nothing, take the cap.
    expect(olderPages(page(100_000, SINCE + 30 * MIN, 0), SINCE, -1)).toBe(19);
    expect(olderPages(page(1_500, SINCE + 30 * MIN, 2 * MIN), SINCE, -1)).toBe(2);
    expect(olderPages(page(0, SINCE + 30 * MIN, 2 * MIN), SINCE, -1)).toBe(0);
  });

  it('needs none for an empty page', () => {
    expect(olderPages([], SINCE, -1)).toBe(0);
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
    live(a: number, T = at(a)): void {
      const data = { e: 'aggTrade', E: T, ...row(a), T };
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

  /** A pair so busy that 1000 ids share one timestamp (at(5000)); the newest id is 1_000_999. */
  function stubBusyRest() {
    const fetchMock = vi.fn(async (url: string) => {
      const from = new URL(url).searchParams.get('fromId');
      const lo = from === null ? 1_000_000 : Number(from);
      const rows = Array.from({ length: 1000 }, (_, i) => ({ ...row(0), a: lo + i, T: at(5000) }));
      return { ok: true, status: 200, json: async () => rows };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function failRest() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => [] })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  }

  function connect(store?: TradeStore, historyMs = 30 * 60_000) {
    const feed = new BinanceFuturesFeed('BTCUSDT', { historyMs, store });
    const live: number[] = [];
    const histories: (readonly Trade[])[] = [];
    feed.onTrade((t) => live.push(idOf(t)));
    feed.onHistory((h) => histories.push(h));
    feed.connect();
    const history = () => (histories[0] ?? []).map(idOf);
    return { feed, live, histories, history, ws: FakeWebSocket.last as FakeWebSocket };
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

  it('emits live trades at once, while history is still loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.withResolvers<never>().promise),
    );
    const { feed, live, histories, ws } = connect();
    ws.live(5001);
    ws.live(5002);
    expect(live).toEqual([5001, 5002]);
    expect(histories).toEqual([]);
    feed.disconnect();
  });

  it('delivers 30 min of history once, ending right before the first live trade', async () => {
    // REST already has 5002; the stream delivered 5001 first.
    stubRest(5002);
    const { feed, live, histories, history, ws } = connect();
    ws.live(5001);
    ws.live(5002);
    await vi.waitFor(() => expect(histories).toHaveLength(1));
    ws.live(5003);

    expect(history()[0]).toBeLessThanOrEqual(5001 - 1800);
    expect(history().at(-1)).toBe(5000);
    contiguous(history());
    expect(live).toEqual([5001, 5002, 5003]);
    expect(histories).toHaveLength(1);
    feed.disconnect();
  });

  it('fetches the older pages in one parallel wave', async () => {
    let inFlight = 0;
    let peak = 0;
    const rest = vi.fn(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5);
      await promise;
      inFlight--;
      const from = new URL(url).searchParams.get('fromId');
      const lo = from === null ? 9_001 : Number(from);
      const rows = Array.from({ length: 1000 }, (_, i) => row(lo + i));
      return { ok: true, status: 200, json: async () => rows };
    });
    vi.stubGlobal('fetch', rest);
    // A 2 h window at 1 trade/s: the newest page 9001…10000, then ceil(6200 s / 999 s) = 7 older.
    const { feed, histories, history, ws } = connect(undefined, 2 * 60 * 60_000);
    ws.live(10_001);
    await vi.waitFor(() => expect(histories).toHaveLength(1));

    expect(rest).toHaveBeenCalledTimes(8);
    expect(peak).toBe(7);
    expect(history()[0]).toBeLessThanOrEqual(10_001 - 7200);
    contiguous(history());
    feed.disconnect();
  });

  it('stops at id 0 on a young symbol without repeating the clamped page overlap', async () => {
    const rest = stubRest(1500);
    const { feed, live, histories, history, ws } = connect();
    ws.live(1501);
    await vi.waitFor(() => expect(histories).toHaveLength(1));

    expect(history()).toEqual(Array.from({ length: 1501 }, (_, i) => i));
    expect(live).toEqual([1501]);
    expect(rest).toHaveBeenCalledTimes(2);
    expect(rest.mock.calls[1]?.[0]).toContain('fromId=0');
    feed.disconnect();
  });

  it('reports no history when REST fails, and the live stream goes on', async () => {
    failRest();
    const { feed, live, histories, ws } = connect();
    ws.live(7);
    await vi.waitFor(() => expect(histories).toEqual([[]]));
    ws.live(8);
    expect(live).toEqual([7, 8]);
    feed.disconnect();
  });

  it('caps the REST pages on a busy pair', async () => {
    const busy = stubBusyRest();
    const { feed, histories, ws } = connect();
    ws.live(1_001_000, at(5000));
    await vi.waitFor(() => expect(histories).toHaveLength(1));
    expect(busy).toHaveBeenCalledTimes(20);
    expect(histories[0]).toHaveLength(20_000);
    feed.disconnect();
  });

  it('restores the cache and fetches only the gap after it', async () => {
    const rest = stubRest(5002);
    const cache = Array.from({ length: 991 }, (_, i) => cachedRow(4000 + i));
    const { feed, histories, history, ws } = connect({
      load: async () => cache,
      save: async () => {},
    });
    ws.live(5001);
    await vi.waitFor(() => expect(histories).toHaveLength(1));

    expect(rest).toHaveBeenCalledTimes(1);
    expect(history()[0]).toBe(4000);
    expect(history().at(-1)).toBe(5000);
    contiguous(history());
    feed.disconnect();
  });

  it('drops a cache the capped wave could not reach, rather than leave a hole', async () => {
    stubBusyRest();
    // Inside the 30-min window by time, but 19 pages back from 1_000_000 stop far above id 10.
    const stale = [{ ...cachedRow(10), ts: at(4500) }];
    const { feed, histories, ws } = connect({ load: async () => stale, save: async () => {} });
    ws.live(1_001_000, at(5000));
    await vi.waitFor(() => expect(histories).toHaveLength(1));

    const past = histories[0] as readonly Trade[];
    expect(past).toHaveLength(20_000);
    expect(past.some((t) => t.ts === at(4500))).toBe(false);
    feed.disconnect();
  });

  it('ignores the cache when history cannot be fetched: no history, no hole', async () => {
    failRest();
    const old = Array.from({ length: 10 }, (_, i) => cachedRow(3500 + i));
    const { feed, live, histories, ws } = connect({ load: async () => old, save: async () => {} });
    ws.live(5001);
    ws.live(5002);
    await vi.waitFor(() => expect(histories).toEqual([[]]));
    expect(live).toEqual([5001, 5002]);
    feed.disconnect();
  });

  it('saves only the newest unbroken run of ids, so a reload never replays a gap', async () => {
    stubRest(5000);
    let saved: readonly CachedTrade[] = [];
    const { feed, histories, ws } = connect({
      load: async () => [],
      save: async (rows) => {
        saved = rows;
      },
    });
    ws.live(5001);
    await vi.waitFor(() => expect(histories).toHaveLength(1));
    // A reconnect skipped 5002…5009.
    ws.live(5010);
    ws.live(5011);
    feed.disconnect();
    await vi.waitFor(() => expect(saved.map((r) => r.id)).toEqual([5010, 5011]));
  });

  it('does not let a cache that never answers hold history back', async () => {
    stubRest(5000);
    const { feed, histories, history, ws } = connect({
      load: () => Promise.withResolvers<CachedTrade[]>().promise,
      save: async () => {},
    });
    ws.live(5001);
    await vi.waitFor(() => expect(histories).toHaveLength(1), { timeout: 3_000 });
    expect(history()[0]).toBeLessThanOrEqual(5001 - 1800);
    feed.disconnect();
  });

  it('saves history and live trades as one run: the trailing 30 min with ids', async () => {
    stubRest(5000);
    let saved: readonly CachedTrade[] = [];
    const { feed, histories, ws } = connect({
      load: async () => [],
      save: async (rows) => {
        saved = rows;
      },
    });
    ws.live(5001);
    await vi.waitFor(() => expect(histories).toHaveLength(1));
    ws.live(5002);
    feed.disconnect();
    await vi.waitFor(() => expect(saved.at(-1)?.id).toBe(5002));
    // Trimmed to 30 min behind the newest trade: 5002 − 1800.
    expect(saved[0]?.id).toBe(3202);
    expect(saved.map((r) => r.id)).toEqual(saved.map((r) => idOf(r)));
  });
});
