import type { LiquidationSide, TradeSide } from '../feed/market-feed';
import { TENSION_LEVELS } from '../metrics/tension';
import { type FlowState, QUIET_FLOW } from './flow';

/**
 * Linear RGB, each channel 0…1.
 * @package
 */
export type Rgb = readonly [number, number, number];

/** Two-tone palettes: [body, highlight]. */
const CALM: readonly [Rgb, Rgb] = [
  [0.2, 0.11, 0.5],
  [0.52, 0.3, 0.92],
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
