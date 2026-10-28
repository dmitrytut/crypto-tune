import { describe, expect, it } from 'vitest';
import { popDroplets, popHeight } from '../pop';

const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

describe('popHeight', () => {
  it('pops in the upper part of the screen, above where bubbles are born', () => {
    const H = 800;
    expect(popHeight(H, () => 0)).toBeCloseTo(0.08 * H, 9);
    expect(popHeight(H, () => 0.999_999)).toBeCloseTo(0.35 * H, 3);
    // bubbleStart puts buys at 62 % of the height or lower.
    expect(popHeight(H, () => 0.999_999)).toBeLessThan(0.62 * H);
  });
});

describe('popDroplets', () => {
  it('scales droplets with the bubble area: three for the smallest, many for the biggest', () => {
    expect(popDroplets(4.5, seeded(1))).toHaveLength(3);
    const mid = popDroplets(12, seeded(2)).length;
    const twice = popDroplets(24, seeded(3)).length;
    // Twice the radius, about four times the droplets.
    expect(twice / mid).toBeGreaterThan(3.5);
    expect(popDroplets(500, seeded(4))).toHaveLength(28);
  });

  it('throws droplets all round the bubble, not in one direction', () => {
    const ds = popDroplets(20, seeded(4));
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      expect(ds.some((d) => Math.sign(d.vx) === sx && Math.sign(d.vy) === sy)).toBe(true);
    }
  });
});
