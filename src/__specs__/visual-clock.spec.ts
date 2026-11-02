import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibratedClock } from '../visual-clock';

let wall: number;
let monotonic: number;
let market: number;
const feed = { now: () => market };

beforeEach(() => {
  wall = 60_000;
  monotonic = 1_000;
  market = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => wall);
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
});

afterEach(() => vi.restoreAllMocks());

describe('calibratedClock', () => {
  it('calibrates at first read, after the feed has observed its first event', () => {
    market = wall; // Before the first event, the feed has not learned the device's skew.
    const now = calibratedClock(feed);
    wall += 5_000;
    monotonic += 5_000;
    market = 5_000;
    expect(now()).toBe(5_000);
    wall += 250;
    monotonic += 250;
    expect(now()).toBe(5_250);
  });

  it('does not follow the feed clock backwards while delayed messages drain', () => {
    const now = calibratedClock(feed);
    expect(now()).toBe(0);
    wall += 5_000;
    monotonic += 5_000;
    market = 1_000;
    expect(now() - market).toBe(4_000);
  });

  it('includes system sleep even when the performance clock is paused', () => {
    const now = calibratedClock(feed);
    expect(now()).toBe(0);
    wall += 3_600_000;
    market += 3_600_000;
    expect(now()).toBe(market);
    wall += 3_000;
    expect(now() - market).toBe(3_000);
  });

  it('does not age fresh trades when the performance clock drifts ahead', () => {
    const now = calibratedClock(feed);
    expect(now()).toBe(0);
    wall += 3_600_000;
    market += 3_600_000;
    monotonic += 3_603_000;
    expect(now() - market).toBe(0);
  });
});
