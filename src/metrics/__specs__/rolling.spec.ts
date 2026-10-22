import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../feed/simulator';
import { RollingStats } from '../rolling';

function naive(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

describe('RollingStats', () => {
  it('matches naive mean/std while filling and after eviction', () => {
    const rand = mulberry32(1);
    const cap = 50;
    const rs = new RollingStats(cap);
    const all: number[] = [];
    for (let i = 0; i < 237; i++) {
      const x = rand() * 10 - 5;
      all.push(x);
      rs.push(x);
      const ref = naive(all.slice(-cap));
      expect(rs.count).toBe(Math.min(all.length, cap));
      expect(rs.mean).toBeCloseTo(ref.mean, 10);
      expect(rs.std).toBeCloseTo(ref.std, 10);
    }
  });

  it('forgets samples older than the window', () => {
    const rs = new RollingStats(3);
    for (const x of [1000, 1000, 1000, 1, 2, 3]) rs.push(x);
    expect(rs.mean).toBeCloseTo(2, 12);
    expect(rs.std).toBeCloseTo(Math.sqrt(2 / 3), 12);
  });

  it('stays accurate for small variance on a large offset over many windows', () => {
    // Per-second quote volume: large level, comparatively tiny spread.
    const rand = mulberry32(7);
    const cap = 100;
    const rs = new RollingStats(cap);
    const all: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const x = 1e9 + rand();
      all.push(x);
      rs.push(x);
    }
    const ref = naive(all.slice(-cap));
    expect(rs.std).toBeCloseTo(ref.std, 6);
  });

  it('reports zero std for a constant series and after clear', () => {
    const rs = new RollingStats(4);
    for (let i = 0; i < 10; i++) rs.push(5);
    expect(rs.std).toBe(0);
    rs.clear();
    expect(rs.count).toBe(0);
    rs.push(2);
    expect(rs.mean).toBe(2);
    expect(rs.std).toBe(0);
  });
});
