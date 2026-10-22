import { describe, expect, it } from 'vitest';
import {
  INITIAL_TENSION,
  DEFAULT_TENSION_PARAMS as P,
  stepTension,
  type TensionInput,
} from '../tension';

const calm: TensionInput = {
  ret: 0,
  retStd: 0.001,
  volPerSec: 100,
  volMean: 100,
  volStd: 10,
  ready: true,
};

describe('stepTension', () => {
  it('stays at zero during warm-up regardless of input', () => {
    const s = stepTension(INITIAL_TENSION, { ...calm, ret: 0.05, ready: false }, P);
    expect(s).toEqual(INITIAL_TENSION);
  });

  it('takes raw as max of |z| and weighted volume z', () => {
    const byRet = stepTension(INITIAL_TENSION, { ...calm, ret: -0.003 }, P);
    expect(byRet.z).toBeCloseTo(-3, 12);
    expect(byRet.raw).toBeCloseTo(3, 12);

    const byVol = stepTension(INITIAL_TENSION, { ...calm, ret: 0.001, volPerSec: 150 }, P);
    expect(byVol.volZ).toBeCloseTo(5, 12);
    expect(byVol.raw).toBeCloseTo(5 * 0.7, 12);
  });

  it('caps volume z so a single block trade cannot dominate', () => {
    const s = stepTension(INITIAL_TENSION, { ...calm, volPerSec: 100 + 10 * 50 }, P);
    expect(s.volZ).toBe(P.volZCap);
    expect(s.raw).toBeCloseTo(P.volZCap * P.volWeight, 12);
  });

  it('scales raw by sensitivity', () => {
    const s = stepTension(INITIAL_TENSION, { ...calm, ret: 0.002 }, { ...P, sensitivity: 1.5 });
    expect(s.raw).toBeCloseTo(3, 12);
  });

  it('attacks fast and releases slowly', () => {
    const up = stepTension(INITIAL_TENSION, { ...calm, ret: 0.004 }, P);
    expect(up.tension).toBeCloseTo(4 * P.attack, 12);
    const down = stepTension(up, calm, P);
    expect(down.tension).toBeCloseTo(up.tension * (1 - P.release), 12);
  });

  it('smooths direction toward the sign of the return', () => {
    let s = INITIAL_TENSION;
    for (let i = 0; i < 50; i++) s = stepTension(s, { ...calm, ret: 0.0001 }, P);
    expect(s.direction).toBeGreaterThan(0.99);
    s = stepTension(s, { ...calm, ret: -0.0001 }, P);
    expect(s.direction).toBeGreaterThan(0.7);
    expect(s.direction).toBeLessThan(0.99);
  });
});
