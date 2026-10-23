import { describe, expect, it } from 'vitest';
import { clock, durationLabel, priceDecimals, splitPrice } from '../format';

describe('priceDecimals', () => {
  it('keeps about six significant digits across price scales', () => {
    expect(priceDecimals(81_298.4)).toBe(1);
    expect(priceDecimals(2_380.12)).toBe(2);
    expect(priceDecimals(0.5606)).toBe(6);
    expect(priceDecimals(0.00001234)).toBe(8);
    expect(priceDecimals(250_000)).toBe(0);
  });

  it('falls back for missing prices', () => {
    expect(priceDecimals(Number.NaN)).toBe(2);
    expect(priceDecimals(0)).toBe(2);
  });
});

describe('splitPrice', () => {
  it('keeps trailing zeros so the width is stable', () => {
    expect(splitPrice(81_298, 1)).toEqual({ int: '81,298', frac: '.0' });
    expect(splitPrice(0.56, 6)).toEqual({ int: '0', frac: '.560000' });
  });

  it('has no fraction at zero decimals', () => {
    expect(splitPrice(250_000.4, 0)).toEqual({ int: '250,000', frac: '' });
  });
});

describe('clock', () => {
  it('formats remaining seconds as m:ss, rounding up', () => {
    expect(clock(292.2)).toBe('4:53');
    expect(clock(9)).toBe('0:09');
    expect(clock(-3)).toBe('0:00');
  });
});

describe('durationLabel', () => {
  it('rounds down to the largest unit, so a partial period never reads as the full one', () => {
    expect(durationLabel(3_600_000)).toBe('1h');
    expect(durationLabel(3_599_000)).toBe('59m');
    expect(durationLabel(15 * 60_000)).toBe('15m');
    expect(durationLabel(59_999)).toBe('59s');
    expect(durationLabel(200)).toBe('1s');
  });
});
