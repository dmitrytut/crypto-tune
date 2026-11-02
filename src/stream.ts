import { BINANCE_MARKETS } from './feed/binance';
import { type Settings, SYMBOL_PATTERN } from './settings';
import type { StreamOptions } from './ui/app';

/**
 * Address parameters for broadcasts and links. `?obs` turns on stream mode (an OBS browser source,
 * a TV): the music starts without a press where the browser allows it, the readouts stay on
 * screen and only the controls fade. With it:
 * - `layout=audio`: sound only, nothing drawn on a transparent page;
 * - `aura=on|off`: draw the aura even on software WebGL (a server without a GPU), or never;
 * - `fps=10…60`: cap the scene's frame rate (a server encoding the picture itself).
 *
 * `pair=SYMBOL` (and `market=coinm` for a COIN-M one) opens any pair, with or without `?obs`, the
 * way a pair page opens its own.
 */
const FPS = { min: 10, max: 60 } as const;
const PAIR_PARAM = 'pair';
const MARKET_PARAM = 'market';

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

/** The pair the address asks for; null when it names none or a malformed one. */
export function pairParamOf(params: URLSearchParams): Pick<Settings, 'market' | 'symbol'> | null {
  const symbol = params.get(PAIR_PARAM)?.toUpperCase();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) return null;
  const market = BINANCE_MARKETS.find((m) => m === params.get(MARKET_PARAM)) ?? 'usdm';
  return { market, symbol };
}

/** `search` without the pair it asked for: once another pair is picked, a reload must not undo it. */
export function dropPairParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PAIR_PARAM);
  params.delete(MARKET_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
