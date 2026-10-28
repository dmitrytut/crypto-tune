import { describe, expect, it } from 'vitest';
import { tradeLegend } from '../legend';
import { bubbleStart } from '../spawn';

const caps = (bigUsd: number) => tradeLegend(bigUsd).map((m) => m.caption);
const bigs = (bigUsd: number) => tradeLegend(bigUsd).map((m) => m.big);

describe('tradeLegend', () => {
  it('steps the scale a decade at a time with open ends, slotting the threshold in between', () => {
    expect(caps(200_000)).toEqual(['≤ $1K', '$10K', '$100K', '$200K', '≥ $1M']);
    expect(bigs(200_000)).toEqual([false, false, false, true, true]);
  });

  it('adds no column for a threshold on a step', () => {
    expect(caps(100_000)).toEqual(['≤ $1K', '$10K', '$100K', '≥ $1M']);
    expect(bigs(100_000)).toEqual([false, false, true, true]);
  });

  it('closes the scale with the threshold when it is beyond the largest step', () => {
    expect(caps(5_000_000)).toEqual(['≤ $1K', '$10K', '$100K', '$1M', '≥ $5M']);
    expect(bigs(5_000_000)).toEqual([false, false, false, false, true]);
  });

  it('draws each mark at the size the scene gives such a trade', () => {
    for (const m of tradeLegend(200_000)) {
      expect(m.r).toBe(bubbleStart('buy', m.usd, m.big, 1200, 800, () => 0.5).r);
    }
  });
});
