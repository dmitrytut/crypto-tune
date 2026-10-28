import { describe, expect, it } from 'vitest';
import { lineColumns, smoothLine } from '../surface';

describe('lineColumns', () => {
  it('gives the line height at every pixel column between its points', () => {
    const cols = lineColumns([0, 10, 20], [50, 30, 30], 21);
    expect(cols[0]).toBe(50);
    expect(cols[5]).toBeCloseTo(40, 4);
    expect(cols[10]).toBe(30);
    expect(cols[15]).toBe(30);
    expect(cols[20]).toBe(30);
  });

  it('leaves columns outside the line empty (NaN)', () => {
    const cols = lineColumns([4.5, 8.2], [10, 20], 12);
    expect(cols[4]).toBeNaN();
    expect(cols[5]).toBeCloseTo(10 + (0.5 / 3.7) * 10, 4);
    expect(cols[8]).toBeCloseTo(10 + (3.5 / 3.7) * 10, 4);
    expect(cols[9]).toBeNaN();
  });

  it('reuses the buffer it is given when the width matches', () => {
    const buf = new Float32Array(12);
    expect(lineColumns([0, 11], [1, 1], 12, buf)).toBe(buf);
    expect(lineColumns([0, 11], [1, 1], 13, buf)).not.toBe(buf);
  });
});

describe('smoothLine', () => {
  /** Height of the sampled line at `x`, linear between samples. */
  const at = (line: { xs: number[]; ys: number[] }, x: number) =>
    lineColumns(line.xs, line.ys, Math.ceil(x) + 1)[Math.round(x)];
  /** One point per px: `runs` of [length, height]. */
  const steps = (runs: [number, number][]) => {
    const ys = runs.flatMap(([len, y]) => new Array(len).fill(y));
    return { xs: ys.map((_, i) => i), ys };
  };

  it('keeps both ends of the line', () => {
    const s = steps([
      [3, 10],
      [3, 20],
      [3, 15],
    ]);
    const line = smoothLine(s.xs, s.ys);
    expect([line.xs[0], line.ys[0]]).toEqual([0, 10]);
    expect([line.xs.at(-1), line.ys.at(-1)]).toEqual([8, 15]);
  });

  it('turns a staircase of short runs into a slope', () => {
    // Runs of 4 px: the polyline jumps 10 → 20 between x = 3 and 4; the smooth line climbs.
    const s = steps([
      [4, 10],
      [4, 20],
      [4, 30],
      [4, 40],
    ]);
    const line = smoothLine(s.xs, s.ys);
    expect((at(line, 4) as number) - (at(line, 3) as number)).toBeLessThan(4);
    expect(at(line, 3)).toBeGreaterThan(10);
    expect(at(line, 4)).toBeLessThan(20);
  });

  it('leaves a long flat run flat', () => {
    const s = steps([
      [30, 10],
      [30, 50],
    ]);
    const line = smoothLine(s.xs, s.ys);
    for (const x of [0, 10, 29]) expect(at(line, x)).toBe(10);
    for (const x of [30, 45, 59]) expect(at(line, x)).toBe(50);
  });

  it('never goes past the real highs and lows', () => {
    // Jagged short runs with a one-point spike: no sample beyond the extremes.
    const s = steps([
      [2, 10],
      [3, 40],
      [1, 0],
      [2, 35],
      [3, 12],
      [2, 25],
      [1, 50],
      [3, 20],
    ]);
    const line = smoothLine(s.xs, s.ys);
    expect(Math.min(...line.ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...line.ys)).toBeLessThanOrEqual(50);
  });

  it('has nothing to join for a single point', () => {
    expect(smoothLine([5], [7])).toEqual({ xs: [5], ys: [7] });
    expect(smoothLine([], [])).toEqual({ xs: [], ys: [] });
  });
});
