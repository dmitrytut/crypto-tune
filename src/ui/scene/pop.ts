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
/** Spray of the biggest bubbles; a cascade of pops must stay cheap. */
const MAX_DROPLETS = 18;

/**
 * Where a buy bubble pops, CSS px from the top: a random height in the upper part of the screen,
 * always above where bubbles are born.
 * @package
 */
export function popHeight(h: number, rand: () => number): number {
  return h * (POP_TOP + (POP_BOTTOM - POP_TOP) * rand());
}

/**
 * The spray of a bubble of radius `r` popping: droplets spread all round, more of them and faster
 * for bigger bubbles.
 * @package
 */
export function popDroplets(r: number, rand: () => number): Droplet[] {
  const n = Math.min(MAX_DROPLETS, Math.round(6 + 0.4 * r));
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
