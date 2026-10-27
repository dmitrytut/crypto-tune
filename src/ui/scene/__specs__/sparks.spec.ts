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
  it('scales sparks with the drop area: a couple for the smallest, many for the biggest', () => {
    expect(floorSparks(4.5, seeded(1))).toHaveLength(2);
    const mid = floorSparks(12, seeded(2)).length;
    const twice = floorSparks(24, seeded(3)).length;
    // Twice the radius, about four times the sparks.
    expect(twice / mid).toBeGreaterThan(3.5);
    expect(floorSparks(500, seeded(4))).toHaveLength(28);
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
