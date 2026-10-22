import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade } from '../market-feed';
import { mergeHistory, planWarmStart, type TradeStore, WarmStartFeed } from '../warm-start';

const T0 = 1_700_000_000_000;
const SPAN = 5 * 60_000;
const t = (ts: number, side: Trade['side'] = 'buy'): Trade => ({ ts, price: 100, qty: 1, side });

describe('planWarmStart', () => {
  it('fetches the whole span when nothing is cached', () => {
    expect(planWarmStart([], T0, SPAN)).toEqual({ keep: [], fetchFrom: T0 - SPAN });
  });

  it('keeps cached trades inside the span and fetches only after the newest one', () => {
    const cached = [t(T0 - SPAN - 1), t(T0 - 60_000), t(T0 - 20_000)];
    const plan = planWarmStart(cached, T0, SPAN);
    expect(plan.keep.map((x) => x.ts)).toEqual([T0 - 60_000, T0 - 20_000]);
    expect(plan.fetchFrom).toBe(T0 - 20_000 + 1);
  });

  it('ignores a cache that is entirely too old', () => {
    expect(planWarmStart([t(T0 - SPAN - 5_000)], T0, SPAN)).toEqual({
      keep: [],
      fetchFrom: T0 - SPAN,
    });
  });
});

describe('mergeHistory', () => {
  it('cuts history before the first live trade so the overlap is neither doubled nor reordered', () => {
    const merged = mergeHistory([t(1), t(3), t(5), t(6)], [t(5, 'sell'), t(7)]);
    expect(merged.map((x) => [x.ts, x.side])).toEqual([
      [1, 'buy'],
      [3, 'buy'],
      [5, 'sell'],
      [7, 'buy'],
    ]);
  });

  it('keeps all history, in time order, when no live trade arrived yet', () => {
    expect(mergeHistory([t(3), t(1)], []).map((x) => x.ts)).toEqual([1, 3]);
  });
});

class FakeFeed implements MarketFeed {
  readonly label = 'Fake';
  readonly trades = new Emitter<Trade>();
  connected = 0;
  connect() {
    this.connected++;
  }
  disconnect() {}
  now() {
    return Date.now();
  }
  onTrade(cb: (x: Trade) => void) {
    return this.trades.on(cb);
  }
  onLiquidation(_cb: (l: Liquidation) => void) {
    return () => {};
  }
  onStatus(_cb: (s: FeedStatus) => void) {
    return () => true;
  }
}

class MemoryStore implements TradeStore {
  saved: Trade[] = [];
  constructor(private initial: Trade[] = []) {}
  async load() {
    return this.initial;
  }
  async save(trades: readonly Trade[]) {
    this.saved = [...trades];
  }
}

describe('WarmStartFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens live at once, replays cache + fetched gap + held live trades in time order', async () => {
    const inner = new FakeFeed();
    let release: (rows: Trade[]) => void = () => {};
    const fetchFroms: number[] = [];
    const store = new MemoryStore([t(T0 - 40_000), t(T0 - 30_000)]);
    const feed = new WarmStartFeed(
      inner,
      (from) => {
        fetchFroms.push(from);
        const { promise, resolve } = Promise.withResolvers<Trade[]>();
        release = resolve;
        return promise;
      },
      store,
      SPAN,
    );
    const seen: number[] = [];
    feed.onTrade((x) => seen.push(x.ts));
    feed.connect();
    expect(inner.connected).toBe(1);

    // Live trades during the fetch are held, not dropped and not emitted early.
    inner.trades.emit(t(T0 - 2_000));
    inner.trades.emit(t(T0 - 1_000));
    await vi.waitFor(() => expect(fetchFroms).toEqual([T0 - 30_000 + 1]));
    expect(seen).toEqual([]);

    release([t(T0 - 10_000), t(T0 - 2_000)]);
    await vi.waitFor(() => expect(seen).toHaveLength(5));
    expect(seen).toEqual([T0 - 40_000, T0 - 30_000, T0 - 10_000, T0 - 2_000, T0 - 1_000]);

    // After warm-up live trades pass straight through.
    inner.trades.emit(t(T0));
    expect(seen.at(-1)).toBe(T0);
  });

  it('falls back to live only when history cannot be fetched', async () => {
    const inner = new FakeFeed();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const feed = new WarmStartFeed(
      inner,
      async () => {
        throw new Error('429');
      },
      new MemoryStore(),
      SPAN,
    );
    const seen: number[] = [];
    feed.onTrade((x) => seen.push(x.ts));
    feed.connect();
    inner.trades.emit(t(T0 - 500));
    await vi.waitFor(() => expect(seen).toEqual([T0 - 500]));
  });

  it('does not let a cache that never answers hold the live stream back', async () => {
    const inner = new FakeFeed();
    const hung: TradeStore = {
      load: () => new Promise(() => {}),
      save: async () => {},
    };
    const fetchFroms: number[] = [];
    const feed = new WarmStartFeed(
      inner,
      async (from) => {
        fetchFroms.push(from);
        return [t(T0 - 3_000)];
      },
      hung,
      SPAN,
    );
    const seen: number[] = [];
    feed.onTrade((x) => seen.push(x.ts));
    feed.connect();
    inner.trades.emit(t(T0 - 100));
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.waitFor(() => expect(seen).toEqual([T0 - 3_000, T0 - 100]));
    // The span is measured from when the cache gave up, 1.5 s after connect.
    expect(fetchFroms).toEqual([T0 + 1_500 - SPAN]);
  });

  it('saves only the trailing span, periodically and on disconnect', async () => {
    const inner = new FakeFeed();
    const store = new MemoryStore();
    const feed = new WarmStartFeed(inner, async () => [], store, SPAN);
    const seen: number[] = [];
    feed.onTrade((x) => seen.push(x.ts));
    feed.connect();
    inner.trades.emit(t(T0));
    await vi.waitFor(() => expect(seen).toEqual([T0]));
    inner.trades.emit(t(T0 + SPAN + 1_000));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.saved.map((x) => x.ts)).toEqual([T0 + SPAN + 1_000]);
    inner.trades.emit(t(T0 + SPAN + 2_000));
    feed.disconnect();
    await vi.waitFor(() => expect(store.saved).toHaveLength(2));
  });
});
