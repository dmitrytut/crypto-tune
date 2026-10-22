import { Emitter } from './emitter';
import type { FeedStatus, Liquidation, MarketFeed, Trade, Unsubscribe } from './market-feed';

/** Recent trades of one pair saved across reloads. */
export interface TradeStore {
  /** Saved trades, oldest first; empty when nothing is stored or storage is unavailable. */
  load(): Promise<Trade[]>;
  /** Best effort: never throws, a failed save just means a longer fetch next time. */
  save(trades: readonly Trade[]): Promise<void>;
}

/** Fetches past trades with `ts ≥ fromTs` up to now, oldest first. */
export type HistorySource = (fromTs: number, signal: AbortSignal) => Promise<Trade[]>;

/** How often the rolling buffer is written to the store. */
const SAVE_EVERY_MS = 15_000;
/** Longest wait for the cache; a stuck store must never hold the live stream back. */
const LOAD_TIMEOUT_MS = 1_500;

/**
 * Which cached trades are still useful and where the fetch must start:
 * keep cached trades inside the span, fetch only what came after them.
 * With nothing usable cached, fetch the whole span.
 */
export function planWarmStart(
  cached: readonly Trade[],
  now: number,
  spanMs: number,
): { keep: Trade[]; fetchFrom: number } {
  const from = now - spanMs;
  const keep = cached.filter((t) => t.ts >= from && t.ts <= now);
  const last = keep.at(-1);
  return { keep, fetchFrom: last ? last.ts + 1 : from };
}

/**
 * History followed by the live trades buffered while it loaded. History is cut
 * strictly before the first live trade so the overlap is neither doubled nor
 * reordered; with no live trades yet, all history is kept.
 */
export function mergeHistory(history: readonly Trade[], live: readonly Trade[]): Trade[] {
  const first = live[0];
  const before = first ? history.filter((t) => t.ts < first.ts) : [...history];
  before.sort((a, b) => a.ts - b.ts);
  return [...before, ...live];
}

/**
 * Wraps a live feed so metrics start warm: on connect the live stream opens at
 * once (its trades are held back), the recent past is restored from the store
 * and the gap since then fetched, and everything is replayed through `onTrade`
 * in time order before live trades flow through. While running, the last
 * `spanMs` of trades are saved periodically and when the page is hidden, so a
 * reload only fetches the few seconds it missed.
 */
export class WarmStartFeed implements MarketFeed {
  readonly label: string;
  private readonly trades = new Emitter<Trade>();
  private readonly loading = new Emitter<boolean>();
  private readonly unsubs: Unsubscribe[] = [];
  private held: Trade[] | null = null;
  private recent: Trade[] = [];
  private abort: AbortController | null = null;
  private saveTimer: number | undefined;
  private readonly onHide = () => {
    if (document.visibilityState === 'hidden') void this.persist();
  };

  constructor(
    private readonly inner: MarketFeed,
    private readonly history: HistorySource,
    private readonly store: TradeStore,
    private readonly spanMs: number,
  ) {
    this.label = inner.label;
  }

  connect(): void {
    if (this.abort) return;
    const abort = new AbortController();
    this.abort = abort;
    this.held = [];
    this.unsubs.push(
      this.inner.onTrade((t) => {
        if (this.held) this.held.push(t);
        else this.pass(t);
      }),
    );
    this.inner.connect();
    this.loading.emit(true);
    void this.warmUp(abort.signal);
    this.saveTimer = setInterval(() => void this.persist(), SAVE_EVERY_MS);
    document.addEventListener('visibilitychange', this.onHide);
  }

  disconnect(): void {
    this.abort?.abort();
    this.abort = null;
    clearInterval(this.saveTimer);
    document.removeEventListener('visibilitychange', this.onHide);
    void this.persist();
    for (const u of this.unsubs.splice(0)) u();
    this.held = null;
    this.inner.disconnect();
  }

  now(): number {
    return this.inner.now();
  }

  onTrade(cb: (t: Trade) => void): Unsubscribe {
    return this.trades.on(cb);
  }

  onLiquidation(cb: (l: Liquidation) => void): Unsubscribe {
    return this.inner.onLiquidation(cb);
  }

  onStatus(cb: (s: FeedStatus) => void): Unsubscribe {
    return this.inner.onStatus(cb);
  }

  /** True while history is loading; then false once it has been replayed. */
  onLoading(cb: (loading: boolean) => void): Unsubscribe {
    return this.loading.on(cb);
  }

  private async warmUp(signal: AbortSignal): Promise<void> {
    const { promise: timedOut, resolve } = Promise.withResolvers<Trade[]>();
    const timer = setTimeout(() => resolve([]), LOAD_TIMEOUT_MS);
    const cached = await Promise.race([this.store.load(), timedOut]);
    clearTimeout(timer);
    const { keep, fetchFrom } = planWarmStart(cached, Date.now(), this.spanMs);
    let fetched: Trade[] = [];
    try {
      fetched = await this.history(fetchFrom, signal);
    } catch (err) {
      // No history is not fatal: the session simply warms up on live data.
      if (!signal.aborted) console.warn('Trade history unavailable', err);
    }
    if (signal.aborted) return;
    const replay = mergeHistory([...keep, ...fetched], this.held ?? []);
    this.held = null;
    for (const t of replay) this.pass(t);
    this.loading.emit(false);
  }

  private pass(t: Trade): void {
    this.recent.push(t);
    this.trades.emit(t);
  }

  private async persist(): Promise<void> {
    const last = this.recent.at(-1);
    if (!last) return;
    const from = last.ts - this.spanMs;
    let drop = 0;
    while (drop < this.recent.length && (this.recent[drop] as Trade).ts < from) drop++;
    if (drop > 0) this.recent.splice(0, drop);
    await this.store.save(this.recent);
  }
}
