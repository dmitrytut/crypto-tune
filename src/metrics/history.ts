import type { LiquidationSide, Trade, TradeSide } from '../feed/market-feed';

/** Periods the change, volume and chart can cover, minutes; the user picks one in settings. */
export const HISTORY_PERIODS_MIN = [1, 5, 15, 60] as const;
export type HistoryPeriodMin = (typeof HISTORY_PERIODS_MIN)[number];
/** How much history is kept: the longest period. */
export const HISTORY_WINDOW_MS = Math.max(...HISTORY_PERIODS_MIN) * 60_000;
/** One price point per second: 3600 points over an hour. */
const PRICE_STEP_MS = 1_000;
/** Volume bars of 10 s: 360 bars over an hour. */
export const VOLUME_BUCKET_MS = 10_000;
/** Trade-size spectrum columns of 2 s: 1800 over an hour, enough for a 1 min period. */
export const SPECTRUM_BUCKET_MS = 2_000;
/** Trade size classes, a decade of notional each: <$100, $100–1K, …, $100K–1M, ≥$1M. */
export const SIZE_CLASSES = 6;

export interface PricePoint {
  /** Start of the second, source-clock ms. */
  ts: number;
  price: number;
  tension: number;
}

export interface VolumeBucket {
  /** Start of the bucket, source-clock ms. */
  ts: number;
  buyUsd: number;
  sellUsd: number;
}

/** Aggressor volume of one SPECTRUM_BUCKET_MS by trade size class, smallest class first. */
export interface SpectrumBucket {
  /** Start of the bucket, source-clock ms. */
  ts: number;
  buyUsd: number[];
  sellUsd: number[];
}

export type EventMarker =
  | { ts: number; kind: 'liquidation'; side: LiquidationSide; usd: number }
  | { ts: number; kind: 'trade'; side: TradeSide; usd: number };

/** Read side of the history, what the chart draws. Arrays are oldest → newest. */
export interface HistorySeries {
  readonly prices: readonly PricePoint[];
  readonly volumes: readonly VolumeBucket[];
  readonly spectrum: readonly SpectrumBucket[];
  readonly markers: readonly EventMarker[];
  /** Price of the point nearest to `ts`, or NaN with no points. */
  priceAt(ts: number): number;
  /**
   * Buy + sell USD in the volume buckets that start at or after `ts`. Buckets are
   * VOLUME_BUCKET_MS wide, so the span is rounded to whole buckets.
   */
  volumeUsdSince(ts: number): number;
}

/**
 * Rolling series behind the chart and readouts, HISTORY_WINDOW_MS long: price and tension per second (last
 * value in the second wins), aggressor volume per 10 s and by trade size per 2 s, and event
 * markers. Everything older than the window behind the newest timestamp is pruned.
 */
export class MarketHistory implements HistorySeries {
  readonly prices: PricePoint[] = [];
  readonly volumes: VolumeBucket[] = [];
  readonly spectrum: SpectrumBucket[] = [];
  readonly markers: EventMarker[] = [];

  addTrade(t: Trade): void {
    const usd = t.price * t.qty;
    const v = newestBucket(this.volumes, t.ts, VOLUME_BUCKET_MS, (ts) => ({
      ts,
      buyUsd: 0,
      sellUsd: 0,
    }));
    if (t.side === 'buy') v.buyUsd += usd;
    else v.sellUsd += usd;
    const s = newestBucket(this.spectrum, t.ts, SPECTRUM_BUCKET_MS, (ts) => ({
      ts,
      buyUsd: new Array<number>(SIZE_CLASSES).fill(0),
      sellUsd: new Array<number>(SIZE_CLASSES).fill(0),
    }));
    const side = t.side === 'buy' ? s.buyUsd : s.sellUsd;
    const c = Math.min(SIZE_CLASSES - 1, Math.max(0, Math.floor(Math.log10(usd)) - 1));
    side[c] = (side[c] as number) + usd;
  }

  addSnapshot(s: { ts: number; price: number; tension: number }): void {
    if (Number.isNaN(s.price)) return;
    const ts = Math.floor(s.ts / PRICE_STEP_MS) * PRICE_STEP_MS;
    const last = this.prices.at(-1);
    if (last && last.ts === ts) {
      last.price = s.price;
      last.tension = s.tension;
    } else if (!last || ts > last.ts) {
      this.prices.push({ ts, price: s.price, tension: s.tension });
      prune(this.prices, ts);
      prune(this.markers, ts);
    }
  }

  addMarker(m: EventMarker): void {
    this.markers.push(m);
  }

  priceAt(ts: number): number {
    const p = this.prices;
    if (p.length === 0) return Number.NaN;
    let lo = 0;
    let hi = p.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((p[mid] as PricePoint).ts < ts) lo = mid + 1;
      else hi = mid;
    }
    const after = p[lo] as PricePoint;
    const before = p[lo - 1];
    return before && ts - before.ts < after.ts - ts ? before.price : after.price;
  }

  volumeUsdSince(ts: number): number {
    let usd = 0;
    // Newest first: stop at the first bucket before `ts`.
    for (let i = this.volumes.length - 1; i >= 0; i--) {
      const b = this.volumes[i] as VolumeBucket;
      if (b.ts < ts) break;
      usd += b.buyUsd + b.sellUsd;
    }
    return usd;
  }
}

/** Drops leading entries older than the window behind `newest`. */
function prune(arr: { ts: number }[], newest: number): void {
  const cutoff = newest - HISTORY_WINDOW_MS;
  let n = 0;
  while (n < arr.length && (arr[n] as { ts: number }).ts < cutoff) n++;
  if (n > 0) arr.splice(0, n);
}

/**
 * The bucket of `arr` a trade at `ts` goes into, created when it starts a new one. A late trade
 * for an older bucket is folded into the newest one; buckets are never reordered.
 */
function newestBucket<B extends { ts: number }>(
  arr: B[],
  ts: number,
  widthMs: number,
  make: (ts: number) => B,
): B {
  const start = Math.floor(ts / widthMs) * widthMs;
  const last = arr.at(-1);
  if (last && start <= last.ts) return last;
  const b = make(start);
  arr.push(b);
  prune(arr, start);
  return b;
}
