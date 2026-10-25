import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../settings';

describe('parseSettings', () => {
  it('reads settings stored before markets existed as USDⓈ-M', () => {
    expect(parseSettings({ symbol: 'ETHUSDT' })).toMatchObject({
      market: 'usdm',
      symbol: 'ETHUSDT',
    });
  });

  it("falls back to the stored market's default pair", () => {
    expect(parseSettings({ market: 'coinm', symbol: 'bad/symbol' }).symbol).toBe('BTCUSD_PERP');
    expect(parseSettings({ market: 'spot' }).market).toBe(DEFAULT_SETTINGS.market);
  });
});
