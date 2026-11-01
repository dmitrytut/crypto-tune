import { pagePath, pairPageOf } from './pair-pages';
import type { Settings } from './settings';

/** What a clip says about itself: on screen, in the share sheet and as a file. */
export interface ClipShare {
  /** Top line of the clip. */
  pair: string;
  /** Typed from the screen, so it names the pair's page: links in Shorts are not clickable. */
  watermark: string;
  text: string;
  url: string;
  fileName: string;
}

/**
 * Wording and link of a clip of the pair `s` plays, made at `at`. `site` is the site's origin
 * (from the canonical link, the one place it is written). A simulated market says so: a clip
 * must not pass a simulation off as the real one.
 */
export function clipShare(
  site: string,
  s: Pick<Settings, 'source' | 'market' | 'symbol'>,
  at: Date,
): ClipShare {
  const live = s.source === 'live';
  const page = live && s.market === 'usdm' ? pairPageOf(s.symbol) : undefined;
  const host = new URL(site).host;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const name = page?.slug ?? (live ? s.symbol.toLowerCase() : 'simulated');
  return {
    pair: live ? s.symbol : 'Simulated market',
    watermark: page ? `${host}/${page.slug}` : host,
    text: live ? `${s.symbol} live on Crypto Tune` : 'A simulated market on Crypto Tune',
    url: `${new URL(pagePath(page), site).href}?utm_source=clip`,
    fileName: `crypto-tune-${name}-${stamp}.mp4`,
  };
}
