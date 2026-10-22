import { TICK_MS } from '../metrics/engine';
import { TENSION_LEVELS } from '../metrics/tension';
import type { Contour } from './arp-pattern';

/** Double time engages at `high` and releases below `high − DOUBLE_TIME_HYSTERESIS`. */
const DOUBLE_TIME_HYSTERESIS = 0.3;
/** |direction| beyond which the arpeggio runs in the move's direction. */
const DIRECTION_THRESHOLD = 0.5;

/**
 * Tempo of a calm market; the mix raises it to TENSE_BPM with tension.
 * @package
 */
export const CALM_BPM = 60;
const TENSE_BPM = 90;
const CALM_CUTOFF_HZ = 1000;
const OPEN_CUTOFF_HZ = 6000;
const RISER_FROM_HZ = 400;
const RISER_TO_HZ = 5000;
/** Most the direction moves the register at full intensity, in scale degrees. */
const MAX_DIRECTION_BIAS = 2;
const MAX_VIBRATO_DEPTH = 0.15;
const MAX_DRONE_FLAT_CENTS = 20;
/**
 * Rise of tension within SHOCK_WINDOW_TICKS that counts as a sudden move.
 * Tuned on 2 h of live BTCUSDT (calm evening, 0.46 % range): 1.5 fired 53×/h,
 * 3.5 fires ~5×/h. Any such rise from rest lands above TENSION_LEVELS.high.
 */
const SHOCK_RISE = 3.5;
/** Lookback for the rise, ticks including the current one (5 × 250 ms ≈ 1 s). */
const SHOCK_WINDOW_TICKS = 5;
/** Minimum feed-clock gap between two shocks, ms. */
const SHOCK_COOLDOWN_MS = 20_000;

/** Everything the layers need for one tick, derived from tension and direction only. */
export interface TensionMix {
  /** 0 below TENSION_LEVELS.mid, 1 at TENSION_LEVELS.high. */
  intensity: number;
  /** 0 up to TENSION_LEVELS.high, 1 at TENSION_LEVELS.peak. */
  peak: number;
  bpm: number;
  /** Arpeggio in eighths instead of quarters. */
  doubleTime: boolean;
  arpCutoffHz: number;
  contour: Contour;
  /** Register offset from direction, scale degrees; added to the EMA shift. */
  registerBias: number;
  /** Linear 0…1 levels inside the tension layer. */
  subLevel: number;
  percLevel: number;
  riserLevel: number;
  riserHz: number;
  /** Vibrato depth on the arpeggio, 0…1 (Tone normal range). */
  vibratoDepth: number;
  /** How far the drone root is pulled flat against the fifth, cents ≥ 0 (beating = unease). */
  droneFlatCents: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Ease-in-out so the riser fades in without an audible "switch on" point. */
const smoothstep = (x: number) => x * x * (3 - 2 * x);
/** Ease-out: audible early in the zone, still flat-topped at 1. */
const easeOut = (x: number) => 1 - (1 - x) ** 2;

export function tensionMix(tension: number, direction: number, wasDoubleTime: boolean): TensionMix {
  const { mid, high, peak: full } = TENSION_LEVELS;
  const intensity = clamp01((tension - mid) / (high - mid));
  const peak = clamp01((tension - high) / (full - high));
  const rising = Math.max(0, direction) * intensity;
  const falling = Math.max(0, -direction) * intensity;

  const contour: Contour =
    intensity === 0 || Math.abs(direction) < DIRECTION_THRESHOLD
      ? 'calm'
      : direction > 0
        ? 'up'
        : 'down';

  return {
    intensity,
    peak,
    bpm: CALM_BPM + (TENSE_BPM - CALM_BPM) * intensity,
    doubleTime: wasDoubleTime ? tension >= high - DOUBLE_TIME_HYSTERESIS : tension >= high,
    // Exponential sweep: equal steps of intensity sound like equal steps of brightness.
    arpCutoffHz:
      CALM_CUTOFF_HZ *
      (OPEN_CUTOFF_HZ / CALM_CUTOFF_HZ) ** intensity *
      (1 + 0.4 * rising - 0.3 * falling),
    contour,
    registerBias: Math.round(MAX_DIRECTION_BIAS * intensity * direction),
    subLevel: easeOut(intensity),
    // Percussion trails the sub so the texture builds in two steps.
    percLevel: easeOut(clamp01((intensity - 0.1) / 0.9)),
    riserLevel: smoothstep(peak),
    riserHz: RISER_FROM_HZ * (RISER_TO_HZ / RISER_FROM_HZ) ** peak,
    vibratoDepth: MAX_VIBRATO_DEPTH * peak,
    droneFlatCents: MAX_DRONE_FLAT_CENTS * peak,
  };
}

export interface ShockState {
  /** Tension over the last SHOCK_WINDOW_TICKS − 1 ticks, oldest first. */
  recent: readonly number[];
  /** Feed time of the last update. */
  lastTs: number;
  lastFireTs: number;
}

export const INITIAL_SHOCK: ShockState = {
  recent: [],
  lastTs: Number.NEGATIVE_INFINITY,
  lastFireTs: Number.NEGATIVE_INFINITY,
};

/**
 * Detects a sudden move: tension climbing by SHOCK_RISE within about a second.
 * Slow climbs never fire; a cooldown keeps a choppy market from turning the
 * accent into a pattern. `ts` is the feed clock. After a gap in updates (a new
 * pipeline, a throttled tab) the lookback restarts: the old values belong to
 * another market or another moment.
 */
export function stepShock(
  prev: ShockState,
  tension: number,
  ts: number,
): { state: ShockState; fired: boolean } {
  const recent = ts - prev.lastTs <= SHOCK_WINDOW_TICKS * TICK_MS ? prev.recent : [];
  const low = Math.min(tension, ...recent);
  const fired = tension - low >= SHOCK_RISE && ts - prev.lastFireTs >= SHOCK_COOLDOWN_MS;
  return {
    state: {
      recent: [...recent, tension].slice(1 - SHOCK_WINDOW_TICKS),
      lastTs: ts,
      lastFireTs: fired ? ts : prev.lastFireTs,
    },
    fired,
  };
}
