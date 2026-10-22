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
 * Compact USD, e.g. $766.3K.
 * @package
 */
export const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Compact plain number, e.g. 12.4K (base-asset volume).
 * @package
 */
export const volFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
