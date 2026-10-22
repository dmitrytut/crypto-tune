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
 * Exchange-agnostic market data source. Adapters (Binance, MEXC), replay and
 * simulator all implement this so metrics and audio never know the origin.
 */
export interface MarketFeed {
  /** Human-readable source label, e.g. `Binance BTCUSDT`. */
  readonly label: string;
  connect(): void;
  disconnect(): void;
  /**
   * Source clock in ms. Live adapters return local time corrected to exchange
   * time; replay returns virtual playback time. Metrics tick on this clock.
   */
  now(): number;
  onTrade(cb: (t: Trade) => void): Unsubscribe;
  onLiquidation(cb: (l: Liquidation) => void): Unsubscribe;
  onStatus(cb: (s: FeedStatus) => void): Unsubscribe;
}
