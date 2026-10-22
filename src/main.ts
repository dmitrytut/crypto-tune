import { BinanceFuturesFeed, fetchBinanceSymbols } from './feed/binance';
import { SimulatorFeed } from './feed/simulator';
import type { MarketFeed, Unsubscribe } from './feed/types';
import { DEFAULT_METRICS_CONFIG, MetricsEngine, TICK_MS } from './metrics/engine';
import { loadSettings, type Settings, saveSettings } from './settings';
import { mountApp } from './ui/app';

const SYMBOLS_CACHE_KEY = 'crypto-tune.binance-symbols';

let settings = loadSettings();
let feed: MarketFeed | null = null;
let engine: MetricsEngine | null = null;
let unsubs: Unsubscribe[] = [];

const tensionParams = (s: Settings) => ({
  ...DEFAULT_METRICS_CONFIG.tension,
  sensitivity: s.sensitivity,
});

const view = mountApp(settings, {
  onSettings(next) {
    const prev = settings;
    settings = next;
    saveSettings(next);
    if (
      next.source !== prev.source ||
      next.symbol !== prev.symbol ||
      next.windowSec !== prev.windowSec
    ) {
      startPipeline();
    } else if (next.sensitivity !== prev.sensitivity) {
      engine?.setTensionParams(tensionParams(next));
    }
  },
});

/** (Re)create feed and metrics from current settings; history is discarded. */
function startPipeline(): void {
  for (const u of unsubs) u();
  feed?.disconnect();

  const f: MarketFeed =
    settings.source === 'simulator' ? new SimulatorFeed() : new BinanceFuturesFeed(settings.symbol);
  const e = new MetricsEngine({
    ...DEFAULT_METRICS_CONFIG,
    windowSec: settings.windowSec,
    tension: tensionParams(settings),
  });
  unsubs = [f.onTrade((t) => e.addTrade(t)), f.onStatus((s) => view.setStatus(s))];
  feed = f;
  engine = e;
  view.reset();
  view.setFeedLabel(f.label);
  f.connect();
}

window.setInterval(() => {
  if (!feed || !engine) return;
  const snap = engine.advanceTo(feed.now());
  if (snap) view.render(snap);
}, TICK_MS);

async function loadSymbols(): Promise<void> {
  const cached = sessionStorage.getItem(SYMBOLS_CACHE_KEY);
  if (cached) {
    view.setSymbols(JSON.parse(cached) as string[]);
    return;
  }
  try {
    const list = await fetchBinanceSymbols();
    sessionStorage.setItem(SYMBOLS_CACHE_KEY, JSON.stringify(list));
    view.setSymbols(list);
  } catch (err) {
    // Symbol input still accepts any well-formed ticker without the list.
    console.warn('Binance symbol list unavailable', err);
  }
}

startPipeline();
void loadSymbols();
