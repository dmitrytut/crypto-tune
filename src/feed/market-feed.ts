/** Aggressor side of a market trade. */
export type TradeSide = 'buy' | 'sell';

/** Which side of the book got liquidated: a `long` liquidation is a forced SELL. */
export type LiquidationSide = 'long' | 'short';

export interface Trade {
  /** Exchange trade time, ms since epoch. */
  ts: number;
  price: number;
  /** Base-asset quantity. */
  qty: number;
  side: TradeSide;
}

export interface Liquidation {
  ts: number;
  price: number;
  qty: number;
  /** Quote notional (price × qty). */
  usd: number;
  side: LiquidationSide;
}

export type FeedStatus =
  | { state: 'idle' }
  | { state: 'connecting'; attempt: number }
  | { state: 'open' }
  | { state: 'reconnecting'; attempt: number; inMs: number; reason: string }
  | { state: 'closed' }
  | { state: 'error'; message: string };

export type Unsubscribe = () => void;

/**
 * Exchange-agnostic market data source. The Binance adapter and the simulator
 * implement this so metrics and audio never know the origin.
 * A source may first emit recent history (events with `ts` in the past) so
 * metrics start warm; trades always arrive in `ts` order, history before live.
 */
export interface MarketFeed {
  /** Human-readable source label, e.g. `Binance BTCUSDT`. */
  readonly label: string;
  connect(): void;
  disconnect(): void;
  /**
   * Source clock in ms; metrics close ticks up to this time. Contract: every
   * event with `ts` < now() has already been emitted. Generated sources
   * (simulator, replay) return their emitted horizon. Live adapters return
   * local time shifted by the observed (event time − receive time) offset,
   * which already lags by network latency; stragglers land in the next tick.
   */
  now(): number;
  onTrade(cb: (t: Trade) => void): Unsubscribe;
  onLiquidation(cb: (l: Liquidation) => void): Unsubscribe;
  onStatus(cb: (s: FeedStatus) => void): Unsubscribe;
}
