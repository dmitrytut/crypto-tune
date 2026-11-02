import type { MarketFeed } from './feed/market-feed';

/**
 * Live visual age follows wall time across system sleep, with a fixed feed/wall offset
 * so delayed messages cannot pull it backwards. Recreated with each feed pipeline.
 * The first read must follow observeClock: main dispatches the event only afterwards,
 * and MetricsEngine emits no snapshots before its first trade.
 * @package
 */
export function calibratedClock(feed: Pick<MarketFeed, 'now'>): () => number {
  let offset: number | undefined;
  return () => {
    const wall = Date.now();
    offset ??= feed.now() - wall;
    return wall + offset;
  };
}
