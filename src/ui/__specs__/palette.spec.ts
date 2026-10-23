import { describe, expect, it } from 'vitest';
import {
  auraTarget,
  backdropLuminance,
  DOWN_COLOR,
  luminance,
  poolStrength,
  UP_COLOR,
} from '../palette';

/** RGBA bytes: `n` pixels of one sRGB colour (0…255 channels). */
const pixels = (n: number, [r, g, b]: [number, number, number]) =>
  Uint8Array.from({ length: n * 4 }, (_, i) => [r, g, b, 255][i % 4] ?? 0);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

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

describe('backdropLuminance', () => {
  it('ignores a few hot pixels but not a bright fold', () => {
    const dark = pixels(95, [10, 12, 20]);
    const spots = new Uint8Array([...dark, ...pixels(5, [255, 255, 255])]);
    const fold = new Uint8Array([...pixels(80, [10, 12, 20]), ...pixels(20, [130, 50, 90])]);
    expect(backdropLuminance(spots)).toBeLessThan(0.01);
    expect(backdropLuminance(fold)).toBeCloseTo(luminance([130 / 255, 50 / 255, 90 / 255]), 2);
  });

  it('never reads darker than the backdrop is', () => {
    const c: [number, number, number] = [40, 90, 120];
    expect(backdropLuminance(pixels(50, c))).toBeGreaterThanOrEqual(
      luminance([c[0] / 255, c[1] / 255, c[2] / 255]),
    );
  });
});

describe('poolStrength', () => {
  const sell = luminance(DOWN_COLOR);

  it('needs no pool over a dim aura', () => {
    expect(poolStrength(0, sell)).toBe(0);
    expect(poolStrength(0.01, sell)).toBe(0);
  });

  it('grows with the backdrop and caps at the full pool', () => {
    expect(poolStrength(0.05, sell)).toBeGreaterThan(poolStrength(0.03, sell));
    expect(poolStrength(0.03, sell)).toBeGreaterThan(0);
    expect(poolStrength(1, sell)).toBe(1);
  });

  it('asks less for lighter text over the same backdrop', () => {
    expect(poolStrength(0.1, luminance(UP_COLOR))).toBeLessThan(poolStrength(0.1, sell));
    expect(poolStrength(0.05, luminance(UP_COLOR))).toBe(0);
  });

  it('gives text that cannot reach the contrast even over black the full pool', () => {
    expect(poolStrength(0.01, 0.05)).toBe(1);
  });

  it('darkens just enough for the text to keep 4.5:1', () => {
    for (const [text, backdrop] of [
      [sell, 0.03],
      [sell, 0.08],
      [sell, 0.3],
      [luminance(UP_COLOR), 0.3],
    ] as const) {
      const strength = poolStrength(backdrop, text);
      expect(strength).toBeLessThan(1);
      // The pool's veil where the text rows sit is 0.8 alpha at full strength.
      const veiled = backdrop * (1 - 0.8 * strength) ** 2.2;
      expect(contrast(text, veiled)).toBeCloseTo(4.5, 1);
    }
  });
});
