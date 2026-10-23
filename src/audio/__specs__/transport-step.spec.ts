import { describe, expect, it } from 'vitest';
import { stepIndex } from '../transport-step';

describe('stepIndex', () => {
  it('wraps around the step count', () => {
    expect(stepIndex(96, 24, 4)).toBe(0);
    expect(stepIndex(120, 24, 4)).toBe(1);
  });

  it('rounds a tick off the exact grid to the nearest step', () => {
    expect(stepIndex(23.6, 24, 4)).toBe(1);
    expect(stepIndex(0.4, 24, 4)).toBe(0);
  });
});
