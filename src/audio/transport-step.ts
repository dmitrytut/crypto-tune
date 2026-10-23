/**
 * Index of the step at transport tick `ticks` into a cycle of `steps` steps,
 * each `stepTicks` ticks long: rounds to the nearest step (a scheduled
 * callback's tick can be a hair off the exact grid) and wraps into
 * `[0, steps)`. Driven by transport ticks rather than wall-clock time so
 * accents land on the same step after a restart, which replays the
 * transport timeline from 0.
 * @package
 */
export function stepIndex(ticks: number, stepTicks: number, steps: number): number {
  return Math.round(ticks / stepTicks) % steps;
}
