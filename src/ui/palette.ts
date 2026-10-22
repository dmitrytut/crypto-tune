import { TENSION_LEVELS } from '../metrics/tension';

/** Linear RGB, each channel 0…1. */
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
/** Tension above `high` at which the aura is at full turbulence. */
const PEAK_SPAN = 1.5;

/** What the aura shader should look like for the current market state. */
export interface AuraTarget {
  /** Body and highlight colours of the blobs. */
  colorA: Rgb;
  colorB: Rgb;
  /** Flow speed in noise-space units per second. */
  speed: number;
  /** Domain-warp strength: calm blobs are round, tense ones tear. */
  warp: number;
  /** Overall brightness multiplier; volume spikes brighten the aura. */
  glow: number;
  /** Vertical offset of the bright mass, −0.25 … 0.25 of screen height; up = price above EMA. */
  shiftY: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Market → aura. Tension drives motion (speed, tearing), direction drives
 * colour (teal rising, magenta/amber falling, indigo calm), volume spikes
 * drive brightness, and the price vs its hour EMA lifts or sinks the glow.
 */
export function auraTarget(s: {
  tension: number;
  direction: number;
  volZ: number;
  emaZ: number;
}): AuraTarget {
  const intensity = clamp01(s.tension / TENSION_LEVELS.high);
  const peak = clamp01((s.tension - TENSION_LEVELS.high) / PEAK_SPAN);
  const mood = clamp01(Math.abs(s.direction) * (CALM_TINT + (1 - CALM_TINT) * intensity));
  const toward = s.direction >= 0 ? RISING : FALLING;
  return {
    colorA: mix(CALM[0], toward[0], mood),
    colorB: mix(CALM[1], toward[1], mood),
    speed: 0.04 + 0.35 * intensity + 0.5 * peak,
    warp: 0.8 + 1.4 * intensity + 1.2 * peak,
    glow: 0.95 + 0.45 * clamp01(s.volZ / 4),
    shiftY: 0.25 * Math.max(-1, Math.min(1, s.emaZ / 3)),
  };
}

/** Meter/chart colour for a tension value: blue calm → amber mid → red high. */
export function tensionColor(tension: number): Rgb {
  const blue: Rgb = [0.48, 0.64, 0.97];
  const amber: Rgb = [0.88, 0.69, 0.41];
  const red: Rgb = [0.97, 0.46, 0.56];
  const { mid, high } = TENSION_LEVELS;
  if (tension <= mid) return mix(blue, amber, clamp01(tension / mid) * 0.4);
  if (tension <= high) return mix(blue, amber, 0.4 + 0.6 * ((tension - mid) / (high - mid)));
  return mix(amber, red, clamp01((tension - high) / PEAK_SPAN));
}

/** CSS colour string for an Rgb with optional alpha. */
export function css(c: Rgb, alpha = 1): string {
  const b = (x: number) => Math.round(clamp01(x) * 255);
  return `rgba(${b(c[0])}, ${b(c[1])}, ${b(c[2])}, ${alpha})`;
}

/** Side colours shared by particles, waves and chart: up-moving teal, down-moving magenta. */
export const UP_COLOR: Rgb = RISING[1];
export const DOWN_COLOR: Rgb = [0.95, 0.3, 0.55];
