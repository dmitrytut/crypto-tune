import { pagePath, pairPageOf } from './pair-pages';
import type { Settings } from './settings';

/** What the Share dialog says about the pair being played: the link, and a clip's words. */
export interface ShareTexts {
  /** The pair's page (or the home page) tagged `?utm_source=share`, with a line to go with it. */
  link: { text: string; url: string };
  /** Top line of a clip. */
  pair: string;
  /** Typed from a clip, so it names the pair's page: links in Shorts are not clickable. */
  watermark: string;
  fileName: string;
}

/**
 * Words for sharing the pair `s` plays, at `at`. `site` is the site's origin (from the canonical
 * link, the one place it is written). A simulated market says so: a share must not pass a
 * simulation off as the real one.
 */
export function shareTexts(
  site: string,
  s: Pick<Settings, 'source' | 'market' | 'symbol'>,
  at: Date,
): ShareTexts {
  const live = s.source === 'live';
  const page = live && s.market === 'usdm' ? pairPageOf(s.symbol) : undefined;
  const host = new URL(site).host;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const name = page?.slug ?? (live ? s.symbol.toLowerCase() : 'simulated');
  return {
    link: {
      text: live ? `${s.symbol} live on Crypto Tune` : 'A simulated market on Crypto Tune',
      url: `${new URL(pagePath(page), site).href}?utm_source=share`,
    },
    pair: live ? s.symbol : 'Simulated market',
    watermark: page ? `${host}/${page.slug}` : host,
    fileName: `crypto-tune-${name}-${stamp}.mp4`,
  };
}
