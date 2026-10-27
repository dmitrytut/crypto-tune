import { describe, expect, it } from 'vitest';
import { DOWN_COLOR } from '../../palette';
import { floorSparks, SPARK_ASH, sparkColor } from '../sparks';

const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

describe('floorSparks', () => {
  it('breaks bigger drops into more sparks, up to a cap', () => {
    const small = floorSparks(4.5, seeded(1)).length;
    const big = floorSparks(30, seeded(2)).length;
    expect(small).toBeGreaterThanOrEqual(4);
    expect(big).toBeGreaterThan(small);
    expect(floorSparks(500, seeded(3))).toHaveLength(14);
  });

  it('throws every spark up off the floor, to both sides', () => {
    const rand = seeded(4);
    const all = Array.from({ length: 20 }, () => floorSparks(15, rand)).flat();
    for (const s of all) expect(s.vy).toBeLessThan(0);
    expect(all.some((s) => s.vx < 0)).toBe(true);
    expect(all.some((s) => s.vx > 0)).toBe(true);
  });
});

describe('sparkColor', () => {
  it('cools from near-white through the sell colour to ash', () => {
    const hot = sparkColor(0);
    expect(Math.min(...hot)).toBeGreaterThan(0.8);
    for (const [i, v] of sparkColor(0.3).entries())
      expect(v).toBeCloseTo(DOWN_COLOR[i] as number, 9);
    for (const [i, v] of sparkColor(1).entries()) expect(v).toBeCloseTo(SPARK_ASH[i] as number, 9);
  });
});
