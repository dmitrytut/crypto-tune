import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../settings';

describe('parseSettings', () => {
  it('requires an explicit boolean opt-in for interaction sounds in saved settings', () => {
    expect(parseSettings({ interactionSound: true }).interactionSound).toBe(true);
    expect(parseSettings({ interactionSound: false }).interactionSound).toBe(false);
    for (const interactionSound of [undefined, null, 'true', 1, {}, []]) {
      expect(parseSettings({ interactionSound }).interactionSound).toBe(false);
    }
  });

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

  it('preserves an emptied market and defaults only the missing market', () => {
    const favorites = parseSettings({ favorites: { usdm: [] } }).favorites;
    expect(favorites.usdm).toEqual([]);
    expect(favorites.coinm).toEqual(['BTCUSD_PERP', 'ETHUSD_PERP', 'SOLUSD_PERP']);
    expect(parseSettings(JSON.parse(JSON.stringify({ favorites }))).favorites).toEqual(favorites);
  });

  it('filters invalid favorites and duplicates without replacing valid choices', () => {
    expect(
      parseSettings({
        favorites: { usdm: ['SOLUSDT', 'bad/symbol', null, 'SOLUSDT'], coinm: [] },
      }).favorites,
    ).toEqual({ usdm: ['SOLUSDT'], coinm: [] });
  });
});
