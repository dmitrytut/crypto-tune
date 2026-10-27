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

/** Bubble opacity across the radius: clear inside, a thin sharp rim. */
const GLASS_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.03],
  [0.72, 0.048],
  [0.9, 0.22],
  [0.958, 0.8],
  [0.978, 0.95],
  [0.993, 0.2],
  [1, 0],
];

/**
 * Glass bubble: clear inside, a thin rim in the side colour, a window-shaped glint up-left and
 * the light passing through on the far inner wall. Reads as "rising, light".
 * @package
 */
export function bubbleSprite(c: Rgb): HTMLCanvasElement {
  const s = radialSprite(GLASS_PROFILE.map(([at, alpha]) => [at, css(c, alpha)] as const));
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  // Window glint: a soft slanted slab, the reflection of the light source.
  g.save();
  g.translate(h * 0.6, h * 0.56);
  g.rotate(-0.8);
  g.scale(1, 0.42);
  const glint = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.34);
  glint.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  glint.addColorStop(0.55, 'rgba(255, 255, 255, 0.55)');
  glint.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = glint;
  g.beginPath();
  g.arc(0, 0, h * 0.34, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Light passing through the bubble: a dim crescent on the far inner wall.
  g.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  g.lineWidth = h * 0.09;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(h, h, h * 0.8, 0.12 * Math.PI, 0.42 * Math.PI);
  g.stroke();
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
