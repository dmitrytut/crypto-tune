import { ListenTracker, ShareTracker, StreamTracker } from './analytics';
import { AudioEngine } from './audio/engine';
import type { AudioParams } from './audio/graph';
import { renderClipAudio } from './audio/offline';
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
import { ClipBuffer, type ClipSeconds, replayHistory } from './metrics/clip-buffer';
import { DEFAULT_METRICS_CONFIG, MetricsEngine, TICK_MS } from './metrics/engine';
import { EventBuffer, type EventThresholds } from './metrics/events';
import { MarketHistory } from './metrics/history';
import { pagePath, pairPageAt, pairPageOf } from './pair-pages';
import { loadSettings, type Settings, saveSettings, TONICS } from './settings';
import { shareTexts } from './share';
import { dropPairParams, pairParamOf, streamOptionsOf } from './stream';
import { mountApp } from './ui/app';
import { CLIP_FORMAT, clipSupport } from './ui/clip-format';

const params = new URLSearchParams(location.search);
/** Stream mode (`?obs`): OBS, a TV; null on the ordinary page. */
const stream = streamOptionsOf(params);
const stored = loadSettings();
/** A pair the address names (`?pair=`, or a pair page like /bitcoin/) plays over the stored one. */
const landing = pairPageAt(location.pathname);
const opened =
  pairParamOf(params) ?? (landing ? { market: 'usdm' as const, symbol: landing.symbol } : null);
let settings: Settings = opened ? { ...stored, source: 'live', ...opened } : stored;
/**
 * The pair to save while the address's pair plays: the user's own, until they pick one. Coming in
 * by a link and turning the volume down must not replace the pair `/` opens.
 */
let savedPair: Pick<Settings, 'source' | 'market' | 'symbol'> | null = opened
  ? { source: stored.source, market: stored.market, symbol: stored.symbol }
  : null;
let feed: MarketFeed | null = null;
let engine: MetricsEngine | null = null;
let history: MarketHistory | null = null;
let events: EventBuffer | null = null;
let unsubs: Unsubscribe[] = [];
/** The feed is connected: ticks are market time, not an outage. */
let feedOpen = false;

const tensionParams = (s: Settings) => ({
  ...DEFAULT_METRICS_CONFIG.tension,
  sensitivity: s.sensitivity,
});

const audioParams = (s: Settings): AudioParams => ({
  tonicPc: TONICS.indexOf(s.tonic),
  baseVolumeDb: s.baseVolumeDb,
  tensionVolumeDb: s.tensionVolumeDb,
  eventsVolumeDb: s.eventsVolumeDb,
  interactionSound: s.interactionSound,
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

/**
 * Puts the address on the page of the pair being played (`/` for one without a page), so a reload
 * or a copied link opens it. Replaces the entry: switching pairs must not fill the back button.
 */
function syncPath(s: Settings): void {
  const page = s.source === 'live' && s.market === 'usdm' ? pairPageOf(s.symbol) : undefined;
  const path = pagePath(page);
  if (path !== location.pathname || dropPairParams(location.search) !== location.search) {
    // `window.`: the module's `history` is the chart's MarketHistory.
    const search = dropPairParams(location.search);
    window.history.replaceState(window.history.state, '', path + search + location.hash);
  }
}

const audio = new AudioEngine(audioParams(settings));
const listens = new ListenTracker();
const streams = new StreamTracker();
const shares = new ShareTracker();
/** How long a start may take before it counts as held by the autoplay policy. */
const AUTOPLAY_CHECK_MS = 1_000;
/** The live market of the last seconds, for clips; one per pipeline, emptied by feed gaps. */
const clips = new ClipBuffer();
/** Site origin for clip links: the canonical link is the one place it is written. */
const site =
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? location.origin;
/** The share of a clip's progress its music takes; the picture is the rest. */
const CLIP_AUDIO_SHARE = 0.4;

/** Pair as analytics name it: an exchange symbol, or `simulator`. */
const analyticsPair = (s: Settings) => (s.source === 'simulator' ? 'simulator' : s.symbol);

function startAudio(): void {
  view.setPlayback('starting');
  audio.start().then(
    () => {
      view.setPlayback('running');
      if (stream) streams.started(analyticsPair(settings), stream.layout);
      else listens.started(analyticsPair(settings));
    },
    (err: unknown) => {
      console.error('Audio failed to start', err);
      view.setPlayback('stopped');
    },
  );
  // Without a press only an autoplaying page (OBS) gets sound; elsewhere Listen is the press.
  window.setTimeout(() => {
    if (audio.blocked) view.setPlayback('blocked');
  }, AUTOPLAY_CHECK_MS);
}

function stopAudio(): void {
  if (audio.current !== 'running') return;
  audio.stop();
  listens.stopped();
  streams.stopped();
  view.setPlayback('stopped');
}

/**
 * A clip of the last `seconds`: the music offline, then the picture (its code and the encoder
 * load on the first clip).
 */
async function makeClip(
  seconds: ClipSeconds,
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<File> {
  const w = clips.window(seconds);
  if (!w || !history) throw new Error('Not enough live data for a clip yet');
  const s = settings;
  const words = shareTexts(site, s, new Date());
  const replay = replayHistory(history, w);
  const startedAt = performance.now();
  let stage: 'audio' | 'video' = 'audio';
  try {
    const sound = await renderClipAudio(w, audioParams(s), CLIP_FORMAT.sampleRate);
    signal.throwIfAborted();
    onProgress(CLIP_AUDIO_SHARE);
    stage = 'video';
    // Dynamic on purpose: the renderer and its encoder stay out of the page's first load.
    const { renderClipVideo } = await import('./ui/scene/clip-render');
    const blob = await renderClipVideo(
      {
        window: w,
        history: replay,
        audio: sound,
        pair: words.pair,
        watermark: words.watermark,
        periodMs: s.periodMin * 60_000,
        bigTradeUsd: s.tradeThresholdUsd,
        liquidationUsd: s.liqThresholdUsd,
      },
      (done) => onProgress(CLIP_AUDIO_SHARE + (1 - CLIP_AUDIO_SHARE) * done),
      signal,
    );
    // Closed after the last frame: not a clip anyone got.
    signal.throwIfAborted();
    shares.clipRecorded(analyticsPair(s), seconds, performance.now() - startedAt);
    return new File([blob], words.fileName, { type: 'video/mp4' });
  } catch (err) {
    if (!signal.aborted) shares.clipFailed(stage, String(err));
    throw err;
  }
}

const view = mountApp(
  settings,
  {
    onSettings(next) {
      const prev = settings;
      settings = next;
      const pairChanged =
        next.source !== prev.source || next.market !== prev.market || next.symbol !== prev.symbol;
      if (pairChanged) savedPair = null;
      if (pairChanged || next.windowSec !== prev.windowSec) {
        startPipeline();
        syncPath(next);
      } else if (next.sensitivity !== prev.sensitivity) {
        engine?.setTensionParams(tensionParams(next));
      }
      audio.setParams(audioParams(next));
      events?.setThresholds(eventThresholds(next));
      saveSettings(savedPair ? { ...next, ...savedPair } : next);
    },
    onParticleTouch(side, strength) {
      audio.touch(side, strength);
    },
    share: {
      link: () => shareTexts(site, settings, new Date()).link,
      onLinkShared: (method) => shares.linkShared(analyticsPair(settings), method),
      readiness: (seconds) => clips.readiness(seconds),
      make: makeClip,
      onClipShared: (method) => shares.clipShared(analyticsPair(settings), method),
      onClipShareFailed: (reason) => shares.clipFailed('share', reason),
    },
    onToggleAudio() {
      if (audio.current === 'running') stopAudio();
      // A start the autoplay policy holds: this press is the gesture it waits for.
      else if (audio.current === 'starting') audio.resume();
      else startAudio();
    },
  },
  stream,
);

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
  clips.reset();
  feedOpen = false;
  /** Live trades since connect, replayed after history into the rebuilt metrics; null after. */
  let seen: Trade[] | null = [];
  unsubs = [
    f.onTrade((t) => {
      engine?.addTrade(t);
      history?.addTrade(t);
      events?.addTrade(t);
      clips.addTrade(t);
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
      clips.addLiquidation(l);
      view.liquidation(l);
    }),
    f.onStatus((s) => {
      view.setStatus(s);
      // A data gap is not a calm market: drop tick-level state so the move
      // across the gap is never scored as a move within window N, and no clip spans it.
      feedOpen = s.state === 'open';
      if (!feedOpen) {
        engine?.resync();
        clips.reset();
      }
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
  // Only while the feed is open: ticks through an outage would count it as clip material.
  if (feedOpen) clips.addTick({ ts: now, snap, cues });
  history?.addCues(now, cues);
  // Liquidation last: it is rarer and more important, so it wins the readout.
  if (cues.trade) view.showEvent({ kind: 'trade', ...cues.trade });
  if (cues.liquidation) view.showEvent({ kind: 'liquidation', ...cues.liquidation });
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
void clipSupport().then((support) => {
  if (support.supported) view.enableClips();
  // The Umami script is deferred after this module: report once the page has loaded.
  const report = () => shares.clipSupport(support);
  if (document.readyState === 'complete') report();
  else window.addEventListener('load', report, { once: true });
});

if (stream) {
  startAudio();
  // OBS hides a source with its eye icon or a scene switch: no drawing, no music until it is back.
  window.addEventListener('obsSourceVisibleChanged', (e) => {
    const { visible } = (e as CustomEvent<{ visible: boolean }>).detail;
    view.setSourceVisible(visible);
    if (!visible) stopAudio();
    else if (audio.current === 'stopped') startAudio();
  });
}
