import { AudioEngine, type AudioParams } from './audio/engine';
import {
  BINANCE_MARKETS,
  BinanceFuturesFeed,
  type BinanceMarket,
  fetchBinanceSymbols,
} from './feed/binance';
import type { MarketFeed, Trade, Unsubscribe } from './feed/market-feed';
import { SimulatorFeed } from './feed/simulator';
import { cachedSymbols } from './feed/symbol-cache';
import { indexedDbTradeStore } from './feed/trade-cache';
import { DEFAULT_METRICS_CONFIG, MetricsEngine, TICK_MS } from './metrics/engine';
import { EventBuffer, type EventThresholds } from './metrics/events';
import { MarketHistory } from './metrics/history';
import { loadSettings, type Settings, saveSettings, TONICS } from './settings';
import { mountApp } from './ui/app';

let settings = loadSettings();
let feed: MarketFeed | null = null;
let engine: MetricsEngine | null = null;
let history: MarketHistory | null = null;
let events: EventBuffer | null = null;
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
});

const eventThresholds = (s: Settings): EventThresholds => ({
  liquidationUsd: s.liqThresholdUsd,
  tradeUsd: s.tradeThresholdUsd,
});

/** Metrics for the current settings: one per pipeline, rebuilt once history arrives. */
const metricsEngine = (s: Settings) =>
  new MetricsEngine({
    ...DEFAULT_METRICS_CONFIG,
    windowSec: s.windowSec,
    tension: tensionParams(s),
  });

const audio = new AudioEngine(audioParams(settings));

const view = mountApp(settings, {
  onSettings(next) {
    const prev = settings;
    settings = next;
    if (
      next.source !== prev.source ||
      next.market !== prev.market ||
      next.symbol !== prev.symbol ||
      next.windowSec !== prev.windowSec
    ) {
      startPipeline();
    } else if (next.sensitivity !== prev.sensitivity) {
      engine?.setTensionParams(tensionParams(next));
    }
    audio.setParams(audioParams(next));
    events?.setThresholds(eventThresholds(next));
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

/** Feeds fetch this much history in the background: exactly the window the tension statistics need. */
const HISTORY_MS = DEFAULT_METRICS_CONFIG.statsWindowMin * 60_000;

/** (Re)create feed, metrics, events and chart history from current settings; all are discarded. */
function startPipeline(): void {
  for (const u of unsubs) u();
  feed?.disconnect();

  const f: MarketFeed =
    settings.source === 'simulator'
      ? new SimulatorFeed({ historyMs: HISTORY_MS })
      : new BinanceFuturesFeed(settings.market, settings.symbol, {
          historyMs: HISTORY_MS,
          store: indexedDbTradeStore(`binance:${settings.symbol}`),
        });
  const h = new MarketHistory();
  engine = metricsEngine(settings);
  history = h;
  // Fresh per pipeline: an event buffered for the old pair must not cue under the new one.
  events = new EventBuffer(eventThresholds(settings));
  /** Live trades since connect, replayed after history into the rebuilt metrics; null after. */
  let seen: Trade[] | null = [];
  unsubs = [
    f.onTrade((t) => {
      engine?.addTrade(t);
      history?.addTrade(t);
      events?.addTrade(t);
      seen?.push(t);
      view.trade(t);
    }),
    f.onHistory((past) => {
      if (past.length > 0) warmStart([...past, ...(seen ?? [])], f.now());
      seen = null;
      if (history) view.historyReady(history);
    }),
    f.onLiquidation((l) => {
      events?.addLiquidation(l);
      view.liquidation(l);
    }),
    f.onStatus((s) => {
      view.setStatus(s);
      // A data gap is not a calm market: drop tick-level state so the move
      // across the gap is never scored as a move within window N.
      if (s.state !== 'open') engine?.resync();
    }),
  ];
  feed = f;
  view.reset(h);
  f.connect();
}

/**
 * Swaps in metrics and chart rebuilt from history plus the live trades already seen, in `ts`
 * order. Markers placed meanwhile carry over: they are live cues, history has none.
 * shortcut: a reconnect while history loaded is not replayed as a resync, so the move across
 * that gap can count within window N once; queue statuses with `seen` if it ever shows up.
 */
function warmStart(trades: readonly Trade[], now: number): void {
  const e = metricsEngine(settings);
  const h = new MarketHistory();
  for (const t of trades) {
    e.addTrade(t);
    h.addTrade(t);
  }
  e.advanceTo(now, (s) => h.addSnapshot(s));
  for (const m of history?.markers ?? []) h.addMarker(m);
  engine = e;
  history = h;
}

window.setInterval(() => {
  if (!feed || !engine || !events) return;
  const now = feed.now();
  const snap = engine.advanceTo(now, (s) => history?.addSnapshot(s));
  if (snap) {
    view.render(snap);
    audio.update(snap);
  }
  // Events flush every tick, with or without new trades (a liquidation can arrive alone).
  const cues = events.flush(now);
  audio.play(cues);
  const { liquidation, trade } = cues;
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

async function loadSymbols(market: BinanceMarket): Promise<void> {
  try {
    view.setSymbols(market, await cachedSymbols(market, () => fetchBinanceSymbols(market)));
  } catch (err) {
    // Symbol input still accepts any well-formed ticker without the list.
    console.warn(`Binance ${market} symbol list unavailable`, err);
  }
}

startPipeline();
for (const market of BINANCE_MARKETS) void loadSymbols(market);
