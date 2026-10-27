import { DOWN_COLOR, mix, type Rgb } from '../palette';

/**
 * A spark thrown by a drop hitting the floor: launch velocity px/s and lifetime.
 * @package
 */
export interface Spark {
  vx: number;
  vy: number;
  lifeSec: number;
}

/** Spark count of the biggest drops; a cascade must stay cheap. */
const MAX_SPARKS = 14;
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
 * Sparks of a drop of radius `r` hitting the floor, like hot metal: thrown low and up to both
 * sides, more of them and higher for bigger drops.
 * @package
 */
export function floorSparks(r: number, rand: () => number): Spark[] {
  const n = Math.min(MAX_SPARKS, 4 + Math.round(r / 3));
  return Array.from({ length: n }, () => ({
    vx: (rand() < 0.5 ? -1 : 1) * (50 + 150 * rand()),
    vy: -(30 + 100 * rand()) * (0.6 + r / 15),
    lifeSec: 0.9 + 0.6 * rand(),
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
