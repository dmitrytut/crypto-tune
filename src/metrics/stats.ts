/** Below this std a z-score is meaningless (flat series); report 0 instead of ±∞. */
const MIN_STD = 1e-12;

/** @package */
export function zScore(x: number, mean: number, std: number): number {
  return std > MIN_STD ? (x - mean) / std : 0;
}

/**
 * One step of exponential smoothing with separate coefficients for rising
 * (`attack`) and falling (`release`) targets. k ∈ [0, 1]; 1 = jump to target.
 * @package
 */
export function asymSmooth(prev: number, target: number, attack: number, release: number): number {
  const k = target > prev ? attack : release;
  return prev + k * (target - prev);
}

/** Exponentially weighted mean and variance of a series. */
export interface Ewm {
  mean: number;
  variance: number;
}

/**
 * One EW update (West 1979). The first sample seeds the mean with zero
 * variance. `alpha` is the weight of the new sample, (0, 1].
 * @package
 */
export function ewmStep(prev: Ewm | null, x: number, alpha: number): Ewm {
  if (!prev) return { mean: x, variance: 0 };
  const diff = x - prev.mean;
  const incr = alpha * diff;
  return { mean: prev.mean + incr, variance: (1 - alpha) * (prev.variance + diff * incr) };
}

/**
 * Per-sample weight giving an EW average with time constant `tauMs` when
 * sampled every `stepMs`. Exact for any step, so retuning the tick keeps
 * the horizon.
 * @package
 */
export function ewmAlpha(stepMs: number, tauMs: number): number {
  return 1 - Math.exp(-stepMs / tauMs);
}
