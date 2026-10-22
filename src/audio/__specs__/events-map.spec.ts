import { describe, expect, it } from 'vitest';
import { eventVelocity, LIQUIDATION_VOICES, TRADE_VOICES } from '../events-map';
import { degreeToMidi, pitchClassMidi } from '../scale';

describe('eventVelocity', () => {
  it('is quiet at the threshold, full at 100× and capped beyond', () => {
    expect(eventVelocity(1)).toBeCloseTo(0.35, 12);
    expect(eventVelocity(100)).toBeCloseTo(1, 12);
    expect(eventVelocity(1e5)).toBe(1);
  });

  it('grows with size on a log scale', () => {
    const at10x = eventVelocity(10);
    expect(at10x).toBeCloseTo((0.35 + 1) / 2, 12);
    expect(eventVelocity(5)).toBeLessThan(at10x);
  });
});

describe('voice placement', () => {
  const pitch = (v: { octave: number; degree: number }) =>
    degreeToMidi(pitchClassMidi(9, v.octave), v.degree);

  it('sounds long liquidations below short ones', () => {
    expect(pitch(LIQUIDATION_VOICES.long)).toBeLessThan(pitch(LIQUIDATION_VOICES.short));
  });

  it('places buys higher and to the right of sells', () => {
    expect(pitch(TRADE_VOICES.buy)).toBeGreaterThan(pitch(TRADE_VOICES.sell));
    expect(TRADE_VOICES.buy.pan).toBeGreaterThan(0);
    expect(TRADE_VOICES.sell.pan).toBe(-TRADE_VOICES.buy.pan);
  });
});
