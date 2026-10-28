// `.ts`: vite.config.ts imports this file, and Vite's native config loader needs the extension.
import type { PairSlug } from './pair-pages.ts';

/**
 * Words of each pair page, keyed by slug: build-time only. `vite.config.ts` is the one importer,
 * so the texts never reach the app bundle (the runtime needs just slug and symbol, in
 * `pair-pages.ts`). They end up in HTML attributes and JSON-LD, so they must not contain
 * `&<>"\` (the build rejects them).
 */
export interface PairPageText {
  /** The name people search for. */
  name: string;
  ticker: string;
  /** What is particular about hearing this pair: the page's own paragraph in About. */
  intro: string;
}

export const PAIR_PAGE_TEXTS: Record<PairSlug, PairPageText> = {
  bitcoin: {
    name: 'Bitcoin',
    ticker: 'BTC',
    intro:
      'BTCUSDT is the busiest perpetual on Binance Futures, so there is always something to hear: plucks for whale-size market orders, gongs when leveraged longs or shorts are wiped out. Leave it on as background music and the tempo tells you when Bitcoin starts to move.',
  },
  ethereum: {
    name: 'Ethereum',
    ticker: 'ETH',
    intro:
      'ETHUSDT is the second largest perpetual on Binance Futures. Tension is measured against the pair’s own recent volatility, so the music tightens when Ethereum breaks its usual rhythm, not just because it moves more than Bitcoin.',
  },
  solana: {
    name: 'Solana',
    ticker: 'SOL',
    intro:
      'SOLUSDT is one of the most traded altcoin perpetuals. When Solana rallies the arpeggio climbs and brightens; when it slides the melody runs down and darkens, and each long liquidation lands as a low gong.',
  },
  xrp: {
    name: 'XRP',
    ticker: 'XRP',
    intro:
      'XRPUSDT carries a lot of leverage, so a sharp move clears positions on one side fast. A squeeze of shorts rings as bright bells on the fifth, a flush of longs as dark gongs on the tonic.',
  },
  bnb: {
    name: 'BNB',
    ticker: 'BNB',
    intro:
      'BNBUSDT is the perpetual on the token of Binance itself and is often steadier than the other majors. Much of the time you hear the drone and the bells alone, which makes a sudden jump in BNB easy to catch by ear.',
  },
  dogecoin: {
    name: 'Dogecoin',
    ticker: 'DOGE',
    intro:
      'DOGEUSDT trades in smaller tickets than Bitcoin, so lower the large-trade threshold in settings to hear more plucks. Liquidations still arrive in bursts when the crowd piles in on leverage.',
  },
  pepe: {
    name: 'Pepe',
    ticker: 'PEPE',
    intro:
      '1000PEPEUSDT quotes the price of a thousand PEPE, so the numbers stay readable. Meme coin perpetuals move in jolts, and a jolt is what the shock swell is for: a noise sweep up the filter on a pump, down on a dump.',
  },
  sui: {
    name: 'Sui',
    ticker: 'SUI',
    intro:
      'SUIUSDT is a younger, thinner market than the majors. Lower the thresholds in settings and you hear individual traders: every pluck a market order, every gong a position closed by the exchange.',
  },
  hyperliquid: {
    name: 'Hyperliquid',
    ticker: 'HYPE',
    intro:
      'HYPEUSDT is the Binance perpetual on the token of the Hyperliquid exchange. Its trend shows in the register: the further the price runs above its hourly average, the higher the melody sits.',
  },
  zcash: {
    name: 'Zcash',
    ticker: 'ZEC',
    intro:
      'ZECUSDT can go from quiet to frantic within minutes. Listen for the tempo: it quickens as tension rises, and the shaker and sub bass come in before the chart looks dramatic.',
  },
  cardano: {
    name: 'Cardano',
    ticker: 'ADA',
    intro:
      'ADAUSDT often drifts for hours in a narrow range, which sounds like what it is: a slow drone moving through its chords, sparse notes and bells. When Cardano breaks out, the change is hard to miss.',
  },
  chainlink: {
    name: 'Chainlink',
    ticker: 'LINK',
    intro:
      'LINKUSDT tends to follow the wider market and then move on its own. Buys sit to the right of the stereo field and sells to the left, so you can hear which side is in control without looking.',
  },
};
