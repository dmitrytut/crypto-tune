import { describe, expect, it } from 'vitest';
import type { Trade } from '../../feed/market-feed';
import { CLIP_PREROLL_SEC, ClipBuffer, replayHistory } from '../clip-buffer';
import type { EventCues } from '../events';
import { MarketHistory, VOLUME_BUCKET_MS } from '../history';

const T0 = 1_700_000_000_000;
const NO_CUES: EventCues = { trade: null, liquidation: null };
const trade = (ts: number): Trade => ({ ts, price: 100, qty: 1, side: 'buy' });
const snap = (ts: number, price: number) =>
  ({ ts, price, tension: 0.2 }) as unknown as NonNullable<
    Parameters<ClipBuffer['addTick']>[0]['snap']
  >;

/** Live ticks every `stepMs` from `from` for `sec` seconds, with one trade per tick. */
function fill(b: ClipBuffer, sec: number, from = T0, stepMs = 250): number {
  let ts = from;
  for (; ts < from + sec * 1000; ts += stepMs) {
    b.addTrade(trade(ts - 100));
    b.addTick({ ts, snap: snap(ts, 100), cues: NO_CUES });
  }
  return ts - stepMs;
}

describe('ClipBuffer', () => {
  it('is ready for a length once that length and its pre-roll have arrived', () => {
    const b = new ClipBuffer();
    fill(b, 15 + CLIP_PREROLL_SEC - 1);
    expect(b.readiness(15)).toEqual({ ready: false, leftMs: 1250 });
    expect(b.window(15)).toBeNull();
    fill(b, 2, T0 + (15 + CLIP_PREROLL_SEC - 1) * 1000);
    expect(b.readiness(15).ready).toBe(true);
    expect(b.readiness(30).ready).toBe(false);
  });

  it('keeps no more than the longest clip and its pre-roll', () => {
    const b = new ClipBuffer();
    const end = fill(b, 120);
    const w = b.window(30);
    expect(w?.start).toBe(end - 35_000);
    expect(w?.ticks[0]?.ts).toBeGreaterThan(end - 35_000);
    // A 30 s clip stays ready right after old data is trimmed.
    expect(b.readiness(30).ready).toBe(true);
  });

  it('stays ready for the longest clip when ticks drift off the 250 ms grid', () => {
    // A timer is never exact: no tick lands right on the trim cutoff.
    const b = new ClipBuffer();
    fill(b, 120, T0, 251);
    expect(b.readiness(30).ready).toBe(true);
    expect(b.window(30)).not.toBeNull();
  });

  it('cuts the window to the clip and its pre-roll, in feed-clock order', () => {
    const b = new ClipBuffer();
    const end = fill(b, 40);
    const w = b.window(15);
    if (!w) throw new Error('not ready');
    expect(w.end).toBe(end);
    expect(w.start).toBe(end - 20_000);
    expect(w.prerollMs).toBe(CLIP_PREROLL_SEC * 1000);
    expect(w.ticks.every((t) => t.ts > w.start && t.ts <= end)).toBe(true);
    expect(w.trades.every((t) => t.ts > w.start && t.ts <= end)).toBe(true);
    expect(w.ticks).toHaveLength(80);
  });

  it('starts over after a reset: a clip never spans a gap', () => {
    const b = new ClipBuffer();
    const end = fill(b, 40);
    b.reset();
    expect(b.readiness(15)).toEqual({ ready: false, leftMs: 20_000 });
    fill(b, 10, end + 60_000);
    expect(b.window(15)).toBeNull();
  });
});

describe('replayHistory', () => {
  it('reveals the window only up to the frame, markers included', () => {
    const live = new MarketHistory();
    const b = new ClipBuffer();
    let ts = T0;
    for (; ts < T0 + 60_000; ts += 250) {
      const cues: EventCues =
        ts === T0 + 50_000
          ? { trade: { side: 'sell', usd: 5e5, size: 2, count: 1 }, liquidation: null }
          : NO_CUES;
      const s = snap(ts, 100 + (ts - T0) / 1000);
      live.addTrade(trade(ts - 100));
      live.addSnapshot(s);
      live.addCues(ts, cues);
      b.addTrade(trade(ts - 100));
      b.addTick({ ts, snap: s, cues });
    }
    const w = b.window(15);
    if (!w) throw new Error('not ready');
    const r = replayHistory(live, w);
    // Before the first frame: nothing of the window, so the scale cannot know the future.
    expect(r.series.prices.at(-1)?.ts).toBeLessThan(w.start);
    expect(r.series.markers).toHaveLength(0);

    r.advanceTo(T0 + 49_999);
    expect(r.series.prices.at(-1)?.ts).toBe(T0 + 49_000);
    expect(r.series.markers).toHaveLength(0);

    r.advanceTo(w.end);
    expect(r.series.markers).toEqual([{ ts: T0 + 50_000, kind: 'trade', side: 'sell', usd: 5e5 }]);
    const inWindow = (h: { prices: readonly { ts: number }[] }) =>
      h.prices.filter((p) => p.ts > w.start);
    expect(inWindow(r.series)).toEqual(inWindow(live));
    // Every bar the clip can show, the one the window starts in included, as live drew it.
    const bars = (h: { volumes: readonly { ts: number }[] }) =>
      h.volumes.filter((v) => v.ts + VOLUME_BUCKET_MS > w.start);
    expect(bars(r.series)).toHaveLength(3);
    expect(bars(r.series)).toEqual(bars(live));
  });
});
