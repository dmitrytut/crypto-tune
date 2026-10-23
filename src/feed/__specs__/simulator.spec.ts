import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Liquidation, Trade } from '../market-feed';
import { DEFAULT_SIM_PARAMS, MarketSimulator, SimulatorFeed } from '../simulator';

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

  it('hands its history over once on connect, older than every live trade', () => {
    const feed = new SimulatorFeed({ historyMs: 60_000 });
    const histories: (readonly Trade[])[] = [];
    const live: Trade[] = [];
    feed.onHistory((h) => histories.push(h));
    feed.onTrade((t) => live.push(t));
    feed.connect();
    expect(histories).toHaveLength(1);
    const past = histories[0] as readonly Trade[];
    expect(past.length).toBeGreaterThan(0);
    expect((past[0] as Trade).ts).toBeGreaterThanOrEqual(Date.now() - 60_000);
    expect(live).toEqual([]);

    vi.advanceTimersByTime(1_000);
    expect(live.length).toBeGreaterThan(0);
    expect((live[0] as Trade).ts).toBeGreaterThan((past.at(-1) as Trade).ts);
    expect(histories).toHaveLength(1);
    feed.disconnect();
  });
});

describe('MarketSimulator', () => {
  // Fixed seed (DEFAULT_SIM_PARAMS.seed) over a 2h horizon: deterministic across runs, long
  // enough to cover many calm/impulse cycles (calm 90-300s, impulse 15-90s).
  const HORIZON_MS = 2 * 60 * 60 * 1000;

  function run(): { trades: Trade[]; liqs: Liquidation[] } {
    const sim = new MarketSimulator(0, DEFAULT_SIM_PARAMS);
    const trades: Trade[] = [];
    const liqs: Liquidation[] = [];
    sim.advance(
      HORIZON_MS,
      (t) => trades.push(t),
      (l) => liqs.push(l),
    );
    return { trades, liqs };
  }

  it('emits prices rounded to priceTick', () => {
    const { trades, liqs } = run();
    const perUnit = Math.round(1 / DEFAULT_SIM_PARAMS.priceTick);
    for (const e of [...trades, ...liqs]) {
      expect(Math.round(e.price * perUnit)).toBeCloseTo(e.price * perUnit, 6);
    }
  });

  it('emits trades and liquidations in ts order', () => {
    const { trades, liqs } = run();
    for (const events of [trades, liqs]) {
      const ts = events.map((e) => e.ts);
      expect(ts).toEqual(ts.toSorted((a, b) => a - b));
    }
  });

  it('alternates calm and impulse regimes over a long horizon', () => {
    // liqRateCalm=0.01/s (mean gap 100s) vs liqRateImpulse=0.7/s (mean gap ~1.4s): a gap this
    // short is implausible under calm alone, a gap this long implausible under impulse alone.
    const ts = run().liqs.map((l) => l.ts);
    const gaps = ts.slice(1).map((t, i) => t - (ts[i] as number));
    expect(Math.min(...gaps)).toBeLessThan(5_000);
    expect(Math.max(...gaps)).toBeGreaterThan(100_000);
  });

  it('liquidation side follows the drift sign: forced SELL (falling price) is a long liquidation', () => {
    // White-box proxy using only public fields: for each liquidation, compare the price just
    // before it to the price ~20s earlier. Almost all liquidations happen during impulses
    // (liqRateImpulse >> liqRateCalm), so this tracks the documented rule closely.
    const { trades, liqs } = run();
    let correct = 0;
    let total = 0;
    for (const l of liqs) {
      const window = trades.filter((t) => t.ts <= l.ts && t.ts >= l.ts - 20_000);
      const first = window[0];
      const last = window.at(-1);
      if (!first || !last || first === last) continue;
      if (last.price < first.price === (l.side === 'long')) correct++;
      total++;
    }
    expect(total).toBeGreaterThan(500);
    expect(correct / total).toBeGreaterThan(0.9);
  });

  it('trade aggressor side follows buyBias direction on average', () => {
    // White-box proxy: compare each trade's price to a trade ~20s ahead. buyBias shifts the
    // aggressor toward the impulse direction, so buys should lead rising price and sells
    // should lead falling price more often than chance (0.5).
    const { trades } = run();
    const WINDOW_MS = 20_000;
    let matches = 0;
    let total = 0;
    let j = 0;
    for (const t of trades) {
      while (j < trades.length && (trades[j] as Trade).ts - t.ts < WINDOW_MS) j++;
      const ahead = trades[j];
      if (!ahead) break;
      if (ahead.price === t.price) continue;
      if (ahead.price > t.price === (t.side === 'buy')) matches++;
      total++;
    }
    expect(total).toBeGreaterThan(10_000);
    expect(matches / total).toBeGreaterThan(0.55);
  });
});
