/** Below this std a z-score is meaningless (flat series); report 0 instead of ±∞. */
const MIN_STD = 1e-12;

export function zScore(x: number, mean: number, std: number): number {
  return std > MIN_STD ? (x - mean) / std : 0;
}

/**
 * One step of exponential smoothing with separate coefficients for rising
 * (`attack`) and falling (`release`) targets. k ∈ [0, 1]; 1 = jump to target.
 */
export function asymSmooth(prev: number, target: number, attack: number, release: number): number {
  const k = target > prev ? attack : release;
  return prev + k * (target - prev);
}
