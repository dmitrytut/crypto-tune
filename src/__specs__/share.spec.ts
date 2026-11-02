import { describe, expect, it } from 'vitest';
import { shareTexts } from '../share';

const SITE = 'https://crypto-tune.com/';
const AT = new Date(2026, 10, 1, 9, 5);

describe('shareTexts', () => {
  it('points a pair with a page at that page, in the link and on a clip', () => {
    expect(shareTexts(SITE, { source: 'live', market: 'usdm', symbol: 'BTCUSDT' }, AT)).toEqual({
      link: {
        text: 'BTCUSDT live on Crypto Tune',
        url: 'https://crypto-tune.com/bitcoin/?utm_source=share',
      },
      pair: 'BTCUSDT',
      watermark: 'crypto-tune.com/bitcoin',
      fileName: 'crypto-tune-bitcoin-20261101-0905.mp4',
    });
  });

  it('sends a pair without a page, or on COIN-M, to the home page', () => {
    const other = shareTexts(SITE, { source: 'live', market: 'usdm', symbol: 'WIFUSDT' }, AT);
    expect(other.watermark).toBe('crypto-tune.com');
    expect(other.link.url).toBe('https://crypto-tune.com/?utm_source=share');
    expect(other.fileName).toBe('crypto-tune-wifusdt-20261101-0905.mp4');
    const coinm = shareTexts(SITE, { source: 'live', market: 'coinm', symbol: 'BTCUSDT' }, AT);
    expect(coinm.link.url).toBe('https://crypto-tune.com/?utm_source=share');
  });

  it('never passes the simulator off as a real pair', () => {
    const s = shareTexts(SITE, { source: 'simulator', market: 'usdm', symbol: 'BTCUSDT' }, AT);
    expect(s.pair).toBe('Simulated market');
    expect(s.link.text).not.toContain('BTCUSDT');
    expect(s.watermark).toBe('crypto-tune.com');
    expect(s.fileName).toBe('crypto-tune-simulated-20261101-0905.mp4');
  });
});
