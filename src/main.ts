import { BinanceFuturesFeed, fetchBinanceSymbols } from './feed/binance';
import type { MarketFeed, Unsubscribe } from './feed/market-feed';
import { SimulatorFeed } from './feed/simulator';
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
    if (
      next.source !== prev.source ||
      next.symbol !== prev.symbol ||
      next.windowSec !== prev.windowSec
    ) {
      startPipeline();
    } else if (next.sensitivity !== prev.sensitivity) {
      engine?.setTensionParams(tensionParams(next));
    }
    saveSettings(next);
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
  unsubs = [
    f.onTrade((t) => e.addTrade(t)),
    f.onStatus((s) => {
      view.setStatus(s);
      // A data gap is not a calm market: drop tick-level state so the move
      // across the gap is never scored as a move within window N.
      if (s.state !== 'open') e.resync();
    }),
  ];
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
