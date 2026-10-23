import { Emitter } from './emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade, Unsubscribe } from './market-feed';
import { ReconnectingSocket } from './reconnecting-socket';
import { type CachedTrade, NO_STORE, type TradeStore } from './trade-cache';

/**
 * USDⓈ-M Futures routed endpoint. Legacy `wss://fstream.binance.com/ws/...`
 * was decommissioned on 2026-04-23; aggTrade/forceOrder/markPrice live under /market.
 */
const WS_BASE = 'wss://fstream.binance.com/market/stream';
const REST_BASE = 'https://fapi.binance.com';

/** A row of `GET /fapi/v1/aggTrades`; the stream message carries the same fields. */
interface AggTradeRow {
  /** Aggregate trade id, contiguous per symbol. */
  a: number;
  T: number;
  p: string;
  q: string;
  /** Buyer is the maker → the aggressor sold. */
  m: boolean;
}

interface AggTradeMsg extends AggTradeRow {
  e: 'aggTrade';
  E: number;
}

interface ForceOrderMsg {
  e: 'forceOrder';
  E: number;
  o: {
    S: 'BUY' | 'SELL';
    /** Average fill price. */
    ap: string;
    /** Accumulated filled quantity. */
    z: string;
    T: number;
  };
}

interface CombinedMsg {
  stream: string;
  data: { e?: string; E?: number };
}

/** @package */
export function parseAggTrade(d: Omit<AggTradeRow, 'a'>): Trade {
  return { ts: d.T, price: Number(d.p), qty: Number(d.q), side: d.m ? 'sell' : 'buy' };
}

/** @package */
export function parseForceOrder(d: ForceOrderMsg): Liquidation {
  const price = Number(d.o.ap);
  const qty = Number(d.o.z);
  // A forced SELL closes a long position.
  return { ts: d.o.T, price, qty, usd: price * qty, side: d.o.S === 'SELL' ? 'long' : 'short' };
}

/** @package */
export function binanceStreamUrl(symbol: string): string {
  const s = symbol.toLowerCase();
  // markPrice@1s is a guaranteed 1 Hz heartbeat so the silence watchdog
  // does not flap on illiquid pairs with sparse trades.
  return `${WS_BASE}?streams=${s}@aggTrade/${s}@forceOrder/${s}@markPrice@1s`;
}

/** Weight of each new clock-offset observation. */
const CLOCK_ALPHA = 0.05;

export interface BinanceFeedOptions {
  /** History fetched in the background on connect: the metrics stats window. */
  historyMs: number;
  /** Keeps recent trades across reloads so a restart only fetches what it missed. */
  store?: TradeStore;
}

/** `aggTrades` weighs 20; 20 pages = 400 of the 2400/min per-IP budget. */
const HISTORY_MAX_PAGES = 20;
const HISTORY_PAGE_SIZE = 1000;
/** Whole history load gives up after this and reports no history: metrics warm up live, ms. */
const HISTORY_TIMEOUT_MS = 15_000;
/** Longest wait for the trade cache; a stuck store must never hold the live stream back. */
const CACHE_TIMEOUT_MS = 1_500;
/** How often the trailing history window of trades is written to the store. */
const SAVE_EVERY_MS = 30_000;

/**
 * How many pages older than `newest` to fetch in one parallel wave: exactly up to the cache
 * when the capped wave reaches it, else enough to reach `sinceMs` at the newest page's pace.
 * @package
 */
export function olderPages(
  newest: readonly Pick<AggTradeRow, 'a' | 'T'>[],
  sinceMs: number,
  cachedLastId: number,
): number {
  const first = newest[0];
  const last = newest.at(-1);
  if (!first || !last) return 0;
  const cap = Math.min(HISTORY_MAX_PAGES - 1, Math.ceil(first.a / HISTORY_PAGE_SIZE));
  const gap = first.a - cachedLastId - 1;
  if (cachedLastId >= 0 && gap <= cap * HISTORY_PAGE_SIZE) {
    return Math.max(0, Math.ceil(gap / HISTORY_PAGE_SIZE));
  }
  if (first.T <= sinceMs) return 0;
  const spanMs = last.T - first.T;
  if (spanMs <= 0) return cap;
  // shortcut: one wave at the newest page's pace; if older trading was busier, history falls
  // short of the window (tension needs only 5 min). Add a second wave if that ever shows.
  return Math.min(cap, Math.ceil((first.T - sinceMs) / spanMs));
}

/** One page of aggregate trades, oldest first: the newest page, or 1000 ids from `fromId`. */
async function fetchPage(
  symbol: string,
  fromId: number | null,
  signal: AbortSignal,
): Promise<AggTradeRow[]> {
  const base = `${REST_BASE}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${HISTORY_PAGE_SIZE}`;
  const res = await fetch(fromId === null ? base : `${base}&fromId=${fromId}`, { signal });
  if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
  return (await res.json()) as AggTradeRow[];
}

export class BinanceFuturesFeed implements MarketFeed {
  readonly label: string;
  private readonly symbol: string;
  private readonly trades = new Emitter<Trade>();
  private readonly histories = new Emitter<readonly Trade[]>();
  private readonly liquidations = new Emitter<Liquidation>();
  private readonly status = new Emitter<FeedStatus>();
  private readonly socket: ReconnectingSocket;
  /** Smoothed (exchange event time − local time), ms. */
  private clockOffset = 0;
  private clockSynced = false;
  /** History is fetched once, from the first live trade. */
  private historyStarted = false;
  /**
   * Until history lands, `recent` holds only a few live trades: saving them (pagehide, pair
   * switch) would replace the pair's 30-min cache with seconds, and the next load would warm up
   * live instead of from the cache.
   */
  private historyLanded = false;
  private readonly abort = new AbortController();
  /** The newest unbroken run of emitted trades (by id) within the history window, for the store. */
  private recent: CachedTrade[] = [];
  private saveTimer: number | undefined;
  private readonly saveWhenHidden = () => {
    if (document.visibilityState === 'hidden') void this.persist();
  };
  /** Reload or close: the 30 s timer may not have run yet, and a reload should find the cache. */
  private readonly saveOnLeave = () => void this.persist();

  private readonly historyMs: number;
  private readonly store: TradeStore;

  constructor(symbol: string, opts: BinanceFeedOptions) {
    this.historyMs = opts.historyMs;
    this.store = opts.store ?? NO_STORE;
    this.symbol = symbol.toUpperCase();
    this.label = `Binance ${this.symbol}`;
    this.socket = new ReconnectingSocket(
      binanceStreamUrl(this.symbol),
      (raw) => this.handle(raw),
      (s) => this.status.emit(s),
    );
  }

  connect(): void {
    this.socket.start();
    this.saveTimer = setInterval(() => void this.persist(), SAVE_EVERY_MS);
    globalThis.document?.addEventListener('visibilitychange', this.saveWhenHidden);
    globalThis.window?.addEventListener('pagehide', this.saveOnLeave);
  }

  /** Final: a feed is single-use (`main.ts` builds a new one per pipeline), so the abort is not reset. */
  disconnect(): void {
    this.abort.abort();
    this.socket.stop();
    clearInterval(this.saveTimer);
    globalThis.document?.removeEventListener('visibilitychange', this.saveWhenHidden);
    globalThis.window?.removeEventListener('pagehide', this.saveOnLeave);
    void this.persist();
  }

  now(): number {
    return Date.now() + this.clockOffset;
  }

  onTrade(cb: (t: Trade) => void): Unsubscribe {
    return this.trades.on(cb);
  }

  onHistory(cb: (trades: readonly Trade[]) => void): Unsubscribe {
    return this.histories.on(cb);
  }

  onLiquidation(cb: (l: Liquidation) => void): Unsubscribe {
    return this.liquidations.on(cb);
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    return this.status.on(cb);
  }

  private handle(raw: string): void {
    const msg = JSON.parse(raw) as CombinedMsg;
    const d = msg.data;
    if (typeof d.E === 'number') this.observeClock(d.E);
    if (d.e === 'aggTrade') this.onAggTrade(d as AggTradeMsg);
    else if (d.e === 'forceOrder') this.liquidations.emit(parseForceOrder(d as ForceOrderMsg));
  }

  private onAggTrade(d: AggTradeMsg): void {
    if (!this.historyStarted) {
      this.historyStarted = true;
      // History ends right before the first live trade, so the two never overlap.
      void this.loadHistory(d.T, d.a);
    }
    this.emit({ ...parseAggTrade(d), id: d.a });
  }

  /**
   * Every live trade leaves through here. A gap in ids (reconnect) starts the saved
   * run over, so a reload never replays the gap as a flat stretch.
   */
  private emit(t: CachedTrade): void {
    const prev = this.recent.at(-1);
    if (prev && t.id !== prev.id + 1) this.recent = [];
    this.recent.push(t);
    this.trades.emit({ ts: t.ts, price: t.price, qty: t.qty, side: t.side });
  }

  private async loadHistory(liveTs: number, firstLiveId: number): Promise<void> {
    const sinceMs = liveTs - this.historyMs;
    // A stalled request must not keep the meter waiting forever: time out into "no history".
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(HISTORY_TIMEOUT_MS)]);
    // The cache is read while the newest page is in flight; only the older pages depend on it.
    const cache = this.loadCache();
    let past: CachedTrade[] = [];
    try {
      const newest = await fetchPage(this.symbol, null, signal);
      const cached = (await cache).filter((t) => t.ts > sinceMs && t.ts < liveTs);
      const cachedLastId = cached.at(-1)?.id ?? -1;
      const firstId = newest[0]?.a ?? 0;
      const n = olderPages(newest, sinceMs, cachedLastId);
      const older = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          fetchPage(this.symbol, Math.max(0, firstId - (n - i) * HISTORY_PAGE_SIZE), signal),
        ),
      );
      const rows: CachedTrade[] = [];
      let prevId = cachedLastId;
      // Pages oldest first; pages clamped at id 0 overlap, and the newest may run into live ids.
      for (const r of [...older.flat(), ...newest]) {
        if (r.a <= prevId || r.a >= firstLiveId) continue;
        rows.push({ ...parseAggTrade(r), id: r.a });
        prevId = r.a;
      }
      // The cache is used only if the fetch reached back to it: one that stopped short would
      // leave a hole that reads as a flat market and then a jump.
      const reached = rows.length === 0 || rows[0]?.id === cachedLastId + 1;
      past = reached ? [...cached, ...rows] : rows;
    } catch (err) {
      if (this.abort.signal.aborted) return;
      console.warn('Trade history unavailable; metrics warm up live', err);
    }
    if (this.abort.signal.aborted) return;
    // shortcut: if REST lags the stream, trades between its newest and the first live one are
    // lost (sub-second); fetch forward from the last history id if it ever matters.
    const head = this.recent[0];
    if (head && past.at(-1)?.id === head.id - 1) this.recent = [...past, ...this.recent];
    this.historyLanded = true;
    this.histories.emit(past);
  }

  private async loadCache(): Promise<CachedTrade[]> {
    const { promise: gaveUp, resolve } = Promise.withResolvers<CachedTrade[]>();
    const timer = setTimeout(() => resolve([]), CACHE_TIMEOUT_MS);
    const cached = await Promise.race([this.store.load(), gaveUp]);
    clearTimeout(timer);
    return cached;
  }

  private async persist(): Promise<void> {
    const last = this.recent.at(-1);
    if (!last || !this.historyLanded) return;
    const cutoff = last.ts - this.historyMs;
    let drop = 0;
    while (drop < this.recent.length && (this.recent[drop] as CachedTrade).ts < cutoff) drop++;
    if (drop > 0) this.recent.splice(0, drop);
    await this.store.save(this.recent);
  }

  private observeClock(eventTime: number): void {
    const sample = eventTime - Date.now();
    if (!this.clockSynced) {
      this.clockOffset = sample;
      this.clockSynced = true;
    } else {
      this.clockOffset += CLOCK_ALPHA * (sample - this.clockOffset);
    }
  }
}

interface ExchangeInfo {
  symbols: { symbol: string; contractType: string; status: string }[];
}

/** Tradable USDⓈ-M perpetual symbols, sorted. ~1 MB response, so callers should cache. */
export async function fetchBinanceSymbols(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${REST_BASE}/fapi/v1/exchangeInfo`, { signal });
  if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
  const info = (await res.json()) as ExchangeInfo;
  return info.symbols
    .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
    .map((s) => s.symbol)
    .sort();
}
