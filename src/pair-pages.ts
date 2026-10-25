/**
 * Landing pages for the most searched USDⓈ-M perpetuals: `/<slug>/` opens the app on that pair.
 * The build (`vite.config.ts`) writes one `index.html` per entry with the words from
 * `pair-page-texts.ts` and lists them all in the sitemap and the About dialog; `main.ts` opens
 * the pair from the path and keeps the path in step with the chosen pair.
 */
export interface PairPage {
  /** URL path segment: lower case, the name people search for. */
  slug: string;
  /** USDⓈ-M exchange symbol the page opens. */
  symbol: string;
}

export const PAIR_PAGES = [
  { slug: 'bitcoin', symbol: 'BTCUSDT' },
  { slug: 'ethereum', symbol: 'ETHUSDT' },
  { slug: 'solana', symbol: 'SOLUSDT' },
  { slug: 'xrp', symbol: 'XRPUSDT' },
  { slug: 'bnb', symbol: 'BNBUSDT' },
  { slug: 'dogecoin', symbol: 'DOGEUSDT' },
  { slug: 'pepe', symbol: '1000PEPEUSDT' },
  { slug: 'sui', symbol: 'SUIUSDT' },
  { slug: 'hyperliquid', symbol: 'HYPEUSDT' },
  { slug: 'zcash', symbol: 'ZECUSDT' },
  { slug: 'cardano', symbol: 'ADAUSDT' },
  { slug: 'chainlink', symbol: 'LINKUSDT' },
] as const satisfies readonly PairPage[];

export type PairSlug = (typeof PAIR_PAGES)[number]['slug'];

/** The page for a path like `/bitcoin/` (or `/bitcoin`, `/bitcoin/index.html`); none for `/`. */
export function pairPageAt(pathname: string): PairPage | undefined {
  const slug = pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return PAIR_PAGES.find((p) => p.slug === slug);
}

/** The page that opens `symbol` on USDⓈ-M, if there is one. */
export function pairPageOf(symbol: string): PairPage | undefined {
  return PAIR_PAGES.find((p) => p.symbol === symbol);
}

/** Site path of a page, `/` for the home page. */
export const pagePath = (page: PairPage | undefined): string => (page ? `/${page.slug}/` : '/');
