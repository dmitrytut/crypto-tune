import { describe, expect, it } from 'vitest';
import { TENSION_LEVELS } from '../../metrics/tension';
import { INITIAL_SHOCK, type ShockState, stepShock, tensionMix } from '../tension-map';

const { mid, high } = TENSION_LEVELS;

describe('tensionMix', () => {
  it('leaves only the base layer below the mid threshold', () => {
    for (const t of [0, 0.5, mid]) {
      const m = tensionMix(t, 1, false);
      expect(m).toMatchObject({
        intensity: 0,
        peak: 0,
        bpm: 60,
        doubleTime: false,
        contour: 'calm',
        registerBias: 0,
        subLevel: 0,
        percLevel: 0,
        riserLevel: 0,
        vibratoDepth: 0,
        droneFlatCents: 0,
      });
      expect(m.arpCutoffHz).toBeCloseTo(1000, 9);
    }
  });

  it('opens filter, raises tempo and brings in sub then percussion between mid and high', () => {
    const at = (t: number) => tensionMix(t, 0, false);
    const a = at(1.3);
    const b = at(2.2);
    expect(b.bpm).toBeGreaterThan(a.bpm);
    expect(b.arpCutoffHz).toBeGreaterThan(a.arpCutoffHz);
    expect(b.subLevel).toBeGreaterThan(a.subLevel);
    expect(b.percLevel).toBeGreaterThan(a.percLevel);
    // Percussion trails the sub.
    expect(a.subLevel).toBeGreaterThan(a.percLevel);
    expect(at(high)).toMatchObject({ bpm: 90, subLevel: 1, percLevel: 1, riserLevel: 0 });
    expect(at(high).arpCutoffHz).toBeCloseTo(6000, 6);
  });

  it('is clearly audible in the typical mid zone, not only near high', () => {
    // Median tension inside 1–2.5 on live BTCUSDT was ~1.5.
    const m = tensionMix(1.5, 0, false);
    expect(m.subLevel).toBeGreaterThanOrEqual(0.5);
    expect(m.percLevel).toBeGreaterThanOrEqual(0.3);
  });

  it('adds riser, detune and vibrato only above high, capped at full depth', () => {
    expect(tensionMix(high, 0, false).riserLevel).toBe(0);
    const p = tensionMix(high + 0.75, 0, false);
    expect(p.riserLevel).toBeGreaterThan(0);
    expect(p.vibratoDepth).toBeGreaterThan(0);
    expect(p.droneFlatCents).toBeGreaterThan(0);
    expect(tensionMix(50, 0, false)).toEqual(tensionMix(high + 1.5, 0, false));
  });

  it('doubles time at high and holds it through small dips', () => {
    expect(tensionMix(high - 0.01, 0, false).doubleTime).toBe(false);
    expect(tensionMix(high, 0, false).doubleTime).toBe(true);
    expect(tensionMix(high - 0.2, 0, true).doubleTime).toBe(true);
    expect(tensionMix(high - 0.4, 0, true).doubleTime).toBe(false);
  });

  it('runs the arpeggio with the move: up is higher and brighter, down is lower and darker', () => {
    const t = 2.2;
    const neutral = tensionMix(t, 0, false);
    const up = tensionMix(t, 0.9, false);
    const down = tensionMix(t, -0.9, false);
    expect([up.contour, neutral.contour, down.contour]).toEqual(['up', 'calm', 'down']);
    expect(up.registerBias).toBeGreaterThan(0);
    expect(down.registerBias).toBeLessThan(0);
    expect(up.arpCutoffHz).toBeGreaterThan(neutral.arpCutoffHz);
    expect(down.arpCutoffHz).toBeLessThan(neutral.arpCutoffHz);
  });

  it('changes levels continuously: no jump between nearby tension values', () => {
    let prev = tensionMix(0, 0, false);
    for (let t = 0.01; t <= 5; t += 0.01) {
      const m = tensionMix(t, 0, false);
      for (const k of ['subLevel', 'percLevel', 'riserLevel', 'intensity', 'peak'] as const) {
        expect(Math.abs(m[k] - prev[k])).toBeLessThan(0.03);
      }
      expect(Math.abs(m.bpm - prev.bpm)).toBeLessThan(0.5);
      prev = m;
    }
  });
});

describe('stepShock', () => {
  const TICK = 250;
  /** Feeds a tension series one tick apart; returns the ticks that fired. */
  function run(series: number[], from: ShockState = INITIAL_SHOCK, t0 = 0) {
    let state = from;
    const fired: number[] = [];
    series.forEach((tension, i) => {
      const r = stepShock(state, tension, t0 + i * TICK);
      state = r.state;
      if (r.fired) fired.push(i);
    });
    return { fired, state };
  }

  it('fires once on a sudden jump into the peak zone', () => {
    // Tension after raw jumps from ~0 to 6 (attack 0.4 per tick).
    expect(run([0.2, 0.2, 2.52, 3.95, 4.77, 5.26, 5.5]).fired).toEqual([3]);
  });

  it('stays quiet on a slow climb to the same level', () => {
    const climb = Array.from({ length: 80 }, (_, i) => 0.2 + i * 0.07);
    expect(run(climb).fired).toEqual([]);
  });

  it('stays quiet on an ordinary jump into the mid zone', () => {
    // The kind of move that happens dozens of times an hour on a calm market.
    expect(run([0.2, 0.2, 1.3, 2.0, 2.4, 2.6, 2.7]).fired).toEqual([]);
  });

  it('waits out the cooldown before firing again', () => {
    const jump = [0.1, 0.1, 4];
    const first = run(jump);
    expect(first.fired).toEqual([2]);
    // Tension relaxes, then jumps again 5 s later: too soon.
    const soon = run(jump, first.state, 5_000);
    expect(soon.fired).toEqual([]);
    const later = run(jump, soon.state, 60_000);
    expect(later.fired).toEqual([2]);
  });

  it('does not compare across a gap in updates, e.g. a switch to another pair', () => {
    // Calm old pair, then the new pair's first snapshot is already tense (history prefill).
    const calm = run([0.2, 0.2, 0.2]);
    expect(run([4], calm.state, 60_000).fired).toEqual([]);
  });
});
