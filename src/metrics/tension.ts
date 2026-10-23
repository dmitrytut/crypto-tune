import { asymSmooth, zScore } from './stats';

export interface TensionParams {
  /** Smoothing coefficient per tick when raw rises. */
  attack: number;
  /** Smoothing coefficient per tick when raw falls. */
  release: number;
  /** Symmetric smoothing of sign(ret) per tick. */
  directionK: number;
  /** Weight of volume z relative to return z. */
  volWeight: number;
  /** Clamp for volume z; one block trade must not pin tension at the ceiling. */
  volZCap: number;
  /** User multiplier applied to raw. */
  sensitivity: number;
}

export const DEFAULT_TENSION_PARAMS: TensionParams = {
  attack: 0.4,
  release: 0.03,
  directionK: 0.1,
  volWeight: 0.7,
  volZCap: 6,
  sensitivity: 1,
};

/**
 * Tension thresholds shared by UI and audio: `mid` brings in the tension layer
 * (filter, tempo, sub, percussion), `high` adds riser, detune, double tempo,
 * and at `peak` those effects (and the aura's turbulence) reach full depth.
 */
export const TENSION_LEVELS = { mid: 1, high: 2.5, peak: 4 } as const;

/** @package */
export interface TensionInput {
  /** log(price / price N seconds ago). */
  ret: number;
  /** Rolling std of `ret` over the stats window, excluding the current sample. */
  retStd: number;
  /** Quote volume over the trailing second. */
  volPerSec: number;
  volMean: number;
  volStd: number;
  /** False during warm-up: tension and direction are forced to 0. */
  ready: boolean;
}

/** @package */
export interface TensionState {
  z: number;
  volZ: number;
  raw: number;
  /** Smoothed, ≥ 0. See TENSION_LEVELS for the musical thresholds. */
  tension: number;
  /** Smoothed sign(ret), −1 … 1. */
  direction: number;
}

/** @package */
export const INITIAL_TENSION: TensionState = { z: 0, volZ: 0, raw: 0, tension: 0, direction: 0 };

/** @package */
export function stepTension(
  prev: TensionState,
  input: TensionInput,
  params: TensionParams,
): TensionState {
  if (!input.ready) return INITIAL_TENSION;
  const z = zScore(input.ret, 0, input.retStd);
  const volZ = Math.min(params.volZCap, zScore(input.volPerSec, input.volMean, input.volStd));
  const raw = params.sensitivity * Math.max(Math.abs(z), volZ * params.volWeight);
  return {
    z,
    volZ,
    raw,
    tension: asymSmooth(prev.tension, raw, params.attack, params.release),
    direction: prev.direction + params.directionK * (Math.sign(input.ret) - prev.direction),
  };
}
