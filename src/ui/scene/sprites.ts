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

/** Soap film opacity across the radius: nearly clear inside, a thin sharp rim. */
const FILM_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0.04],
  [0.72, 0.064],
  [0.9, 0.22],
  [0.958, 0.8],
  [0.978, 0.95],
  [0.993, 0.2],
  [1, 0],
];
/** Interference colours of a thin soap film, round the rim from the upper left. */
const FILM_HUES: readonly Rgb[] = [
  [1, 0.35, 0.8],
  [1, 0.8, 0.3],
  [0.45, 1, 0.5],
  [0.25, 0.85, 1],
  [0.6, 0.4, 1],
  [1, 0.35, 0.8],
];
/** How strongly the film colours tint the side colour; low, so a buy still reads teal. */
const FILM_HUE_ALPHA = 0.5;
/** Faint swirls of film colour inside: offset from centre and radius (share of the radius). */
const FILM_SWIRLS: readonly { dx: number; dy: number; r: number; c: Rgb; alpha: number }[] = [
  { dx: -0.2, dy: -0.45, r: 0.6, c: [1, 0.45, 0.85], alpha: 0.22 },
  { dx: 0.35, dy: 0.3, r: 0.55, c: [1, 0.85, 0.4], alpha: 0.18 },
  { dx: -0.35, dy: 0.35, r: 0.5, c: [0.4, 1, 0.65], alpha: 0.15 },
];

/**
 * Soap bubble: a nearly clear film with a thin rim in the side colour, faint interference
 * colours, a window-shaped glint up-left and the light passing through on the far inner wall.
 * Reads as "rising, light".
 * @package
 */
export function bubbleSprite(c: Rgb): HTMLCanvasElement {
  const s = radialSprite(FILM_PROFILE.map(([at, alpha]) => [at, css(c, alpha)] as const));
  const g = s.getContext('2d');
  if (!g) return s;
  const h = SPRITE_PX / 2;
  // Film colours tint only what is already drawn: the rim stays the shape.
  g.globalCompositeOperation = 'source-atop';
  // Engines without conic gradients (Safari < 16.1, Firefox < 112) keep the swirls only.
  if (typeof g.createConicGradient === 'function') {
    const wheel = g.createConicGradient(-0.6, h, h);
    FILM_HUES.forEach((hue, i) => {
      wheel.addColorStop(i / (FILM_HUES.length - 1), css(hue));
    });
    g.globalAlpha = FILM_HUE_ALPHA;
    g.fillStyle = wheel;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    g.globalAlpha = 1;
  }
  for (const w of FILM_SWIRLS) {
    const x = h + w.dx * h;
    const y = h + w.dy * h;
    const swirl = g.createRadialGradient(x, y, 0, x, y, w.r * h);
    swirl.addColorStop(0, css(w.c, w.alpha));
    swirl.addColorStop(1, css(w.c, 0));
    g.fillStyle = swirl;
    g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  }
  g.globalCompositeOperation = 'source-over';
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
