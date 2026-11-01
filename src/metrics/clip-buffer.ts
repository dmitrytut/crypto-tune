import type { Liquidation, Trade } from '../feed/market-feed';
import type { MetricsSnapshot } from './engine';
import type { EventCues } from './events';
import type { HistorySeries, MarketHistory } from './history';

/** Clip lengths a listener can pick, seconds. */
export const CLIP_LENGTHS_SEC = [15, 30] as const;
export type ClipSeconds = (typeof CLIP_LENGTHS_SEC)[number];
/**
 * Data rendered before the clip starts and cut off: the music fades in over 3 s and the reverb
 * needs a tail, the aura and particles need a moment to fill the screen.
 */
export const CLIP_PREROLL_SEC = 5;
/**
 * Kept: the longest clip, its pre-roll and a second of slack. Ticks do not land on the trim
 * cutoff (timers drift), so without the slack the longest clip would stay just short of ready.
 */
const KEEP_MS = (Math.max(...CLIP_LENGTHS_SEC) + CLIP_PREROLL_SEC + 1) * 1000;

/** One metrics tick as the live view and audio got it. */
export interface ClipTick {
  /** Tick time, feed clock. */
  ts: number;
  snap: MetricsSnapshot | null;
  cues: EventCues;
}

/** What a clip replays: the clip and its pre-roll, oldest first, feed clock. */
export interface ClipWindow {
  /** Start of the pre-roll. */
  start: number;
  /** The last tick: the end of the clip. */
  end: number;
  prerollMs: number;
  trades: Trade[];
  liquidations: Liquidation[];
  ticks: ClipTick[];
}

/**
 * The live market of the last KEEP_MS, what a clip of the moment just heard is rendered from.
 * Only data that arrived live goes in: history loaded on connect is older than what the listener
 * saw. A gap in the feed resets it, so a clip never spans a hole.
 */
export class ClipBuffer {
  private trades: Trade[] = [];
  private liquidations: Liquidation[] = [];
  private ticks: ClipTick[] = [];

  addTrade(t: Trade): void {
    this.trades.push(t);
  }

  addLiquidation(l: Liquidation): void {
    this.liquidations.push(l);
  }

  /** Once per tick; drops what fell out of the window. */
  addTick(tick: ClipTick): void {
    this.ticks.push(tick);
    const cutoff = tick.ts - KEEP_MS;
    if ((this.ticks[0]?.ts ?? cutoff) < cutoff)
      this.ticks = this.ticks.filter((t) => t.ts >= cutoff);
    if ((this.trades[0]?.ts ?? cutoff) < cutoff)
      this.trades = this.trades.filter((t) => t.ts >= cutoff);
    if ((this.liquidations[0]?.ts ?? cutoff) < cutoff) {
      this.liquidations = this.liquidations.filter((l) => l.ts >= cutoff);
    }
  }

  reset(): void {
    this.trades = [];
    this.liquidations = [];
    this.ticks = [];
  }

  /** Whether a clip of `seconds` (plus pre-roll) is on hand, and how long until it is, ms. */
  readiness(seconds: ClipSeconds): { ready: boolean; leftMs: number } {
    const first = this.ticks[0]?.ts;
    const last = this.ticks.at(-1)?.ts;
    const have = first === undefined || last === undefined ? 0 : last - first;
    const leftMs = Math.max(0, (seconds + CLIP_PREROLL_SEC) * 1000 - have);
    return { ready: leftMs === 0, leftMs };
  }

  /** A copy of the last `seconds` and their pre-roll; null until enough has arrived. */
  window(seconds: ClipSeconds): ClipWindow | null {
    const end = this.ticks.at(-1)?.ts;
    if (end === undefined || !this.readiness(seconds).ready) return null;
    const start = end - (seconds + CLIP_PREROLL_SEC) * 1000;
    const after = <T extends { ts: number }>(xs: T[]) =>
      xs.filter((x) => x.ts > start && x.ts <= end);
    return {
      start,
      end,
      prerollMs: CLIP_PREROLL_SEC * 1000,
      trades: after(this.trades),
      liquidations: after(this.liquidations),
      ticks: after(this.ticks),
    };
  }
}

/**
 * The chart's history as it grew during a clip: everything complete before the window, then the
 * window's trades, snapshots and markers up to the frame being drawn. One object for the whole
 * render, so the chart sees new markers arrive as it does live.
 */
export function replayHistory(
  base: MarketHistory,
  w: ClipWindow,
): { series: HistorySeries; advanceTo(ts: number): void } {
  const h = base.before(w.start);
  let ti = 0;
  let ki = 0;
  return {
    series: h,
    advanceTo(ts) {
      for (; ti < w.trades.length && (w.trades[ti] as Trade).ts <= ts; ti++) {
        h.addTrade(w.trades[ti] as Trade);
      }
      for (; ki < w.ticks.length && (w.ticks[ki] as ClipTick).ts <= ts; ki++) {
        const tick = w.ticks[ki] as ClipTick;
        if (tick.snap) h.addSnapshot(tick.snap);
        h.addCues(tick.ts, tick.cues);
      }
    },
  };
}
