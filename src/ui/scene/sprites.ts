import { css, type Rgb } from '../palette';

/** Edge of every sprite, px: drawn once, scaled per particle. */
const SPRITE_PX = 128;

/** A sprite square filled with a radial gradient through `stops` (offset, CSS colour). */
function radialSprite(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = SPRITE_PX;
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/**
 * Soap bubble: clear centre, bright rim, specular glint. Reads as "rising, light".
 * @package
 */
export function bubbleSprite(c: Rgb): HTMLCanvasElement {
  const s = radialSprite([
    [0, css(c, 0.16)],
    [0.62, css(c, 0.22)],
    [0.84, css(c, 0.95)],
    [0.92, css(c, 0.4)],
    [1, css(c, 0)],
  ]);
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  const glint = g.createRadialGradient(h * 0.68, h * 0.62, 0, h * 0.68, h * 0.62, h * 0.24);
  glint.addColorStop(0, 'rgba(255,255,255,0.9)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return s;
}

/**
 * Ember drop: hot white core in a coloured glow. Reads as "falling, heavy".
 * @package
 */
export const dropSprite = (c: Rgb) =>
  radialSprite([
    [0, 'rgba(255,255,255,0.95)'],
    [0.22, css(c, 0.95)],
    [0.55, css(c, 0.35)],
    [1, css(c, 0)],
  ]);

/** @package */
export const haloSprite = (c: Rgb) =>
  radialSprite([
    [0, css(c, 0.5)],
    [0.4, css(c, 0.16)],
    [1, css(c, 0)],
  ]);
