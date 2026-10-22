import { describe, expect, it } from 'vitest';
import { arpDegree, MAX_REGISTER_SHIFT, stickyShift } from '../arp-pattern';

describe('arpDegree', () => {
  it('cycles the pattern and transposes it by the register shift', () => {
    const base = Array.from({ length: 8 }, (_, i) => arpDegree(i, 0));
    expect(Array.from({ length: 8 }, (_, i) => arpDegree(i + 8, 0))).toEqual(base);
    expect(Array.from({ length: 8 }, (_, i) => arpDegree(i, 2))).toEqual(base.map((d) => d + 2));
  });
});

describe('stickyShift', () => {
  it('moves up when the price is clearly above its EMA and down when below', () => {
    expect(stickyShift(0, 1.9)).toBe(2);
    expect(stickyShift(0, -1.2)).toBe(-1);
  });

  it('ignores wobble around a rounding boundary', () => {
    let shift = 0;
    for (const z of [0.5, 0.7, 0.55, 0.74, 0.6]) shift = stickyShift(shift, z);
    expect(shift).toBe(0);
    shift = stickyShift(shift, 0.76);
    expect(shift).toBe(1);
    for (const z of [0.3, 0.5, 0.26]) shift = stickyShift(shift, z);
    expect(shift).toBe(1);
  });

  it('never exceeds the register limit', () => {
    expect(stickyShift(0, 40)).toBe(MAX_REGISTER_SHIFT);
    expect(stickyShift(0, -40)).toBe(-MAX_REGISTER_SHIFT);
  });
});
