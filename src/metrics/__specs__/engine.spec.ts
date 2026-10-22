import { describe, expect, it } from 'vitest';
import type { Trade } from '../../feed/market-feed';
import { DEFAULT_METRICS_CONFIG, MetricsEngine, type MetricsSnapshot, TICK_MS } from '../engine';

const T0 = 1_700_000_000_000;
const CFG = { ...DEFAULT_METRICS_CONFIG, windowSec: 2, statsWindowMin: 2, warmupMin: 1 };
/** Ticks until ready: lag (2 s) + warm-up (1 min). */
const READY_TICK = (2 + 60) * (1000 / TICK_MS);

/** One trade per tick with a small deterministic wiggle around `base`. */
function feedCalm(e: MetricsEngine, fromTick: number, toTick: number, base = 100): void {
  for (let i = fromTick; i < toTick; i++) {
    const wiggle = ((i * 7919) % 11) - 5;
    e.addTrade({ ts: T0 + i * TICK_MS + 10, price: base + wiggle * 0.01, qty: 1, side: 'buy' });
  }
}

function runTo(e: MetricsEngine, tick: number): MetricsSnapshot {
  const s = e.advanceTo(T0 + tick * TICK_MS);
  if (!s) throw new Error('no snapshot');
  return s;
}

describe('MetricsEngine', () => {
  it('returns null before the first trade', () => {
    expect(new MetricsEngine(CFG).advanceTo(T0)).toBeNull();
  });

  it('holds tension at zero until N window and warm-up are filled', () => {
    const e = new MetricsEngine(CFG);
    feedCalm(e, 0, READY_TICK + 40);
    const before = runTo(e, READY_TICK);
    expect(before.ready).toBe(false);
    expect(before.tension).toBe(0);
    expect(before.warmup).toBeLessThan(1);
    const after = runTo(e, READY_TICK + 1);
    expect(after.ready).toBe(true);
    expect(after.warmup).toBe(1);
  });

  it('drives tension up with direction on a sharp move', () => {
    for (const sign of [1, -1]) {
      const e = new MetricsEngine(CFG);
      feedCalm(e, 0, READY_TICK + 40);
      const calm = runTo(e, READY_TICK + 40);
      expect(calm.tension).toBeLessThan(2.5);
      feedCalm(e, READY_TICK + 40, READY_TICK + 48, 100 * (1 + sign * 0.01));
      const hot = runTo(e, READY_TICK + 48);
      expect(hot.tension).toBeGreaterThan(5);
      expect(Math.sign(hot.direction)).toBe(sign);
    }
  });

  it('reports price above/below its hour EMA as positive/negative emaZ, 0 before ready', () => {
    for (const sign of [1, -1]) {
      const e = new MetricsEngine(CFG);
      feedCalm(e, 0, READY_TICK + 40);
      expect(runTo(e, READY_TICK - 1).emaZ).toBe(0);
      runTo(e, READY_TICK + 40);
      feedCalm(e, READY_TICK + 40, READY_TICK + 80, 100 * (1 + sign * 0.002));
      const s = runTo(e, READY_TICK + 80);
      expect(Math.sign(s.emaZ)).toBe(sign);
      expect(Math.abs(s.emaZ)).toBeGreaterThan(2);
    }
  });

  it('carries the last price through ticks without trades', () => {
    const e = new MetricsEngine(CFG);
    e.addTrade({ ts: T0 + 5, price: 123, qty: 1, side: 'sell' });
    const s = runTo(e, 20);
    expect(s.price).toBe(123);
    expect(s.volPerSec).toBe(0);
  });

  it('counts a late trade in the next tick instead of dropping it', () => {
    const e = new MetricsEngine(CFG);
    e.addTrade({ ts: T0, price: 100, qty: 1, side: 'buy' });
    runTo(e, 2);
    const late: Trade = { ts: T0 + 100, price: 101, qty: 2, side: 'buy' };
    e.addTrade(late);
    const s = runTo(e, 3);
    expect(s.price).toBe(101);
    expect(s.volPerSec).toBeCloseTo(100 + 202, 9);
  });

  it('does not score the price move across a data gap as a move within window N', () => {
    const run = (resyncOnGap: boolean) => {
      const e = new MetricsEngine(CFG);
      const calmEnd = READY_TICK + 40;
      feedCalm(e, 0, calmEnd);
      runTo(e, calmEnd);
      if (resyncOnGap) e.resync();
      const resume = calmEnd + 45 * (1000 / TICK_MS);
      // While disconnected nothing is ticked, so the gap never enters the statistics.
      if (resyncOnGap) expect(e.advanceTo(T0 + resume * TICK_MS)).toBeNull();
      // Market moved 0.5% while we were offline.
      feedCalm(e, resume, resume + 40, 100.5);
      let peak = 0;
      let last: MetricsSnapshot | null = null;
      for (let t = resume + 1; t <= resume + 40; t++) {
        last = runTo(e, t);
        peak = Math.max(peak, last.tension);
      }
      return { peak, last: last as MetricsSnapshot };
    };

    expect(run(false).peak).toBeGreaterThan(5);
    const fixed = run(true);
    // Same "calm" bound as the impulse spec: the wiggle alone keeps tension ~1.5.
    expect(fixed.peak).toBeLessThan(2.5);
    expect(fixed.last.ready).toBe(true);
  });
});
