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
/** Trade history loaded on connect, so metrics start warm instead of after a 5-minute warm-up. */
const HISTORY_MS = 30 * 60_000;
/** `aggTrades` weighs 20; 20 pages = 400 of the 2400/min per-IP budget. */
const HISTORY_MAX_PAGES = 20;
const HISTORY_PAGE_SIZE = 1000;
/** Whole history load gives up after this and falls back to the live warm-up, ms. */
const HISTORY_TIMEOUT_MS = 15_000;
/** Longest wait for the trade cache; a stuck store must never hold the live stream back. */
const CACHE_TIMEOUT_MS = 1_500;
/** How often the trailing HISTORY_MS of trades is written to the store. */
const SAVE_EVERY_MS = 30_000;

/**
 * Recent aggregate trades, oldest first, newer than `afterId`, back to
 * `sinceMs` or HISTORY_MAX_PAGES pages, whichever comes first. Pages walk back
 * by id: ids are contiguous, so stopping at `afterId` + 1 extends a cache exactly.
 */
async function fetchAggTradesSince(
  symbol: string,
  sinceMs: number,
  afterId: number,
  signal: AbortSignal,
): Promise<AggTradeRow[]> {
  const base = `${REST_BASE}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${HISTORY_PAGE_SIZE}`;
  const pages: AggTradeRow[][] = [];
  let fromId: number | null = null;
  for (let i = 0; i < HISTORY_MAX_PAGES; i++) {
    const res = await fetch(fromId === null ? base : `${base}&fromId=${fromId}`, { signal });
    if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
    const page = (await res.json()) as AggTradeRow[];
    const first = page[0];
    if (!first) break;
    // A page clamped at id 0 overlaps the next newer one.
    const end = pages[0]?.[0]?.a ?? Number.POSITIVE_INFINITY;
    pages.unshift(page.filter((r) => r.a < end && r.a > afterId));
    if (first.T <= sinceMs || first.a === 0 || first.a <= afterId + 1) break;
    fromId = Math.max(0, first.a - HISTORY_PAGE_SIZE);
  }
  return pages.flat();
}

export class BinanceFuturesFeed implements MarketFeed {
  readonly label: string;
  private readonly symbol: string;
  private readonly trades = new Emitter<Trade>();
  private readonly liquidations = new Emitter<Liquidation>();
  private readonly status = new Emitter<FeedStatus>();
  private readonly socket: ReconnectingSocket;
  /** Smoothed (exchange event time − local time), ms. */
  private clockOffset = 0;
  private clockSynced = false;
  private history: 'pending' | 'loading' | 'done' = 'pending';
  /** Live trades held back while history loads, so trades reach consumers in time order. */
  private held: AggTradeMsg[] = [];
  /** Newest id emitted from history; live trades up to it are duplicates. */
  private lastHistoryId = -1;
  private readonly abort = new AbortController();
  /** The newest unbroken run of emitted trades (by id) within HISTORY_MS, for the store. */
  private recent: CachedTrade[] = [];
  private saveTimer: number | undefined;
  private readonly saveWhenHidden = () => {
    if (document.visibilityState === 'hidden') void this.persist();
  };

  /** `store` keeps recent trades across reloads so a restart only fetches what it missed. */
  constructor(
    symbol: string,
    private readonly store: TradeStore = NO_STORE,
  ) {
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
  }

  /** Final: a feed is single-use (`main.ts` builds a new one per pipeline), so the abort is not reset. */
  disconnect(): void {
    this.abort.abort();
    this.socket.stop();
    clearInterval(this.saveTimer);
    globalThis.document?.removeEventListener('visibilitychange', this.saveWhenHidden);
    void this.persist();
  }

  now(): number {
    return Date.now() + this.clockOffset;
  }

  onTrade(cb: (t: Trade) => void): Unsubscribe {
    return this.trades.on(cb);
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
    if (this.history === 'done') {
      if (d.a > this.lastHistoryId) this.emit({ ...parseAggTrade(d), id: d.a });
      return;
    }
    this.held.push(d);
    if (this.history === 'pending') {
      // Starting on the first live trade makes the REST snapshot overlap the
      // stream; the overlap is dropped by id.
      this.history = 'loading';
      void this.loadHistory(d.T);
    }
  }

  /**
   * Every trade leaves through here. A gap in ids (reconnect, REST lag) starts
   * the saved run over, so a reload never replays the gap as a flat stretch.
   */
  private emit(t: CachedTrade): void {
    const prev = this.recent.at(-1);
    if (prev && t.id !== prev.id + 1) this.recent = [];
    this.recent.push(t);
    this.trades.emit({ ts: t.ts, price: t.price, qty: t.qty, side: t.side });
  }

  private async loadHistory(liveTs: number): Promise<void> {
    // skipped: a reconnect during this load (a few seconds) is not replayed as a
    // resync between history and held trades, so the move across that gap can
    // count within window N once. Unlikely and self-healing within N; queue
    // statuses with the held trades if it ever shows up.
    const sinceMs = liveTs - HISTORY_MS;
    const cached = (await this.loadCache()).filter((t) => t.ts > sinceMs && t.ts < liveTs);
    const cachedLastId = cached.at(-1)?.id ?? -1;
    let rows: AggTradeRow[] = [];
    let fetched = false;
    // A stalled request must not hold live trades back forever: time out into the fallback.
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(HISTORY_TIMEOUT_MS)]);
    try {
      rows = await fetchAggTradesSince(this.symbol, sinceMs, cachedLastId, signal);
      fetched = true;
    } catch (err) {
      if (this.abort.signal.aborted) return;
      console.warn('Trade history unavailable; metrics warm up live', err);
    }
    if (this.abort.signal.aborted) return;
    // The cache is used only if a fetch reached back to it: a failed fetch, or one
    // that stopped short, would leave a hole that reads as a flat market and then a jump.
    const first = rows[0];
    const contiguous = fetched && (!first || first.a === cachedLastId + 1);
    if (contiguous) for (const t of cached) this.emit(t);
    // shortcut: if REST lags the stream, trades between its newest and the first
    // held one are lost (sub-second); fetch forward from lastHistoryId if it ever matters.
    for (const r of rows) this.emit({ ...parseAggTrade(r), id: r.a });
    this.lastHistoryId = rows.at(-1)?.a ?? (contiguous ? cachedLastId : -1);
    this.history = 'done';
    const held = this.held;
    this.held = [];
    for (const d of held) this.onAggTrade(d);
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
    if (!last) return;
    const cutoff = last.ts - HISTORY_MS;
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
