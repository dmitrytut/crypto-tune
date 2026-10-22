import { describe, expect, it } from 'vitest';
import { auraTarget } from '../palette';

const calm = { tension: 0, direction: 0, volZ: 0, emaZ: 0 };

describe('auraTarget', () => {
  it('is indigo and slow on a calm, directionless market', () => {
    const a = auraTarget(calm);
    expect(a.colorB[2]).toBeGreaterThan(a.colorB[0]);
    expect(a.colorB[2]).toBeGreaterThan(a.colorB[1]);
    expect(a.speed).toBeLessThan(0.1);
  });

  it('turns teal on a rising move and magenta/amber on a falling one', () => {
    const up = auraTarget({ ...calm, tension: 3, direction: 1 });
    const down = auraTarget({ ...calm, tension: 3, direction: -1 });
    // Teal: green dominates red. Falling: red dominates blue.
    expect(up.colorB[1]).toBeGreaterThan(up.colorB[0]);
    expect(down.colorB[0]).toBeGreaterThan(down.colorB[2]);
  });

  it('tints toward direction more as tension grows', () => {
    const quiet = auraTarget({ ...calm, tension: 0.2, direction: 1 });
    const tense = auraTarget({ ...calm, tension: 2.5, direction: 1 });
    const base = auraTarget(calm);
    const shift = (a: typeof base) => Math.abs(a.colorB[1] - base.colorB[1]);
    expect(shift(tense)).toBeGreaterThan(shift(quiet));
  });

  it('moves faster and tears more with tension, saturating past the peak', () => {
    const at = (tension: number) => auraTarget({ ...calm, tension });
    expect(at(1.5).speed).toBeGreaterThan(at(0.5).speed);
    expect(at(3.5).warp).toBeGreaterThan(at(2).warp);
    expect(at(40)).toEqual(at(4));
  });

  it('brightens with volume spikes, capped', () => {
    expect(auraTarget({ ...calm, volZ: 2 }).glow).toBeGreaterThan(auraTarget(calm).glow);
    expect(auraTarget({ ...calm, volZ: 50 }).glow).toBe(auraTarget({ ...calm, volZ: 4 }).glow);
    expect(auraTarget({ ...calm, volZ: -3 }).glow).toBe(auraTarget(calm).glow);
  });

  it('lifts the glow when price is above its EMA and sinks it below, bounded', () => {
    expect(auraTarget({ ...calm, emaZ: 2 }).shiftY).toBeGreaterThan(0);
    expect(auraTarget({ ...calm, emaZ: -2 }).shiftY).toBeLessThan(0);
    expect(auraTarget({ ...calm, emaZ: 99 }).shiftY).toBe(0.25);
  });

  it('reacts to order flow immediately, with tension still zero (warm-up or calm)', () => {
    const buying = auraTarget(calm, { imbalance: 0.8, activity: 0.9 });
    const selling = auraTarget(calm, { imbalance: -0.8, activity: 0.9 });
    const quiet = auraTarget(calm, { imbalance: 0, activity: 0 });
    expect(buying.colorB[1]).toBeGreaterThan(quiet.colorB[1]);
    expect(selling.colorB[0]).toBeGreaterThan(quiet.colorB[0]);
    expect(buying.drift).toBeGreaterThan(0);
    expect(selling.drift).toBeLessThan(0);
    expect(buying.speed).toBeGreaterThan(quiet.speed);
    expect(buying.glow).toBeGreaterThan(quiet.glow);
  });

  it('lets strong opposite flow override a stale direction', () => {
    const a = auraTarget({ ...calm, direction: 0.3 }, { imbalance: -1, activity: 0.5 });
    expect(a.colorB[0]).toBeGreaterThan(a.colorB[2]);
  });
});
