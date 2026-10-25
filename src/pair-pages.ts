/**
 * Landing pages for the most searched USDⓈ-M perpetuals: `/<slug>/` opens the app on that pair.
 * The build (`vite.config.ts`) writes one `index.html` per entry with its own title,
 * description, canonical URL and intro, and lists them all in the sitemap and the About dialog;
 * `main.ts` opens the pair from the path and keeps the path in step with the chosen pair.
 *
 * Every text here ends up in HTML attributes and JSON-LD, so it must not contain `&<>"\`
 * (the build rejects them).
 */
export interface PairPage {
  /** URL path segment: lower case, the name people search for. */
  slug: string;
  /** USDⓈ-M exchange symbol the page opens. */
  symbol: string;
  name: string;
  ticker: string;
  /** What is particular about hearing this pair: the page's own intro in About. */
  intro: string;
}

export const PAIR_PAGES: readonly PairPage[] = [
  {
    slug: 'bitcoin',
    symbol: 'BTCUSDT',
    name: 'Bitcoin',
    ticker: 'BTC',
    intro:
      'BTCUSDT is the busiest perpetual on Binance Futures, so there is always something to hear: plucks for whale-size market orders, gongs when leveraged longs or shorts are wiped out. Leave it on as background music and the tempo tells you when Bitcoin starts to move.',
  },
  {
    slug: 'ethereum',
    symbol: 'ETHUSDT',
    name: 'Ethereum',
    ticker: 'ETH',
    intro:
      'ETHUSDT is the second largest perpetual on Binance Futures. Tension is measured against the pair’s own recent volatility, so the music tightens when Ethereum breaks its usual rhythm, not just because it moves more than Bitcoin.',
  },
  {
    slug: 'solana',
    symbol: 'SOLUSDT',
    name: 'Solana',
    ticker: 'SOL',
    intro:
      'SOLUSDT is one of the most traded altcoin perpetuals. When Solana rallies the arpeggio climbs and brightens; when it slides the melody runs down and darkens, and each long liquidation lands as a low gong.',
  },
  {
    slug: 'xrp',
    symbol: 'XRPUSDT',
    name: 'XRP',
    ticker: 'XRP',
    intro:
      'XRPUSDT carries a lot of leverage, so a sharp move clears positions on one side fast. A squeeze of shorts rings as bright bells on the fifth, a flush of longs as dark gongs on the tonic.',
  },
  {
    slug: 'bnb',
    symbol: 'BNBUSDT',
    name: 'BNB',
    ticker: 'BNB',
    intro:
      'BNBUSDT is the perpetual on the token of Binance itself and is often steadier than the other majors. Much of the time you hear the drone and the bells alone, which makes a sudden jump in BNB easy to catch by ear.',
  },
  {
    slug: 'dogecoin',
    symbol: 'DOGEUSDT',
    name: 'Dogecoin',
    ticker: 'DOGE',
    intro:
      'DOGEUSDT trades in smaller tickets than Bitcoin, so lower the large-trade threshold in settings to hear more plucks. Liquidations still arrive in bursts when the crowd piles in on leverage.',
  },
  {
    slug: 'pepe',
    symbol: '1000PEPEUSDT',
    name: 'Pepe',
    ticker: 'PEPE',
    intro:
      '1000PEPEUSDT quotes the price of a thousand PEPE, so the numbers stay readable. Meme coin perpetuals move in jolts, and a jolt is what the shock swell is for: a noise sweep up the filter on a pump, down on a dump.',
  },
  {
    slug: 'sui',
    symbol: 'SUIUSDT',
    name: 'Sui',
    ticker: 'SUI',
    intro:
      'SUIUSDT is a younger, thinner market than the majors. Lower the thresholds in settings and you hear individual traders: every pluck a market order, every gong a position closed by the exchange.',
  },
  {
    slug: 'hyperliquid',
    symbol: 'HYPEUSDT',
    name: 'Hyperliquid',
    ticker: 'HYPE',
    intro:
      'HYPEUSDT is the Binance perpetual on the token of the Hyperliquid exchange. Its trend shows in the register: the further the price runs above its hourly average, the higher the melody sits.',
  },
  {
    slug: 'zcash',
    symbol: 'ZECUSDT',
    name: 'Zcash',
    ticker: 'ZEC',
    intro:
      'ZECUSDT can go from quiet to frantic within minutes. Listen for the tempo: it quickens as tension rises, and the shaker and sub bass come in before the chart looks dramatic.',
  },
  {
    slug: 'cardano',
    symbol: 'ADAUSDT',
    name: 'Cardano',
    ticker: 'ADA',
    intro:
      'ADAUSDT often drifts for hours in a narrow range, which sounds like what it is: a slow drone moving through its chords, sparse notes and bells. When Cardano breaks out, the change is hard to miss.',
  },
  {
    slug: 'chainlink',
    symbol: 'LINKUSDT',
    name: 'Chainlink',
    ticker: 'LINK',
    intro:
      'LINKUSDT tends to follow the wider market and then move on its own. Buys sit to the right of the stereo field and sells to the left, so you can hear which side is in control without looking.',
  },
];

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
