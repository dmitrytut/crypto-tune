/**
 * A droplet thrown by a popping bubble: launch velocity px/s, lifetime and radius.
 * @package
 */
export interface Droplet {
  vx: number;
  vy: number;
  lifeSec: number;
  sizePx: number;
}

/** Bubbles pop between these shares of the screen height, from the top. */
const POP_TOP = 0.08;
const POP_BOTTOM = 0.45;
/** Droplets per px² of bubble area: the count follows the size, so a whale bursts in a shower. */
const DROPLETS_PER_PX2 = 1 / 30;
/** Fewest droplets (the smallest bubbles) and most (the biggest); a cascade must stay cheap. */
const MIN_DROPLETS = 3;
const MAX_DROPLETS = 28;

/**
 * Where a buy bubble pops, CSS px from the top: a random height in the upper part of the screen,
 * always above where bubbles are born.
 * @package
 */
export function popHeight(h: number, rand: () => number): number {
  return h * (POP_TOP + (POP_BOTTOM - POP_TOP) * rand());
}

/**
 * The spray of a bubble of radius `r` popping: droplets spread all round, as many as its area
 * (3 for the smallest bubbles, up to 28) and faster for bigger bubbles.
 * @package
 */
export function popDroplets(r: number, rand: () => number): Droplet[] {
  const n = Math.min(MAX_DROPLETS, Math.max(MIN_DROPLETS, Math.round(r * r * DROPLETS_PER_PX2)));
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + rand() * 0.8) / n) * Math.PI * 2;
    const v = (70 + 90 * rand()) * (1 + r / 30);
    return {
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      lifeSec: 0.5 + 0.35 * rand(),
      sizePx: 1 + 0.8 * rand() + 0.04 * r,
    };
  });
}
