import { describe, expect, it } from 'vitest';
import { FlowMeter } from '../flow';

const T0 = 1_700_000_000_000;

/** Steady trading: one buy and one sell per 100 ms for `ms`, starting at `from`. */
function steady(m: FlowMeter, from: number, ms: number, buyUsd = 1_000, sellUsd = 1_000) {
  for (let t = from; t < from + ms; t += 100) {
    m.add('buy', buyUsd, t);
    m.add('sell', sellUsd, t + 50);
  }
}

describe('FlowMeter', () => {
  it('reads quiet before any trade', () => {
    expect(new FlowMeter().read(T0)).toEqual({ imbalance: 0, activity: 0 });
  });

  it('reports usual activity, not a burst, from the very first seconds', () => {
    const m = new FlowMeter();
    steady(m, T0, 3_000);
    const a = m.read(T0 + 3_000).activity;
    expect(a).toBeGreaterThan(0.2);
    expect(a).toBeLessThan(0.5);
  });

  it('tilts toward the aggressor side within seconds', () => {
    const m = new FlowMeter();
    steady(m, T0, 60_000);
    expect(Math.abs(m.read(T0 + 60_000).imbalance)).toBeLessThan(0.05);
    steady(m, T0 + 60_000, 4_000, 5_000, 500);
    expect(m.read(T0 + 64_000).imbalance).toBeGreaterThan(0.5);
    steady(m, T0 + 64_000, 8_000, 500, 5_000);
    expect(m.read(T0 + 72_000).imbalance).toBeLessThan(-0.5);
  });

  it('rises toward 1 in a burst and falls toward 0 when trading dries up', () => {
    const m = new FlowMeter();
    steady(m, T0, 120_000);
    const usual = m.read(T0 + 120_000).activity;
    steady(m, T0 + 120_000, 5_000, 10_000, 10_000);
    const burst = m.read(T0 + 125_000).activity;
    expect(burst).toBeGreaterThan(usual);
    expect(burst).toBeGreaterThan(0.8);
    expect(m.read(T0 + 145_000).activity).toBeLessThan(0.1);
  });
});
