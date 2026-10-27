import { DOWN_COLOR, mix, type Rgb } from '../palette';

/**
 * A spark thrown by a drop hitting the price line: launch velocity px/s and cooling time.
 * @package
 */
export interface Spark {
  vx: number;
  vy: number;
  lifeSec: number;
}

/** Sparks per px² of drop area: the count follows the mass, so a whale throws a shower. */
const SPARKS_PER_PX2 = 1 / 30;
/** Fewest sparks (the smallest drops) and most (the biggest); a cascade must stay cheap. */
const MIN_SPARKS = 2;
const MAX_SPARKS = 28;
/** White-hot at the impact. */
const SPARK_HOT: Rgb = [1, 0.88, 0.92];
/**
 * A cold spark: dark crimson, still faintly lit.
 * @package
 */
export const SPARK_ASH: Rgb = [0.47, 0.08, 0.08];
/** Share of a spark's life spent going from white-hot to the sell colour; the rest cools to ash. */
const HOT_SHARE = 0.3;

/**
 * Sparks of a drop of radius `r` hitting the price line, like hot metal: thrown low and up to
 * both sides, as many as its area (2 for the smallest drops, up to 28) and higher for bigger
 * drops; they bounce and roll along the line.
 * @package
 */
export function floorSparks(r: number, rand: () => number): Spark[] {
  const n = Math.min(MAX_SPARKS, Math.max(MIN_SPARKS, Math.round(r * r * SPARKS_PER_PX2)));
  return Array.from({ length: n }, () => ({
    vx: (rand() < 0.5 ? -1 : 1) * (50 + 150 * rand()),
    vy: -(30 + 100 * rand()) * (0.6 + r / 15),
    lifeSec: 1.1 + 0.6 * rand(),
  }));
}

/**
 * Colour of a spark at `t` = share of its life lived: white-hot → sell colour → ash.
 * @package
 */
export function sparkColor(t: number): Rgb {
  return t < HOT_SHARE
    ? mix(SPARK_HOT, DOWN_COLOR, t / HOT_SHARE)
    : mix(DOWN_COLOR, SPARK_ASH, (t - HOT_SHARE) / (1 - HOT_SHARE));
}
