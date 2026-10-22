import { AudioEngine, type AudioParams } from './audio/engine';
import { BinanceFuturesFeed, fetchBinanceSymbols, fetchBinanceTradesSince } from './feed/binance';
import type { MarketFeed, Unsubscribe } from './feed/market-feed';
import { SimulatorFeed } from './feed/simulator';
import { indexedDbTradeStore } from './feed/trade-cache';
import { WarmStartFeed } from './feed/warm-start';
import { DEFAULT_METRICS_CONFIG, MetricsEngine, TICK_MS } from './metrics/engine';
import { MarketHistory } from './metrics/history';
import { loadSettings, type Settings, saveSettings, TONICS } from './settings';
import { mountApp } from './ui/app';

const SYMBOLS_CACHE_KEY = 'crypto-tune.binance-symbols';

let settings = loadSettings();
let feed: MarketFeed | null = null;
let engine: MetricsEngine | null = null;
let history: MarketHistory | null = null;
let unsubs: Unsubscribe[] = [];

const tensionParams = (s: Settings) => ({
  ...DEFAULT_METRICS_CONFIG.tension,
  sensitivity: s.sensitivity,
});

const audioParams = (s: Settings): AudioParams => ({
  tonicPc: TONICS.indexOf(s.tonic),
  baseVolumeDb: s.baseVolumeDb,
  tensionVolumeDb: s.tensionVolumeDb,
  eventsVolumeDb: s.eventsVolumeDb,
  liqThresholdUsd: s.liqThresholdUsd,
  tradeThresholdUsd: s.tradeThresholdUsd,
});

const audio = new AudioEngine(audioParams(settings));

const view = mountApp(settings, {
  onSettings(next) {
    const prev = settings;
    settings = next;
    if (
      next.source !== prev.source ||
      next.symbol !== prev.symbol ||
      next.windowSec !== prev.windowSec
    ) {
      startPipeline();
    } else if (next.sensitivity !== prev.sensitivity) {
      engine?.setTensionParams(tensionParams(next));
    }
    audio.setParams(audioParams(next));
    saveSettings(next);
  },
  onToggleAudio() {
    if (audio.current === 'running') {
      audio.stop();
      view.setPlayback('stopped');
      return;
    }
    view.setPlayback('starting');
    audio.start().then(
      () => view.setPlayback('running'),
      (err: unknown) => {
        console.error('Audio failed to start', err);
        view.setPlayback('stopped');
      },
    );
  },
});

/** Visual events older than this (wall clock) are history replays, not news: no sparks. */
const VISUAL_MAX_AGE_MS = 2_000;
/** Extra history beyond the warm-up so the first live tick already has full statistics. */
const WARM_MARGIN_SEC = 20;

/**
 * Live feed that starts warm: the trades needed for window N plus the stats
 * warm-up are restored from IndexedDB and/or fetched over REST.
 */
function warmBinanceFeed(symbol: string): WarmStartFeed {
  const spanSec = settings.windowSec + DEFAULT_METRICS_CONFIG.warmupMin * 60 + WARM_MARGIN_SEC;
  return new WarmStartFeed(
    new BinanceFuturesFeed(symbol),
    (from, signal) => fetchBinanceTradesSince(symbol, from, signal),
    indexedDbTradeStore(`binance:${symbol}`),
    spanSec * 1000,
  );
}

/** (Re)create feed, metrics and chart history from current settings; history is discarded. */
function startPipeline(): void {
  for (const u of unsubs) u();
  feed?.disconnect();

  const extra: Unsubscribe[] = [];
  let f: MarketFeed;
  if (settings.source === 'simulator') {
    f = new SimulatorFeed();
  } else {
    const warm = warmBinanceFeed(settings.symbol);
    extra.push(warm.onLoading((loading) => view.setHistoryLoading(loading)));
    f = warm;
  }
  const e = new MetricsEngine({
    ...DEFAULT_METRICS_CONFIG,
    windowSec: settings.windowSec,
    tension: tensionParams(settings),
  });
  const h = new MarketHistory();
  const fresh = (ts: number) => ts >= Date.now() - VISUAL_MAX_AGE_MS;
  unsubs = [
    ...extra,
    f.onTrade((t) => {
      e.addTrade(t);
      h.addTrade(t);
      audio.onTrade(t);
      if (fresh(t.ts)) view.trade(t);
    }),
    f.onLiquidation((l) => {
      audio.onLiquidation(l);
      if (fresh(l.ts)) view.liquidation(l);
    }),
    f.onStatus((s) => {
      view.setStatus(s);
      // A data gap is not a calm market: drop tick-level state so the move
      // across the gap is never scored as a move within window N.
      if (s.state !== 'open') e.resync();
    }),
  ];
  feed = f;
  engine = e;
  history = h;
  view.reset(h);
  f.connect();
}

window.setInterval(() => {
  if (!feed || !engine) return;
  const now = feed.now();
  const snap = engine.advanceTo(now, (s) => history?.addSnapshot(s));
  if (snap) {
    view.render(snap);
    audio.update(snap);
  }
  // Events flush every tick, with or without new trades (a liquidation can arrive alone).
  const { liquidation, trade } = audio.flushEvents(now);
  if (trade) {
    view.showEvent({ kind: 'trade', ...trade });
    history?.addMarker({ ts: now, kind: 'trade', side: trade.side, usd: trade.usd });
  }
  // Liquidation last: it is rarer and more important, so it wins the readout.
  if (liquidation) {
    view.showEvent({ kind: 'liquidation', ...liquidation });
    history?.addMarker({
      ts: now,
      kind: 'liquidation',
      side: liquidation.side,
      usd: liquidation.usd,
    });
  }
}, TICK_MS);

async function loadSymbols(): Promise<void> {
  const cached = readCachedSymbols();
  if (cached) {
    view.setSymbols(cached);
    return;
  }
  let list: string[];
  try {
    list = await fetchBinanceSymbols();
  } catch (err) {
    // Symbol input still accepts any well-formed ticker without the list.
    console.warn('Binance symbol list unavailable', err);
    return;
  }
  view.setSymbols(list);
  try {
    sessionStorage.setItem(SYMBOLS_CACHE_KEY, JSON.stringify(list));
  } catch {
    // Cache is optional (storage disabled or full).
  }
}

function readCachedSymbols(): string[] | null {
  try {
    const raw = sessionStorage.getItem(SYMBOLS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

startPipeline();
void loadSymbols();
