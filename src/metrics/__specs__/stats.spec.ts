import { describe, expect, it } from 'vitest';
import { asymSmooth, type Ewm, ewmAlpha, ewmStep, zScore } from '../stats';

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

describe('ewmStep', () => {
  it('seeds with the first sample and zero variance', () => {
    expect(ewmStep(null, 5, 0.1)).toEqual({ mean: 5, variance: 0 });
  });

  it('reaches 1 − 1/e of a level step after one time constant', () => {
    const alpha = ewmAlpha(250, 60_000);
    let s: Ewm = ewmStep(null, 0, alpha);
    for (let i = 0; i < 60_000 / 250; i++) s = ewmStep(s, 1, alpha);
    expect(s.mean).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('estimates the variance of a stationary series', () => {
    // Alternating ±1: mean 0, variance 1.
    let s: Ewm | null = null;
    for (let i = 0; i < 5_000; i++) s = ewmStep(s, i % 2 ? 1 : -1, 0.01);
    expect(s?.mean ?? Number.NaN).toBeCloseTo(0, 1);
    expect(s?.variance ?? Number.NaN).toBeCloseTo(1, 1);
  });
});
