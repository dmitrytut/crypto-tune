import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trade } from '../market-feed';
import { SimulatorFeed } from '../simulator';

describe('SimulatorFeed clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never runs ahead of the events it has emitted', () => {
    const feed = new SimulatorFeed({ historyMs: 60_000 });
    const trades: Trade[] = [];
    feed.onTrade((t) => trades.push(t));
    feed.connect();
    const horizon = feed.now();
    expect(horizon).toBe(Date.now());

    // Wall clock jumps (throttled tab) before the generator's timer has run:
    // the clock must stay at the emitted horizon so no tick closes early.
    vi.setSystemTime(Date.now() + 60_000);
    expect(feed.now()).toBe(horizon);

    vi.advanceTimersByTime(100);
    expect(feed.now()).toBe(Date.now());
    const last = trades.at(-1) as Trade;
    expect(last.ts).toBeGreaterThan(horizon);
    expect(last.ts).toBeLessThanOrEqual(feed.now());
    feed.disconnect();
  });
});
