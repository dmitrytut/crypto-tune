import { describe, expect, it } from 'vitest';
import { TENSION_LEVELS } from '../../metrics/tension';
import { tensionMix } from '../tension-map';

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
