import { describe, expect, it } from 'vitest';
import { clipShare } from '../clip-share';

const SITE = 'https://crypto-tune.com/';
const AT = new Date(2026, 10, 1, 9, 5);

describe('clipShare', () => {
  it('points a pair with a page at that page, on screen and in the link', () => {
    const c = clipShare(SITE, { source: 'live', market: 'usdm', symbol: 'BTCUSDT' }, AT);
    expect(c).toEqual({
      pair: 'BTCUSDT',
      watermark: 'crypto-tune.com/bitcoin',
      caption: 'BTCUSDT live on Crypto Tune https://crypto-tune.com/bitcoin/?utm_source=clip',
      fileName: 'crypto-tune-bitcoin-20261101-0905.mp4',
    });
  });

  it('sends a pair without a page, or on COIN-M, to the home page', () => {
    const other = clipShare(SITE, { source: 'live', market: 'usdm', symbol: 'WIFUSDT' }, AT);
    expect(other.watermark).toBe('crypto-tune.com');
    expect(other.caption).toBe(
      'WIFUSDT live on Crypto Tune https://crypto-tune.com/?utm_source=clip',
    );
    expect(other.fileName).toBe('crypto-tune-wifusdt-20261101-0905.mp4');
    const coinm = clipShare(SITE, { source: 'live', market: 'coinm', symbol: 'BTCUSDT' }, AT);
    expect(coinm.caption).toContain('https://crypto-tune.com/?utm_source=clip');
  });

  it('never passes the simulator off as a real pair', () => {
    const c = clipShare(SITE, { source: 'simulator', market: 'usdm', symbol: 'BTCUSDT' }, AT);
    expect(c.pair).toBe('Simulated market');
    expect(c.caption).not.toContain('BTCUSDT');
    expect(c.watermark).toBe('crypto-tune.com');
    expect(c.fileName).toBe('crypto-tune-simulated-20261101-0905.mp4');
  });
});
