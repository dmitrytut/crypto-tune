import { describe, expect, it } from 'vitest';
import { addressAfterPick, pairParamOf, streamOptionsOf } from '../address';

const q = (search: string) => new URLSearchParams(search);
const live = (symbol: string, market: 'usdm' | 'coinm' = 'usdm') =>
  ({ source: 'live', market, symbol }) as const;

describe('streamOptionsOf', () => {
  it('is off without ?obs, whatever else the address carries', () => {
    expect(streamOptionsOf(q('?layout=audio&aura=on&fps=30'))).toBeNull();
  });

  it('defaults to the full scene, the automatic aura and no frame cap', () => {
    expect(streamOptionsOf(q('?obs'))).toEqual({ layout: 'full', aura: 'auto', maxFps: null });
  });

  it('takes the layout, aura and frame cap it knows', () => {
    expect(streamOptionsOf(q('?obs&layout=audio&aura=on&fps=30'))).toEqual({
      layout: 'audio',
      aura: 'on',
      maxFps: 30,
    });
    expect(streamOptionsOf(q('?obs&aura=off'))?.aura).toBe('off');
  });

  it('falls back to the defaults for unknown or out-of-range values', () => {
    expect(streamOptionsOf(q('?obs&layout=overlay&aura=yes&fps=5'))).toEqual({
      layout: 'full',
      aura: 'auto',
      maxFps: null,
    });
    expect(streamOptionsOf(q('?obs&fps=61'))?.maxFps).toBeNull();
    expect(streamOptionsOf(q('?obs&fps=29.5'))?.maxFps).toBeNull();
    expect(streamOptionsOf(q('?obs&fps=10'))?.maxFps).toBe(10);
  });
});

describe('pairParamOf', () => {
  it('reads a USDⓈ-M pair in any case', () => {
    expect(pairParamOf(q('?pair=ethusdt'))).toEqual({ market: 'usdm', symbol: 'ETHUSDT' });
  });

  it('reads a COIN-M pair with its market, and treats an unknown market as USDⓈ-M', () => {
    expect(pairParamOf(q('?pair=BTCUSD_PERP&market=coinm'))).toEqual({
      market: 'coinm',
      symbol: 'BTCUSD_PERP',
    });
    expect(pairParamOf(q('?pair=SOLUSDT&market=spot'))?.market).toBe('usdm');
  });

  it('ignores a missing or malformed symbol', () => {
    expect(pairParamOf(q('?obs'))).toBeNull();
    expect(pairParamOf(q('?pair=BTC/USDT'))).toBeNull();
    expect(pairParamOf(q('?pair=X'))).toBeNull();
  });
});

describe('addressAfterPick', () => {
  it('moves to the pair page and drops the pair the old one came by, keeping the rest', () => {
    const at = { pathname: '/', search: '?obs&pair=SOLUSDT&utm_source=youtube' };
    expect(addressAfterPick(live('ETHUSDT'), at)).toBe('/ethereum/?obs=&utm_source=youtube');
  });

  it('goes home for a pair without a page, a COIN-M pair or the simulator', () => {
    const at = { pathname: '/bitcoin/', search: '?obs' };
    expect(addressAfterPick(live('TRXUSDT'), at)).toBe('/?obs');
    expect(addressAfterPick(live('BTCUSD_PERP', 'coinm'), at)).toBe('/?obs');
    expect(addressAfterPick({ source: 'simulator', market: 'usdm', symbol: 'BTCUSDT' }, at)).toBe(
      '/?obs',
    );
  });

  it('leaves an address that already fits untouched, its query spelled as it was', () => {
    expect(addressAfterPick(live('BTCUSDT'), { pathname: '/bitcoin/', search: '?obs' })).toBeNull();
    expect(addressAfterPick(live('TRXUSDT'), { pathname: '/', search: '' })).toBeNull();
  });

  it('drops a lone pair parameter without leaving a bare question mark', () => {
    expect(addressAfterPick(live('TRXUSDT'), { pathname: '/', search: '?pair=TRXUSDT' })).toBe('/');
  });
});
