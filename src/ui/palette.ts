import type { LiquidationSide, TradeSide } from '../feed/market-feed';
import { TENSION_LEVELS } from '../metrics/tension';
import { type FlowState, QUIET_FLOW } from './flow';

/**
 * Linear RGB, each channel 0…1.
 * @package
 */
export type Rgb = readonly [number, number, number];

/** Two-tone palettes: [body, highlight]. Calm is a cold steel blue, deliberately not violet. */
const CALM: readonly [Rgb, Rgb] = [
  [0.06, 0.13, 0.24],
  [0.3, 0.5, 0.74],
];
const RISING: readonly [Rgb, Rgb] = [
  [0.03, 0.4, 0.46],
  [0.36, 0.95, 0.86],
];
const FALLING: readonly [Rgb, Rgb] = [
  [0.58, 0.07, 0.38],
  [1, 0.6, 0.25],
];
/** Even a calm market tints toward its direction this much. */
const CALM_TINT = 0.35;
/** Order-flow imbalance alone can carry the colour this far toward a side. */
const FLOW_TINT = 0.75;
/** Fastest vertical drift of the field from one-sided flow, noise units per second. */
const MAX_DRIFT = 0.18;

/**
 * What the aura shader should look like for the current market state.
 * @package
 */
export interface AuraTarget {
  /** Body and highlight colours of the blobs. */
  colorA: Rgb;
  colorB: Rgb;
  /** Flow speed in noise-space units per second. */
  speed: number;
  /** Domain-warp strength: calm blobs are round, tense ones tear. */
  warp: number;
  /** Overall brightness multiplier; busy trading and volume spikes brighten the aura. */
  glow: number;
  /** Vertical offset of the bright mass, −0.25 … 0.25 of screen height; up = price above EMA. */
  shiftY: number;
  /** Vertical drift of the field: buying pressure lifts it, selling sinks it (noise units/s). */
  drift: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clampSigned = (x: number) => Math.max(-1, Math.min(1, x));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Market → aura, in two time scales. Order flow (seconds, no warm-up): who is
 * hitting the book tints and drifts the field, how busy trading is speeds and
 * brightens it. Tension (after warm-up): sustained moves tear the field and
 * saturate the colour; volume spikes brighten; price vs hour EMA lifts the glow.
 * @package
 */
export function auraTarget(
  s: { tension: number; direction: number; volZ: number; emaZ: number },
  flow: FlowState = QUIET_FLOW,
): AuraTarget {
  const { high, peak: full } = TENSION_LEVELS;
  const intensity = clamp01(s.tension / high);
  const peak = clamp01((s.tension - high) / (full - high));
  const lean = clampSigned(
    s.direction * (CALM_TINT + (1 - CALM_TINT) * intensity) + flow.imbalance * FLOW_TINT,
  );
  const toward = lean >= 0 ? RISING : FALLING;
  const mood = Math.abs(lean);
  return {
    colorA: mix(CALM[0], toward[0], mood),
    colorB: mix(CALM[1], toward[1], mood),
    speed: 0.05 + 0.22 * flow.activity + 0.35 * intensity + 0.5 * peak,
    warp: 0.8 + 0.5 * flow.activity + 1.4 * intensity + 1.2 * peak,
    glow: 0.85 + 0.35 * flow.activity + 0.35 * clamp01(s.volZ / 4),
    shiftY: 0.25 * clampSigned(s.emaZ / 3),
    drift: MAX_DRIFT * flow.imbalance * (0.4 + 0.6 * flow.activity),
  };
}

/**
 * The aura of a flat, quiet market: before the first snapshot and after a pair switch.
 * @package
 */
export const CALM_AURA: AuraTarget = auraTarget({ tension: 0, direction: 0, volZ: 0, emaZ: 0 });

/**
 * Meter/chart colour for a tension value: blue calm → amber mid → red high.
 * @package
 */
export function tensionColor(tension: number): Rgb {
  const blue: Rgb = [0.48, 0.64, 0.97];
  const amber: Rgb = [0.88, 0.69, 0.41];
  const red: Rgb = [0.97, 0.46, 0.56];
  const { mid, high } = TENSION_LEVELS;
  if (tension <= mid) return mix(blue, amber, clamp01(tension / mid) * 0.4);
  if (tension <= high) return mix(blue, amber, 0.4 + 0.6 * ((tension - mid) / (high - mid)));
  return mix(amber, red, clamp01((tension - high) / (TENSION_LEVELS.peak - high)));
}

/**
 * CSS colour string for an Rgb with optional alpha.
 * @package
 */
export function css(c: Rgb, alpha = 1): string {
  const b = (x: number) => Math.round(clamp01(x) * 255);
  return `rgba(${b(c[0])}, ${b(c[1])}, ${b(c[2])}, ${alpha})`;
}

/**
 * Side colours shared by particles, waves, chart and CSS (--up/--down): up teal, down magenta.
 * @package
 */
export const UP_COLOR: Rgb = RISING[1];
/** @package */
export const DOWN_COLOR: Rgb = [0.95, 0.3, 0.55];

/**
 * Whether a side pushes price down: an aggressive sell, or a long liquidated (forced sell).
 * @package
 */
export const isDown = (side: TradeSide | LiquidationSide): boolean =>
  side === 'sell' || side === 'long';

/** @package */
export const sideColor = (side: TradeSide | LiquidationSide): Rgb =>
  isDown(side) ? DOWN_COLOR : UP_COLOR;

/** Contrast the stage text keeps over the aura: WCAG AA for normal text. */
const TEXT_CONTRAST = 4.5;
/** Alpha of the readout's dark pool where the text rows sit (styles.css `.hero::before`). */
const POOL_TEXT_ALPHA = 0.8;
/** Luminance resolution of `backdropLuminance`; fine enough near the dark end that matters. */
const LUMINANCE_BINS = 1024;

/** sRGB channel 0…1 → linear light. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Linear light of every 8-bit sRGB channel value. */
const LINEAR_BYTE = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

/**
 * WCAG relative luminance of a colour as it lands on screen: CSS and the aura shader both write
 * these channels straight out as sRGB.
 * @package
 */
export const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/**
 * Luminance that `share` of the pixels stay at or under, from RGBA bytes as `readPixels` returns
 * them: a bright fold under the text counts, a few stray hot pixels do not.
 * @package
 */
export function backdropLuminance(rgba: Uint8Array, share = 0.9): number {
  const count = Math.floor(rgba.length / 4);
  if (count === 0) return 0;
  const bins = new Uint32Array(LUMINANCE_BINS);
  for (let p = 0; p < count * 4; p += 4) {
    const l =
      0.2126 * (LINEAR_BYTE[rgba[p] ?? 0] ?? 0) +
      0.7152 * (LINEAR_BYTE[rgba[p + 1] ?? 0] ?? 0) +
      0.0722 * (LINEAR_BYTE[rgba[p + 2] ?? 0] ?? 0);
    const bin = Math.min(LUMINANCE_BINS - 1, Math.floor(l * LUMINANCE_BINS));
    bins[bin] = (bins[bin] ?? 0) + 1;
  }
  const need = Math.ceil(count * share);
  let seen = 0;
  for (let i = 0; i < LUMINANCE_BINS; i++) {
    seen += bins[i] ?? 0;
    // The bin's upper edge: never reports the backdrop darker than it is.
    if (seen >= need) return (i + 1) / LUMINANCE_BINS;
  }
  return 1;
}

/**
 * How much of the readout's dark pool text of `textLuminance` needs over a backdrop of
 * `backdrop`, 0 (none) … 1 (full): none while it already keeps TEXT_CONTRAST (its text shadow
 * is not counted), then just enough to bring the backdrop down to that. A black veil of alpha a
 * scales sRGB channels by 1 − a, so luminance by about (1 − a)^2.2. Capped at the full pool,
 * which is what the CSS draws.
 * @package
 */
export function poolStrength(backdrop: number, textLuminance: number): number {
  const limit = (textLuminance + 0.05) / TEXT_CONTRAST - 0.05;
  if (backdrop <= limit) return 0;
  // Text too dark to keep the contrast even over black: the most the pool can do.
  if (limit <= 0) return 1;
  const alpha = 1 - (limit / backdrop) ** (1 / 2.2);
  return Math.min(1, alpha / POOL_TEXT_ALPHA);
}
