/**
 * Up-and-down arpeggio over 1.5 octaves of the pentatonic, as scale degrees
 * relative to the current register. Gentle contour, no leaps over a fifth.
 */
const PATTERN = [0, 2, 4, 5, 7, 5, 4, 2] as const;

/** Furthest the trend may move the register, in scale degrees. */
export const MAX_REGISTER_SHIFT = 3;

/**
 * How far past the halfway point the trend must go before the register moves.
 * Keeps a price hovering at a rounding boundary from flipping notes back and forth.
 */
const HYSTERESIS = 0.25;

/** Scale degree for arpeggio step `step` with the register moved by `shift` degrees. */
export function arpDegree(step: number, shift: number): number {
  const len = PATTERN.length;
  return (PATTERN[((step % len) + len) % len] as number) + shift;
}

/**
 * Integer register shift following `target` (price vs EMA in spread units),
 * clamped to ±MAX_REGISTER_SHIFT, changing only once `target` is clearly
 * nearer another integer than the current one.
 */
export function stickyShift(current: number, target: number): number {
  const clamped = Math.max(-MAX_REGISTER_SHIFT, Math.min(MAX_REGISTER_SHIFT, target));
  return Math.abs(clamped - current) >= 0.5 + HYSTERESIS ? Math.round(clamped) : current;
}
