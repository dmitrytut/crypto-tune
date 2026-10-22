import { describe, expect, it } from 'vitest';
import { asymSmooth, zScore } from '../stats';

describe('zScore', () => {
  it('standardizes against mean and std', () => {
    expect(zScore(13, 10, 2)).toBe(1.5);
    expect(zScore(7, 10, 2)).toBe(-1.5);
  });

  it('returns 0 for a flat series instead of infinity', () => {
    expect(zScore(5, 1, 0)).toBe(0);
  });
});

describe('asymSmooth', () => {
  it('uses attack when rising and release when falling', () => {
    expect(asymSmooth(0, 10, 0.4, 0.03)).toBeCloseTo(4, 12);
    expect(asymSmooth(10, 0, 0.4, 0.03)).toBeCloseTo(9.7, 12);
  });

  it('rises much faster than it decays', () => {
    let up = 0;
    let ticksUp = 0;
    while (up < 0.9) {
      up = asymSmooth(up, 1, 0.4, 0.03);
      ticksUp++;
    }
    let down = 1;
    let ticksDown = 0;
    while (down > 0.1) {
      down = asymSmooth(down, 0, 0.4, 0.03);
      ticksDown++;
    }
    // 90% rise: ceil(ln 0.1 / ln 0.6) = 5 ticks; 90% fall: ceil(ln 0.1 / ln 0.97) = 76 ticks.
    expect(ticksUp).toBe(5);
    expect(ticksDown).toBe(76);
  });

  it('holds steady at the target', () => {
    expect(asymSmooth(3, 3, 0.4, 0.03)).toBe(3);
  });
});
