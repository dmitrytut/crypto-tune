/**
 * Arpeggio contours as scale degrees relative to the current register, one
 * 8-step phrase each. `calm` rocks up and down over 1.5 octaves; `up` and
 * `down` run stepwise through the same span so a directional move is audible.
 */
const PATTERNS = {
  calm: [0, 2, 4, 5, 7, 5, 4, 2],
  up: [0, 1, 2, 3, 4, 5, 6, 7],
  down: [7, 6, 5, 4, 3, 2, 1, 0],
} as const;

export type Contour = keyof typeof PATTERNS;

/** Steps per phrase; contour switches land on phrase boundaries. */
export const PHRASE_STEPS = 8;

/** Furthest the trend may move the register, in scale degrees. */
export const MAX_REGISTER_SHIFT = 3;

/**
 * How far past the halfway point the trend must go before the register moves.
 * Keeps a price hovering at a rounding boundary from flipping notes back and forth.
 */
const HYSTERESIS = 0.25;

/** Scale degree for arpeggio step `step` of `contour`, with the register moved by `shift` degrees. */
export function arpDegree(step: number, shift: number, contour: Contour = 'calm'): number {
  const pattern = PATTERNS[contour];
  const i = ((step % PHRASE_STEPS) + PHRASE_STEPS) % PHRASE_STEPS;
  return (pattern[i] as number) + shift;
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
