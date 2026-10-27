import { describe, expect, it } from 'vitest';
import { lineColumns } from '../surface';

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
