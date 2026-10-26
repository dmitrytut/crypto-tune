import { BINANCE_MARKETS, type BinanceMarket } from './feed/binance';
import { DEFAULT_METRICS_CONFIG } from './metrics/engine';
import { HISTORY_PERIODS_MIN, type HistoryPeriodMin } from './metrics/history';
import { DEFAULT_TENSION_PARAMS } from './metrics/tension';

export type SourceKind = 'live' | 'simulator';

/** Tonic choices, index = pitch class (0 = C). */
export const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type Tonic = (typeof TONICS)[number];

export interface Settings {
  source: SourceKind;
  /** Binance futures market the live pair trades on. */
  market: BinanceMarket;
  /** Exchange symbol of `market`, upper case, e.g. BTCUSDT or BTCUSD_PERP. */
  symbol: string;
  /** Pinned pairs, independent for each futures market. An empty list stays empty. */
  favorites: Record<BinanceMarket, readonly string[]>;
  /** Return horizon N, seconds. */
  windowSec: number;
  /** Multiplier on raw tension. */
  sensitivity: number;
  tonic: Tonic;
  /** Base layer (drone + arpeggio) level, dB. */
  baseVolumeDb: number;
  /** Tension layer (sub, percussion, riser) level, dB. */
  tensionVolumeDb: number;
  /** Event voices (liquidation gongs, trade accents) level, dB. */
  eventsVolumeDb: number;
  /** Liquidations at or above this quote notional sound, USD. */
  liqThresholdUsd: number;
  /** Aggressive trades at or above this quote notional sound, USD. */
  tradeThresholdUsd: number;
  /** Span of the price change, volume readout and chart, minutes. */
  periodMin: HistoryPeriodMin;
}

/** Each market's first pair, and the fallback for a stored symbol that does not validate. */
const DEFAULT_SYMBOLS: Record<BinanceMarket, string> = {
  usdm: 'BTCUSDT',
  coinm: 'BTCUSD_PERP',
};

export const DEFAULT_SETTINGS: Settings = {
  source: 'live',
  market: 'usdm',
  symbol: DEFAULT_SYMBOLS.usdm,
  favorites: {
    usdm: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    coinm: ['BTCUSD_PERP', 'ETHUSD_PERP', 'SOLUSD_PERP'],
  },
  // The metrics own these defaults; settings only persist the user's override.
  windowSec: DEFAULT_METRICS_CONFIG.windowSec,
  sensitivity: DEFAULT_TENSION_PARAMS.sensitivity,
  tonic: 'A',
  baseVolumeDb: -6,
  tensionVolumeDb: -6,
  eventsVolumeDb: -6,
  liqThresholdUsd: 20_000,
  tradeThresholdUsd: 200_000,
  periodMin: 15,
};

export const LIMITS = {
  windowSec: { min: 2, max: 60, step: 1 },
  sensitivity: { min: 0.25, max: 3, step: 0.05 },
  layerVolumeDb: { min: -40, max: 0, step: 1 },
  /** Notional thresholds span orders of magnitude; the UI slides them on a log scale. */
  liqThresholdUsd: { min: 1_000, max: 1_000_000 },
  tradeThresholdUsd: { min: 10_000, max: 10_000_000 },
} as const;

const KEY = 'crypto-tune.settings.v1';

/**
 * Exchange symbol: letters (any script — Binance lists e.g. `币安人生USDT`), digits and `_`
 * (COIN-M `BTCUSD_PERP`) only, which also rules out URL separators in the stream path.
 */
export const SYMBOL_PATTERN = /^[\p{L}\p{N}_]{2,30}$/u;

const clamp = (v: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, v));

/** Validates untrusted stored data field by field; unknown/invalid fields fall back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const market = BINANCE_MARKETS.find((m) => m === o.market) ?? DEFAULT_SETTINGS.market;
  const storedFavorites =
    o.favorites && typeof o.favorites === 'object' ? (o.favorites as Record<string, unknown>) : {};
  const favorites = (of: BinanceMarket): string[] => {
    const values = storedFavorites[of];
    if (!Array.isArray(values)) return [...DEFAULT_SETTINGS.favorites[of]];
    return [
      ...new Set(
        values.filter((v): v is string => typeof v === 'string' && SYMBOL_PATTERN.test(v)),
      ),
    ];
  };
  return {
    source: o.source === 'live' || o.source === 'simulator' ? o.source : DEFAULT_SETTINGS.source,
    market,
    favorites: { usdm: favorites('usdm'), coinm: favorites('coinm') },
    symbol:
      typeof o.symbol === 'string' && SYMBOL_PATTERN.test(o.symbol)
        ? o.symbol
        : DEFAULT_SYMBOLS[market],
    windowSec: clamp(num(o.windowSec, DEFAULT_SETTINGS.windowSec), LIMITS.windowSec),
    sensitivity: clamp(num(o.sensitivity, DEFAULT_SETTINGS.sensitivity), LIMITS.sensitivity),
    tonic: TONICS.find((t) => t === o.tonic) ?? DEFAULT_SETTINGS.tonic,
    baseVolumeDb: clamp(num(o.baseVolumeDb, DEFAULT_SETTINGS.baseVolumeDb), LIMITS.layerVolumeDb),
    tensionVolumeDb: clamp(
      num(o.tensionVolumeDb, DEFAULT_SETTINGS.tensionVolumeDb),
      LIMITS.layerVolumeDb,
    ),
    eventsVolumeDb: clamp(
      num(o.eventsVolumeDb, DEFAULT_SETTINGS.eventsVolumeDb),
      LIMITS.layerVolumeDb,
    ),
    liqThresholdUsd: clamp(
      num(o.liqThresholdUsd, DEFAULT_SETTINGS.liqThresholdUsd),
      LIMITS.liqThresholdUsd,
    ),
    tradeThresholdUsd: clamp(
      num(o.tradeThresholdUsd, DEFAULT_SETTINGS.tradeThresholdUsd),
      LIMITS.tradeThresholdUsd,
    ),
    periodMin: HISTORY_PERIODS_MIN.find((p) => p === o.periodMin) ?? DEFAULT_SETTINGS.periodMin,
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
