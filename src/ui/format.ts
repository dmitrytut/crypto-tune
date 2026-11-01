import type { HistorySeries } from '../metrics/history';

/**
 * Fraction digits that keep about six significant digits (BTC 81,298.4,
 * ETH 2,380.12, 0.560600). Chosen once per pair so the readout width never
 * jumps when a price ends in zero or crosses a power of ten.
 * @package
 */
export function priceDecimals(price: number): number {
  if (!(price > 0)) return 2;
  const intDigits = Math.floor(Math.log10(price)) + 1;
  return Math.min(8, Math.max(0, 6 - intDigits));
}

/**
 * Price split for display: grouped integer part and the fraction including its point.
 * @package
 */
export function splitPrice(price: number, decimals: number): { int: string; frac: string } {
  const text = price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const dot = text.indexOf('.');
  return dot < 0 ? { int: text, frac: '' } : { int: text.slice(0, dot), frac: text.slice(dot) };
}

/**
 * m:ss for countdowns.
 * @package
 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Short span label rounded down to its largest unit: 1h, 15m, 7m, 40s.
 * @package
 */
export function durationLabel(ms: number): string {
  if (ms >= 3_600_000) return `${Math.floor(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

/**
 * Compact USD to three significant digits, e.g. $221K, $5.5M, $1.23M.
 * @package
 */
export const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumSignificantDigits: 3,
});

/**
 * One wording for a cued event, in the readout and on the chart: `SELL $221K`,
 * `LIQ LONG $1.2M`.
 * @package
 */
export function eventLabel(kind: 'trade' | 'liquidation', side: string, usd: number): string {
  return `${kind === 'liquidation' ? 'LIQ ' : ''}${side.toUpperCase()} ${usdFmt.format(usd)}`;
}

/**
 * A tick's cue as the readout shows it: the event, and how many merged into it (`SELL $5.3M ×2`).
 * @package
 */
export function cueLabel(
  kind: 'trade' | 'liquidation',
  cue: { side: string; usd: number; count: number },
): string {
  return `${eventLabel(kind, cue.side, cue.usd)}${cue.count > 1 ? ` ×${cue.count}` : ''}`;
}

/**
 * Change of `price` at `ts` over `periodMs`, or over all the history there is while it is
 * shorter; within ±0.005 % it reads as flat. Null without history or a price.
 * @package
 */
export function priceChange(
  h: HistorySeries,
  ts: number,
  price: number,
  periodMs: number,
): { pct: number; spanMs: number } | null {
  const first = h.prices[0];
  if (!first || Number.isNaN(price)) return null;
  const spanMs = Math.min(periodMs, ts - first.ts);
  const pct = (price / h.priceAt(ts - spanMs) - 1) * 100;
  return { pct: Math.abs(pct) < 0.005 ? 0 : pct, spanMs };
}

/**
 * `▲ 0.42% in 15m`; flat has no arrow.
 * @package
 */
export function changeLabel(c: { pct: number; spanMs: number }): string {
  const arrow = c.pct > 0 ? '▲ ' : c.pct < 0 ? '▼ ' : '';
  return `${arrow}${Math.abs(c.pct).toFixed(2)}% in ${durationLabel(c.spanMs)}`;
}
