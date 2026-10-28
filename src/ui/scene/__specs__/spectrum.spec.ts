import { describe, expect, it } from 'vitest';
import { SIZE_CLASSES, SPECTRUM_BUCKET_MS, type SpectrumBucket } from '../../../metrics/history';
import { type SpectrumCells, spectrumCells } from '../spectrum';

const T0 = 1_700_000_000_000;
/** A bucket with volume in one size class. */
const bucket = (ts: number, k: number, buyUsd: number, sellUsd: number): SpectrumBucket => {
  const b: SpectrumBucket = {
    ts,
    buyUsd: new Array(SIZE_CLASSES).fill(0),
    sellUsd: new Array(SIZE_CLASSES).fill(0),
  };
  b.buyUsd[k] = buyUsd;
  b.sellUsd[k] = sellUsd;
  return b;
};
const cell = (c: SpectrumCells, col: number, k: number) => ({
  level: c.level[col * SIZE_CLASSES + k],
  buyShare: c.buyShare[col * SIZE_CLASSES + k],
});

describe('spectrumCells', () => {
  it('levels each size class against its own busiest column', () => {
    // Class 0 trades $1M a column, class 5 a single $2M trade: both peak at full level.
    const c = spectrumCells(
      [bucket(T0, 0, 1e6, 0), bucket(T0 + 10_000, 0, 1e6, 0), bucket(T0 + 10_000, 5, 2e6, 0)],
      T0,
      20_000,
      2,
    );
    expect(cell(c, 0, 0).level).toBe(1);
    expect(cell(c, 1, 0).level).toBe(1);
    expect(cell(c, 1, 5).level).toBe(1);
    expect(cell(c, 0, 5).level).toBe(0);
  });

  it('lifts quiet cells with a square root', () => {
    const c = spectrumCells([bucket(T0, 2, 25, 0), bucket(T0 + 10_000, 2, 100, 0)], T0, 20_000, 2);
    expect(cell(c, 0, 2).level).toBeCloseTo(0.5, 6);
  });

  it('sums the buckets of a column and tells the buy share', () => {
    const c = spectrumCells(
      [bucket(T0, 3, 300, 100), bucket(T0 + SPECTRUM_BUCKET_MS, 3, 0, 600)],
      T0,
      20_000,
      1,
    );
    expect(cell(c, 0, 3).level).toBe(1);
    expect(cell(c, 0, 3).buyShare).toBeCloseTo(0.3, 6);
    // No volume: neither side.
    expect(cell(c, 0, 4)).toEqual({ level: 0, buyShare: 0.5 });
  });

  it('skips buckets that ended before the view and keeps a straddling one', () => {
    const c = spectrumCells(
      [bucket(T0 - SPECTRUM_BUCKET_MS, 1, 999, 0), bucket(T0 - 1_000, 1, 10, 0)],
      T0,
      20_000,
      2,
    );
    expect(cell(c, 0, 1)).toEqual({ level: 1, buyShare: 1 });
  });
});
