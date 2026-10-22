import { TENSION_LEVELS } from '../metrics/tension';
import type { Contour } from './arp-pattern';

/** Tension above `high` at which the peak effects (riser, detune) are at full depth. */
const PEAK_SPAN = 1.5;
/** Double time engages at `high` and releases below `high − DOUBLE_TIME_HYSTERESIS`. */
const DOUBLE_TIME_HYSTERESIS = 0.3;
/** |direction| beyond which the arpeggio runs in the move's direction. */
const DIRECTION_THRESHOLD = 0.5;

const CALM_BPM = 60;
const TENSE_BPM = 90;
const CALM_CUTOFF_HZ = 1000;
const OPEN_CUTOFF_HZ = 6000;
const RISER_FROM_HZ = 400;
const RISER_TO_HZ = 5000;
/** Most the direction moves the register at full intensity, in scale degrees. */
const MAX_DIRECTION_BIAS = 2;
const MAX_VIBRATO_DEPTH = 0.15;
const MAX_DRONE_FLAT_CENTS = 20;

/** Everything the layers need for one tick, derived from tension and direction only. */
export interface TensionMix {
  /** 0 below TENSION_LEVELS.mid, 1 at TENSION_LEVELS.high. */
  intensity: number;
  /** 0 up to TENSION_LEVELS.high, 1 at high + PEAK_SPAN. */
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
/** Ease-in-out so layers fade in without an audible "switch on" point. */
const smoothstep = (x: number) => x * x * (3 - 2 * x);

export function tensionMix(tension: number, direction: number, wasDoubleTime: boolean): TensionMix {
  const { mid, high } = TENSION_LEVELS;
  const intensity = clamp01((tension - mid) / (high - mid));
  const peak = clamp01((tension - high) / PEAK_SPAN);
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
    subLevel: smoothstep(intensity),
    // Percussion trails the sub so the texture builds in two steps.
    percLevel: smoothstep(clamp01((intensity - 0.25) / 0.75)),
    riserLevel: smoothstep(peak),
    riserHz: RISER_FROM_HZ * (RISER_TO_HZ / RISER_FROM_HZ) ** peak,
    vibratoDepth: MAX_VIBRATO_DEPTH * peak,
    droneFlatCents: MAX_DRONE_FLAT_CENTS * peak,
  };
}
