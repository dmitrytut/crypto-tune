export type SourceKind = 'live' | 'simulator';

/** Tonic choices, index = pitch class (0 = C). */
export const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type Tonic = (typeof TONICS)[number];

export interface Settings {
  source: SourceKind;
  /** Exchange symbol, upper case, e.g. BTCUSDT. */
  symbol: string;
  /** Return horizon N, seconds. */
  windowSec: number;
  /** Multiplier on raw tension. */
  sensitivity: number;
  tonic: Tonic;
  /** Base layer (drone + arpeggio) level, dB. */
  baseVolumeDb: number;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'live',
  symbol: 'BTCUSDT',
  windowSec: 10,
  sensitivity: 1,
  tonic: 'A',
  baseVolumeDb: -6,
};

export const LIMITS = {
  windowSec: { min: 2, max: 60, step: 1 },
  sensitivity: { min: 0.25, max: 3, step: 0.05 },
  baseVolumeDb: { min: -40, max: 0, step: 1 },
} as const;

const KEY = 'crypto-tune.settings.v1';

/**
 * Exchange symbol: letters (any script — Binance lists e.g. `币安人生USDT`) and
 * digits only, which also rules out URL separators in the stream path.
 */
export const SYMBOL_PATTERN = /^[\p{L}\p{N}]{2,30}$/u;

const clamp = (v: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, v));

/** Validates untrusted stored data field by field; unknown/invalid fields fall back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    source: o.source === 'live' || o.source === 'simulator' ? o.source : DEFAULT_SETTINGS.source,
    symbol:
      typeof o.symbol === 'string' && SYMBOL_PATTERN.test(o.symbol)
        ? o.symbol
        : DEFAULT_SETTINGS.symbol,
    windowSec: clamp(num(o.windowSec, DEFAULT_SETTINGS.windowSec), LIMITS.windowSec),
    sensitivity: clamp(num(o.sensitivity, DEFAULT_SETTINGS.sensitivity), LIMITS.sensitivity),
    tonic: TONICS.find((t) => t === o.tonic) ?? DEFAULT_SETTINGS.tonic,
    baseVolumeDb: clamp(num(o.baseVolumeDb, DEFAULT_SETTINGS.baseVolumeDb), LIMITS.baseVolumeDb),
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Best effort: storage may be disabled or full; the app keeps running on in-memory settings. */
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('Settings not persisted', err);
  }
}
