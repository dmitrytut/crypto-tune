import { BINANCE_MARKETS } from './feed/binance';
import { pagePath, pairPageOf } from './pair-pages';
import { type Settings, SYMBOL_PATTERN } from './settings';
import type { StreamOptions } from './ui/app';

/**
 * What the address asks for, and where it goes once the pair changes. A pair page (`/bitcoin/`,
 * `pair-pages.ts`) or `?pair=SYMBOL` (`&market=coinm` for COIN-M) opens a pair; `?pair=` wins.
 * `?obs` turns on stream mode (an OBS browser source, a TV): the music starts without a press where
 * the browser allows it, the readouts stay on screen and only the controls fade. With it:
 * - `layout=audio`: sound only, nothing drawn on a transparent page;
 * - `aura=on|off`: draw the aura even on software WebGL (a server without a GPU), or never;
 * - `fps=10…60`: cap the scene's frame rate (a server encoding the picture itself).
 */
const FPS = { min: 10, max: 60 } as const;
const PAIR_PARAM = 'pair';
const MARKET_PARAM = 'market';

type Pair = Pick<Settings, 'source' | 'market' | 'symbol'>;

/** Stream mode from the address; null without `?obs`. Unknown values fall back to the defaults. */
export function streamOptionsOf(params: URLSearchParams): StreamOptions | null {
  if (!params.has('obs')) return null;
  const aura = params.get('aura');
  const fps = Number(params.get('fps'));
  return {
    layout: params.get('layout') === 'audio' ? 'audio' : 'full',
    aura: aura === 'on' || aura === 'off' ? aura : 'auto',
    maxFps: Number.isInteger(fps) && fps >= FPS.min && fps <= FPS.max ? fps : null,
  };
}

/** The pair `?pair=` asks for; null when it names none or a malformed one. */
export function pairParamOf(params: URLSearchParams): Pick<Settings, 'market' | 'symbol'> | null {
  const symbol = params.get(PAIR_PARAM)?.toUpperCase();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) return null;
  const market = BINANCE_MARKETS.find((m) => m === params.get(MARKET_PARAM)) ?? 'usdm';
  return { market, symbol };
}

/**
 * The address once the user picks `s`: its pair page (`/` for a pair without one), so a reload or
 * a copied link opens it, without the `?pair=` the old pair came by (a reload must not undo the
 * pick) and with the rest (`?obs`, UTM) as it was. Null when the address already is that.
 */
export function addressAfterPick(s: Pair, at: { pathname: string; search: string }): string | null {
  const page = s.source === 'live' && s.market === 'usdm' ? pairPageOf(s.symbol) : undefined;
  const path = pagePath(page);
  const params = new URLSearchParams(at.search);
  let search = at.search;
  if (params.has(PAIR_PARAM) || params.has(MARKET_PARAM)) {
    params.delete(PAIR_PARAM);
    params.delete(MARKET_PARAM);
    const rest = params.toString();
    search = rest ? `?${rest}` : '';
  }
  return path === at.pathname && search === at.search ? null : path + search;
}
