import { Emitter } from './emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade, Unsubscribe } from './market-feed';
import { ReconnectingSocket } from './reconnecting-socket';

/**
 * USDⓈ-M Futures routed endpoint. Legacy `wss://fstream.binance.com/ws/...`
 * was decommissioned on 2026-04-23; aggTrade/forceOrder/markPrice live under /market.
 */
const WS_BASE = 'wss://fstream.binance.com/market/stream';
const REST_BASE = 'https://fapi.binance.com';

interface AggTradeMsg {
  e: 'aggTrade';
  E: number;
  T: number;
  p: string;
  q: string;
  /** Buyer is the maker → the aggressor sold. */
  m: boolean;
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
export function parseAggTrade(d: Pick<AggTradeMsg, 'T' | 'p' | 'q' | 'm'>): Trade {
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

export class BinanceFuturesFeed implements MarketFeed {
  readonly label: string;
  private readonly trades = new Emitter<Trade>();
  private readonly liquidations = new Emitter<Liquidation>();
  private readonly status = new Emitter<FeedStatus>();
  private readonly socket: ReconnectingSocket;
  /** Smoothed (exchange event time − local time), ms. */
  private clockOffset = 0;
  private clockSynced = false;

  constructor(symbol: string) {
    const sym = symbol.toUpperCase();
    this.label = `Binance ${sym}`;
    this.socket = new ReconnectingSocket(
      binanceStreamUrl(sym),
      (raw) => this.handle(raw),
      (s) => this.status.emit(s),
    );
  }

  connect(): void {
    this.socket.start();
  }

  disconnect(): void {
    this.socket.stop();
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
    if (d.e === 'aggTrade') this.trades.emit(parseAggTrade(d as AggTradeMsg));
    else if (d.e === 'forceOrder') this.liquidations.emit(parseForceOrder(d as ForceOrderMsg));
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

/** REST aggregate trade; same fields as the stream message plus its id. */
interface RestAggTrade extends Pick<AggTradeMsg, 'T' | 'p' | 'q' | 'm'> {
  /** Aggregate trade id, consecutive per symbol. */
  a: number;
}

const AGG_PAGE = 1_000;
/**
 * Weight 20 per page against a 2400/min IP budget: 30 pages (600) leaves room
 * for reloads and the symbol list. 30k trades covers several busy minutes.
 */
const MAX_HISTORY_PAGES = 30;

/**
 * Aggregate trades from `sinceTs` (inclusive) to now, oldest first. The first
 * page is located by time, the rest follow by id (Binance advises against
 * mixing the two). Stops at the newest trade or after MAX_HISTORY_PAGES —
 * a truncated history is still a head start, the live stream fills the rest.
 */
export async function fetchBinanceTradesSince(
  symbol: string,
  sinceTs: number,
  signal?: AbortSignal,
): Promise<Trade[]> {
  const base = `${REST_BASE}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol.toUpperCase())}&limit=${AGG_PAGE}`;
  const out: Trade[] = [];
  let query = `&startTime=${Math.floor(sinceTs)}`;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const res = await fetch(base + query, { signal });
    if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
    const rows = (await res.json()) as RestAggTrade[];
    for (const r of rows) out.push(parseAggTrade(r));
    const last = rows.at(-1);
    if (!last || rows.length < AGG_PAGE) break;
    query = `&fromId=${last.a + 1}`;
  }
  return out;
}
