import type { LiquidationSide, TradeSide } from '../feed/market-feed';

/** Size range above the threshold that spans quiet → full velocity: 100×. */
const VELOCITY_DECADES = 2;
const MIN_VELOCITY = 0.35;

/**
 * Loudness from size (notional in multiples of the threshold) on a log scale:
 * MIN_VELOCITY at the threshold, 1 at 100× and above. Log because notionals
 * span orders of magnitude.
 * @package
 */
export function eventVelocity(size: number): number {
  const decades = Math.log10(size) / VELOCITY_DECADES;
  return MIN_VELOCITY + (1 - MIN_VELOCITY) * Math.min(1, Math.max(0, decades));
}

/**
 * Where a voice sits: scale degree from the tonic in `octave`, and stereo position.
 * @package
 */
export interface VoicePlacement {
  octave: number;
  degree: number;
  /** −1 left … 1 right. */
  pan: number;
}

/**
 * Long liquidations (forced sells, price falling) strike a low tonic gong;
 * short liquidations (forced buys, price rising) a bell on the fifth an octave up.
 * @package
 */
export const LIQUIDATION_VOICES: Record<LiquidationSide, VoicePlacement> = {
  long: { octave: 2, degree: 0, pan: 0 },
  short: { octave: 3, degree: 3, pan: 0 },
};

/**
 * Aggressive buys pluck high on the right, sells lower on the left; both sit above the arpeggio.
 * @package
 */
export const TRADE_VOICES: Record<TradeSide, VoicePlacement> = {
  buy: { octave: 4, degree: 2, pan: 0.35 },
  sell: { octave: 4, degree: -2, pan: -0.35 },
};
