import { describe, expect, it } from 'vitest';
import {
  collapse,
  eventVelocity,
  LIQUIDATION_VOICES,
  type PendingEvent,
  TRADE_VOICES,
} from '../events-map';
import { degreeToMidi, pitchClassMidi } from '../scale';

describe('collapse', () => {
  it('returns nothing for an empty tick', () => {
    expect(collapse([], 0)).toBeNull();
  });

  it('merges a cascade into one cue for the side with the larger total notional', () => {
    const events: PendingEvent<'long' | 'short'>[] = [
      { ts: 10, side: 'long', usd: 40_000 },
      { ts: 11, side: 'short', usd: 70_000 },
      { ts: 12, side: 'long', usd: 50_000 },
    ];
    expect(collapse(events, 0)).toEqual({ side: 'long', usd: 90_000, count: 2 });
  });

  it('drops stale events such as replayed history or a throttled-tab backlog', () => {
    const events: PendingEvent<'buy' | 'sell'>[] = [
      { ts: 100, side: 'sell', usd: 9e9 },
      { ts: 5_000, side: 'buy', usd: 300_000 },
    ];
    expect(collapse(events, 4_000)).toEqual({ side: 'buy', usd: 300_000, count: 1 });
    expect(collapse(events, 6_000)).toBeNull();
  });
});

describe('eventVelocity', () => {
  it('is quiet at the threshold, full at 100× and capped beyond', () => {
    expect(eventVelocity(20_000, 20_000)).toBeCloseTo(0.35, 12);
    expect(eventVelocity(2_000_000, 20_000)).toBeCloseTo(1, 12);
    expect(eventVelocity(2e9, 20_000)).toBe(1);
  });

  it('grows with size on a log scale', () => {
    const at10x = eventVelocity(200_000, 20_000);
    expect(at10x).toBeCloseTo((0.35 + 1) / 2, 12);
    expect(eventVelocity(100_000, 20_000)).toBeLessThan(at10x);
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
