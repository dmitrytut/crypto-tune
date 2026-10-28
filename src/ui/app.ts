import './styles/styles.css';
import type {
  FeedStatus,
  Liquidation,
  LiquidationSide,
  Trade,
  TradeSide,
} from '../feed/market-feed';
import type { MetricsSnapshot } from '../metrics/engine';
import type { EventCue } from '../metrics/events';
import type { HistorySeries } from '../metrics/history';
import { TENSION_LEVELS } from '../metrics/tension';
import { type Settings, SYMBOL_PATTERN } from '../settings';
import { mountAbout } from './components/about/about';
import { mountChartTip } from './components/chart-tip/chart-tip';
import { isHintOpen } from './components/hint/hint';
import { TensionMeter } from './components/meter/meter';
import { mountPicker } from './components/picker/picker';
import { PriceReadout } from './components/price-readout/price-readout';
import { mountSettingsPanel } from './components/settings-panel/settings-panel';
import { el } from './dom';
import { FlowMeter } from './flow';
import { durationLabel, eventLabel, usdFmt } from './format';
import { mountMediaKeys } from './media-session';
import { auraTarget, CALM_AURA, css, DOWN_COLOR, isDown, UP_COLOR } from './palette';
import { mountStage } from './scene/stage';

/** Smoothed direction beyond ±this gets an arrow in the tab title; inside it reads as flat. */
const DIRECTION_ARROW_MIN = 0.2;
/** Chrome fades after this long without pointer or keyboard input. */
const IDLE_MS = 10_000;
const TITLE_EVERY_MS = 1_000;
/** Events older than this (wall clock) are catch-up, not news: no sparks, no flow. */
const VISUAL_MAX_AGE_MS = 2_000;
const fresh = (ts: number) => ts >= Date.now() - VISUAL_MAX_AGE_MS;
/** The last big trade or liquidation stays readable this long, then fades out. */
const EVENT_SHOW_MS = 60_000;

export interface AppHandlers {
  /** Called with the full updated settings after any control change. */
  onSettings(next: Settings): void;
  /** Start/Stop pressed; runs inside the click so the AudioContext may start. */
  onToggleAudio(): void;
}

/** What the Start/Stop button shows. */
export type PlaybackView = 'stopped' | 'starting' | 'running';

export type EventReadout =
  | ({ kind: 'liquidation' } & EventCue<LiquidationSide>)
  | ({ kind: 'trade' } & EventCue<TradeSide>);

export interface AppView {
  render(s: MetricsSnapshot): void;
  /** Clear readouts and visuals when the pipeline restarts; the meter waits for history. */
  reset(history: HistorySeries): void;
  /** History arrived (or never will): the chart switches to `history`, the meter stops waiting. */
  historyReady(history: HistorySeries): void;
  setStatus(s: FeedStatus): void;
  /** The tradable pairs of one market, for the pair picker. */
  setSymbols(market: Settings['market'], symbols: string[]): void;
  setPlayback(state: PlaybackView): void;
  /** Last event that crossed its threshold (shown even while audio is stopped). */
  showEvent(e: EventReadout): void;
  /** Every live trade, for the flow and the particle stream; a stale catch-up is ignored. */
  trade(t: Trade): void;
  /** Every liquidation, for the shock waves; a stale catch-up is ignored. */
  liquidation(l: Liquidation): void;
}

function statusText(s: FeedStatus, source: Settings['source']): string {
  switch (s.state) {
    case 'idle':
      return 'Idle';
    case 'connecting':
      return s.attempt > 1 ? `Connecting, try ${s.attempt}` : 'Connecting…';
    case 'open':
      return source === 'live' ? 'Live' : 'Simulated';
    case 'reconnecting':
      return `${s.reason}, retrying in ${Math.ceil(s.inMs / 1000)}s`;
    case 'closed':
      return 'Closed';
    case 'error':
      return `Error: ${s.message}`;
  }
}

const arrowOf = (d: number) =>
  d > DIRECTION_ARROW_MIN ? '▲' : d < -DIRECTION_ARROW_MIN ? '▼' : '•';

/** Tabs of the pair list, one per Binance futures market. */
const MARKET_LABELS: Record<Settings['market'], string> = { usdm: 'USDⓈ-M', coinm: 'COIN-M' };

export function mountApp(initial: Settings, handlers: AppHandlers): AppView {
  let settings = initial;
  /** Markets whose pair list has loaded; the others let the search take any symbol as typed. */
  const listed = new Set<string>();
  const update = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    if ('source' in patch || 'symbol' in patch) syncPair();
    if ('windowSec' in patch) meter.setWindow(settings.windowSec);
    if ('periodMin' in patch) chartDirty = true;
    handlers.onSettings(settings);
  };
  const panel = mountSettingsPanel(initial, update);
  const about = mountAbout();
  // CSS reads the side colours from the palette, so text and canvas never drift apart.
  document.documentElement.style.setProperty('--up', css(UP_COLOR));
  document.documentElement.style.setProperty('--down', css(DOWN_COLOR));

  const status = el('status');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const priceNode = el('price');
  const price = new PriceReadout(priceNode, reducedMotion);
  const change = el('change');
  const meter = new TensionMeter(settings.windowSec);
  const audioLabel = el('audio-label');
  const vol = el('vol');
  const lastEvent = el('last-event');
  // Last big event and when it arrived (wall clock: the "ago" is for the listener's eyes).
  let shownEvent: { text: string; at: number } | null = null;
  const clearEvent = () => {
    shownEvent = null;
    lastEvent.textContent = '';
    lastEvent.className = '';
  };
  /** Writes "SELL $221K (12s ago)", or fades the readout out once it is old. */
  const paintEvent = () => {
    if (!shownEvent || lastEvent.classList.contains('faded')) return;
    const ageMs = Date.now() - shownEvent.at;
    if (ageMs >= EVENT_SHOW_MS) {
      // The text is cleared when the fade ends; without motion there is no fade to wait for.
      if (reducedMotion.matches) clearEvent();
      else lastEvent.classList.add('faded');
      return;
    }
    const age = Math.floor(ageMs / 1000);
    lastEvent.textContent = `${shownEvent.text} (${age > 0 ? `${age}s ago` : 'just now'})`;
  };
  lastEvent.addEventListener('transitionend', () => {
    if (lastEvent.classList.contains('faded')) clearEvent();
  });
  const audioToggle = el<HTMLButtonElement>('audio-toggle');
  const pair = mountPicker(el('pair'), {
    label: 'Pair',
    scopes: {
      label: 'Market',
      choices: Object.entries(MARKET_LABELS).map(([value, text]) => ({ value, text })),
    },
    search: {
      placeholder: 'Search pairs',
      empty: 'No such pair on Binance Futures',
      // Without a loaded list (REST unreachable) any well-formed symbol can be tried as typed.
      fallback: (query, market) => {
        const s = query.toUpperCase();
        return !listed.has(market) && SYMBOL_PATTERN.test(s) ? s : null;
      },
    },
    favorites: {
      values: (market) => settings.favorites[market as Settings['market']],
      onChange: (values, market) =>
        update({ favorites: { ...settings.favorites, [market]: values } }),
    },
    // Scopes are MARKET_LABELS keys: a pick always reports a market.
    onPick: (symbol, market) => update({ market: market as Settings['market'], symbol }),
  });

  audioToggle.addEventListener('click', () => handlers.onToggleAudio());
  let playback: PlaybackView = 'stopped';
  // Media keys and the OS controls act like the button, but never toggle the wrong way.
  const mediaKeys = mountMediaKeys({
    play: () => {
      if (playback === 'stopped') handlers.onToggleAudio();
    },
    pause: () => {
      if (playback === 'running') handlers.onToggleAudio();
    },
  });

  const syncPair = () => {
    const live = settings.source === 'live';
    if (live) pair.set(settings.symbol, settings.market);
    else pair.disable('Simulator');
    mediaKeys.setTitle(live ? settings.symbol : 'Simulator');
  };
  syncPair();

  // ── scene ──
  let flow = new FlowMeter();
  let history: HistorySeries | null = null;
  let last: MetricsSnapshot | null = null;
  let chartDirty = false;
  /** Between reset() and historyReady(): the meter shows the wait, not a warm-up countdown. */
  let loadingHistory = true;
  const { aura, fx, chart } = mountStage({
    origin: priceNode,
    reducedMotion,
    bigTradeUsd: () => settings.tradeThresholdUsd,
    onFrame() {
      if (chartDirty && history && last) {
        // Stays dirty while the chart animates (a new marker's ripple, the range easing).
        chartDirty = chart.draw(history, last.ts, settings.periodMin * 60_000);
      }
    },
  });
  mountChartTip(el<HTMLCanvasElement>('chart'), el('chart-tip'), (x, y) => chart.markerAt(x, y));

  // ── immersive mode ──
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      // Never fade the chrome out from under an open dialog or a tip someone is reading.
      if (!panel.isOpen() && !about.isOpen() && !isHintOpen()) document.body.classList.add('idle');
    }, IDLE_MS);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(ev, wake, { passive: true });
  }
  wake();

  // ── tab title ──
  const idleTitle = document.title;
  let titleAt = 0;
  const updateTitle = (s: MetricsSnapshot) => {
    if (s.ts - titleAt < TITLE_EVERY_MS || Number.isNaN(s.price)) return;
    titleAt = s.ts;
    const name = settings.source === 'live' ? settings.symbol : 'SIM';
    const hot = s.tension >= TENSION_LEVELS.mid ? ` · tension ${s.tension.toFixed(1)}` : '';
    const { int, frac } = price.format(s.price);
    document.title = `${arrowOf(s.direction)} ${int}${frac} · ${name}${hot}`;
  };

  return {
    render(s) {
      last = s;
      chartDirty = true;
      price.render(s.price);
      // Change, volume and chart cover the same period: the chosen one, or all the history
      // there is while it is shorter. While history loads, a second of live data would read as
      // "0.00% in 1s, vol $0/1s": the readouts stay blank for those few seconds instead.
      const first = history?.prices[0];
      if (!history || !first || Number.isNaN(s.price) || loadingHistory) {
        change.textContent = '\u00a0';
        change.className = 'change';
        vol.textContent = '—';
      } else {
        const spanMs = Math.min(settings.periodMin * 60_000, s.ts - first.ts);
        const span = durationLabel(spanMs);
        const pct = (s.price / history.priceAt(s.ts - spanMs) - 1) * 100;
        const shown = Math.abs(pct) < 0.005 ? 0 : pct;
        const arrow = shown > 0 ? '▲ ' : shown < 0 ? '▼ ' : '';
        change.textContent = `${arrow}${Math.abs(shown).toFixed(2)}% in ${span}`;
        change.className = `change ${shown > 0 ? 'up' : shown < 0 ? 'down' : ''}`;
        vol.textContent = `vol ${usdFmt.format(history.volumeUsdSince(s.ts - spanMs))}/${span}`;
      }
      paintEvent();
      meter.render(s, loadingHistory);
      aura?.setTarget(auraTarget(s, flow.read(Date.now())));
      updateTitle(s);
    },
    reset(h) {
      history = h;
      loadingHistory = true;
      // The old pair's price must not linger in the tab, and its clock must not gate the new one.
      document.title = idleTitle;
      titleAt = 0;
      last = null;
      price.reset();
      // A new pair trades on a different notional scale; its pace baseline starts fresh.
      flow = new FlowMeter();
      vol.textContent = '—';
      meter.reset();
      change.textContent = '\u00a0';
      clearEvent();
      fx.clear();
      chart.draw(h, Date.now(), settings.periodMin * 60_000);
      aura?.setTarget(CALM_AURA);
    },
    historyReady(h) {
      history = h;
      loadingHistory = false;
      chartDirty = true;
    },
    setStatus(s) {
      status.dataset.state = s.state;
      status.textContent = statusText(s, settings.source);
      // No snapshot yet: say what the empty readout is waiting for.
      if (!last && s.state === 'connecting') vol.textContent = 'Connecting to the market…';
      // Connected but no snapshot yet: waiting for the first live trade.
      if (!last && s.state === 'open') vol.textContent = 'Waiting for trades…';
    },
    setPlayback(state) {
      playback = state;
      audioToggle.dataset.state = state;
      audioToggle.disabled = state === 'starting';
      audioLabel.textContent =
        state === 'running' ? 'Stop' : state === 'starting' ? 'Starting…' : 'Listen';
      if (state === 'starting') mediaKeys.play();
      if (state === 'stopped') mediaKeys.pause();
    },
    showEvent(e) {
      chartDirty = true;
      const times = e.count > 1 ? ` ×${e.count}` : '';
      shownEvent = { text: `${eventLabel(e.kind, e.side, e.usd)}${times}`, at: Date.now() };
      lastEvent.className = isDown(e.side) ? 'down' : 'up';
      paintEvent();
    },
    trade(t) {
      if (!fresh(t.ts)) return;
      flow.add(t.side, t.price * t.qty, t.ts);
      if (!document.hidden && !reducedMotion.matches) fx.trade(t.side, t.price * t.qty);
    },
    liquidation(l) {
      // Hidden tab: nothing to see. Reduced motion: no waves, shocks or shake at all.
      if (!fresh(l.ts) || document.hidden || reducedMotion.matches) return;
      fx.liquidation(l.side, l.usd, settings.liqThresholdUsd);
      if (l.usd >= settings.liqThresholdUsd) aura?.pulseBy(0.35);
    },
    setSymbols(market, list) {
      if (list.length > 0) listed.add(market);
      pair.setOptions(list, market);
    },
  };
}
