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
export function parseAggTrade(d: AggTradeMsg): Trade {
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
