import { Emitter } from './emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade, Unsubscribe } from './market-feed';
import { ReconnectingSocket } from './reconnecting-socket';
import { type CachedTrade, NO_STORE, type TradeStore } from './trade-cache';

/** Binance futures market. USDⓈ-M quotes quantities in coins, COIN-M in USD-face contracts. */
export const BINANCE_MARKETS = ['usdm', 'coinm'] as const;
export type BinanceMarket = (typeof BINANCE_MARKETS)[number];

const ENDPOINTS: Record<BinanceMarket, { ws: string; rest: string }> = {
  // Routed endpoint: legacy `wss://fstream.binance.com/ws/...` was decommissioned on 2026-04-23;
  // aggTrade/forceOrder/markPrice live under /market.
  usdm: { ws: 'wss://fstream.binance.com/market/stream', rest: 'https://fapi.binance.com/fapi/v1' },
  // COIN-M was not split: combined streams stay at /stream.
  coinm: { ws: 'wss://dstream.binance.com/stream', rest: 'https://dapi.binance.com/dapi/v1' },
};

/** A row of `GET /{fapi,dapi}/v1/aggTrades`; the stream message carries the same fields. */
interface AggTradeRow {
  /** Aggregate trade id, contiguous per symbol. */
  a: number;
  T: number;
  p: string;
  /** Base quantity (USDⓈ-M) or contract count (COIN-M). */
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
    /** Accumulated filled quantity: base (USDⓈ-M) or contracts (COIN-M). */
    z: string;
    T: number;
  };
}

interface CombinedMsg {
  stream: string;
  data: { e?: string; E?: number };
}

/**
 * Base-asset quantity of `q` at `price`. A COIN-M `q` counts contracts worth `contractUsd` each;
 * USDⓈ-M passes null, its `q` already is base.
 */
function baseQty(q: string, price: number, contractUsd: number | null): number {
  return contractUsd === null ? Number(q) : (Number(q) * contractUsd) / price;
}

/** @package */
export function parseAggTrade(d: Omit<AggTradeRow, 'a'>, contractUsd: number | null = null): Trade {
  const price = Number(d.p);
  return { ts: d.T, price, qty: baseQty(d.q, price, contractUsd), side: d.m ? 'sell' : 'buy' };
}

/** @package */
export function parseForceOrder(d: ForceOrderMsg, contractUsd: number | null = null): Liquidation {
  const price = Number(d.o.ap);
  const qty = baseQty(d.o.z, price, contractUsd);
  // A forced SELL closes a long position.
  return { ts: d.o.T, price, qty, usd: price * qty, side: d.o.S === 'SELL' ? 'long' : 'short' };
}

/** @package */
export function binanceStreamUrl(market: BinanceMarket, symbol: string): string {
  const s = symbol.toLowerCase();
  // markPrice@1s is a guaranteed 1 Hz heartbeat so the silence watchdog
  // does not flap on illiquid pairs with sparse trades.
  return `${ENDPOINTS[market].ws}?streams=${s}@aggTrade/${s}@forceOrder/${s}@markPrice@1s`;
}

/** Weight of each new clock-offset observation. */
const CLOCK_ALPHA = 0.05;

export interface BinanceFeedOptions {
  /** History fetched in the background on connect: the metrics stats window. */
  historyMs: number;
  /** Keeps recent trades across reloads so a restart only fetches what it missed. */
  store?: TradeStore;
}

/** `aggTrades` weighs 20 on both markets; 20 pages = 400 of the 2400/min per-IP budget. */
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
  market: BinanceMarket,
  symbol: string,
  fromId: number | null,
  signal: AbortSignal,
): Promise<AggTradeRow[]> {
  const base = `${ENDPOINTS[market].rest}/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${HISTORY_PAGE_SIZE}`;
  const res = await fetch(fromId === null ? base : `${base}&fromId=${fromId}`, { signal });
  if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
  return (await res.json()) as AggTradeRow[];
}

export class BinanceFuturesFeed implements MarketFeed {
  readonly label: string;
  private readonly market: BinanceMarket;
  private readonly symbol: string;
  /** COIN-M contract face value, USD; null on USDⓈ-M, whose quantities are base already. */
  private contractUsd: number | null = null;
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

  constructor(market: BinanceMarket, symbol: string, opts: BinanceFeedOptions) {
    this.historyMs = opts.historyMs;
    this.store = opts.store ?? NO_STORE;
    this.market = market;
    this.symbol = symbol.toUpperCase();
    this.label = `Binance ${this.symbol}`;
    this.socket = new ReconnectingSocket(
      binanceStreamUrl(market, this.symbol),
      (raw) => this.handle(raw),
      (s) => this.status.emit(s),
    );
  }

  connect(): void {
    if (this.market === 'coinm') void this.startContracts();
    else this.socket.start();
    this.saveTimer = setInterval(() => void this.persist(), SAVE_EVERY_MS);
    globalThis.document?.addEventListener('visibilitychange', this.saveWhenHidden);
    globalThis.window?.addEventListener('pagehide', this.saveOnLeave);
  }

  /** COIN-M counts contracts: their face value must be known before the first trade parses. */
  private async startContracts(): Promise<void> {
    this.status.emit({ state: 'connecting', attempt: 1 });
    try {
      this.contractUsd = await fetchContractUsd(this.symbol, this.abort.signal);
    } catch (err) {
      if (this.abort.signal.aborted) return;
      // shortcut: no retry; picking the pair again starts over. The specs come from the same host
      // as history, so an outage here is rare; retry with the socket's backoff if it ever shows.
      console.warn('COIN-M contract specs unavailable', err);
      this.status.emit({ state: 'error', message: 'contract specs unavailable' });
      return;
    }
    if (!this.abort.signal.aborted) this.socket.start();
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
    else if (d.e === 'forceOrder') {
      this.liquidations.emit(parseForceOrder(d as ForceOrderMsg, this.contractUsd));
    }
  }

  private onAggTrade(d: AggTradeMsg): void {
    if (!this.historyStarted) {
      this.historyStarted = true;
      // History ends right before the first live trade, so the two never overlap.
      void this.loadHistory(d.T, d.a);
    }
    this.emit({ ...parseAggTrade(d, this.contractUsd), id: d.a });
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
      const newest = await fetchPage(this.market, this.symbol, null, signal);
      const cached = (await cache).filter((t) => t.ts > sinceMs && t.ts < liveTs);
      const cachedLastId = cached.at(-1)?.id ?? -1;
      const firstId = newest[0]?.a ?? 0;
      const n = olderPages(newest, sinceMs, cachedLastId);
      const older = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          fetchPage(
            this.market,
            this.symbol,
            Math.max(0, firstId - (n - i) * HISTORY_PAGE_SIZE),
            signal,
          ),
        ),
      );
      const rows: CachedTrade[] = [];
      let prevId = cachedLastId;
      // Pages oldest first; pages clamped at id 0 overlap, and the newest may run into live ids.
      for (const r of [...older.flat(), ...newest]) {
        if (r.a <= prevId || r.a >= firstLiveId) continue;
        rows.push({ ...parseAggTrade(r, this.contractUsd), id: r.a });
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
  symbols: {
    symbol: string;
    contractType: string;
    /** USDⓈ-M listing state. */
    status?: string;
    /** COIN-M listing state. */
    contractStatus?: string;
    /** COIN-M contract face value, USD. */
    contractSize?: number;
  }[];
}

async function fetchExchangeInfo(
  market: BinanceMarket,
  signal?: AbortSignal,
): Promise<ExchangeInfo['symbols']> {
  const res = await fetch(`${ENDPOINTS[market].rest}/exchangeInfo`, { signal });
  if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
  return ((await res.json()) as ExchangeInfo).symbols;
}

/** USD face value of one `symbol` contract on COIN-M (100 for BTC, 10 for the rest as of 2026). */
async function fetchContractUsd(symbol: string, signal: AbortSignal): Promise<number> {
  const spec = (await fetchExchangeInfo('coinm', signal)).find((s) => s.symbol === symbol);
  if (!spec?.contractSize) throw new Error(`${symbol} is not a COIN-M contract`);
  return spec.contractSize;
}

/**
 * Tradable perpetual symbols of `market`, sorted. USDⓈ-M answers ~1 MB, so callers should cache.
 */
export async function fetchBinanceSymbols(
  market: BinanceMarket,
  signal?: AbortSignal,
): Promise<string[]> {
  const symbols = await fetchExchangeInfo(market, signal);
  return symbols
    .filter(
      (s) =>
        s.contractType === 'PERPETUAL' &&
        (market === 'usdm' ? s.status : s.contractStatus) === 'TRADING',
    )
    .map((s) => s.symbol)
    .sort();
}
