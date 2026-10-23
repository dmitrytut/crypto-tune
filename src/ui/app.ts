import type {
  FeedStatus,
  Liquidation,
  LiquidationSide,
  Trade,
  TradeSide,
} from '../feed/market-feed';
import { DEFAULT_METRICS_CONFIG, type MetricsSnapshot } from '../metrics/engine';
import type { EventCue } from '../metrics/events';
import type { HistorySeries } from '../metrics/history';
import { TENSION_LEVELS } from '../metrics/tension';
import { type Settings, SYMBOL_PATTERN } from '../settings';
import { el } from './dom';
import { FlowMeter } from './flow';
import { clock, durationLabel, usdFmt } from './format';
import { auraTarget, CALM_AURA, css, DOWN_COLOR, isDown, tensionColor, UP_COLOR } from './palette';
import { mountPicker } from './picker';
import { PriceReadout } from './price-readout';
import { mountStage } from './scene/stage';
import { mountSettingsPanel } from './settings-panel';
import './styles.css';

/** Tension value at the right edge of the meter. */
const METER_MAX = 5;
/** Chrome fades after this long without pointer or keyboard input. */
const IDLE_MS = 10_000;
const TITLE_EVERY_MS = 1_000;
/** Events older than this (wall clock) are history replays, not news: no sparks, no flow. */
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
  /** Clear readouts and visuals when the pipeline restarts. */
  reset(history: HistorySeries): void;
  setStatus(s: FeedStatus): void;
  setSymbols(symbols: string[]): void;
  setPlayback(state: PlaybackView): void;
  /** Last event that crossed its threshold (shown even while audio is stopped). */
  showEvent(e: EventReadout): void;
  /** Every trade, for the flow and the particle stream; replayed history is ignored. */
  trade(t: Trade): void;
  /** Every liquidation, for the shock waves; replayed history is ignored. */
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

/** Named zones of the meter, each starting at its level, and what the music does there. */
const METER_ZONES = [
  { from: 0, name: 'Calm', sound: 'the base drone and arpeggio' },
  { from: TENSION_LEVELS.mid, name: 'Tense', sound: 'tempo and filter rise, sub and shaker join' },
  { from: TENSION_LEVELS.high, name: 'Shock', sound: 'double time and noise, the aura tears' },
] as const;

/** Threshold marks on the track and zone names under it, positioned from TENSION_LEVELS. */
function buildMeterScale(track: HTMLElement, scale: HTMLElement): void {
  for (const { from, name } of METER_ZONES) {
    const pct = (from / METER_MAX) * 100;
    if (from > 0) {
      const mark = document.createElement('span');
      mark.className = 'meter-mark';
      mark.style.left = `${pct}%`;
      track.append(mark);
    }
    const label = document.createElement('span');
    label.textContent = name;
    label.style.left = `${pct}%`;
    scale.append(label);
  }
}

/** Tooltip body for the meter: what tension measures and what each zone sounds like. */
function fillTensionHelp(node: HTMLElement, windowSec: number): void {
  const intro = document.createElement('p');
  intro.textContent =
    `How unusual the price move of the last ${windowSec}\u00a0s is for this market, ` +
    `against its own moves over the last ${DEFAULT_METRICS_CONFIG.statsWindowMin}\u00a0min.`;
  const zones = document.createElement('ul');
  for (const { from, name, sound } of METER_ZONES) {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = from > 0 ? `${name} (${from}+)` : name;
    li.append(b, `: ${sound}.`);
    zones.append(li);
  }
  const tune = document.createElement('p');
  tune.textContent = 'Sensitivity in settings scales it.';
  node.replaceChildren(intro, zones, tune);
}

/**
 * A label that explains itself: hover or keyboard focus shows the tip (CSS), a click or tap
 * pins it, Esc or a press anywhere else closes it.
 */
function mountHint(root: HTMLElement, button: HTMLButtonElement): void {
  const set = (open: boolean) => {
    root.toggleAttribute('data-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  set(false);
  button.addEventListener('click', () => set(!root.hasAttribute('data-open')));
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Node && root.contains(e.target))) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
}

const arrowOf = (d: number) => (d > 0.2 ? '▲' : d < -0.2 ? '▼' : '•');

export function mountApp(initial: Settings, handlers: AppHandlers): AppView {
  let settings = initial;
  const update = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    if ('source' in patch || 'symbol' in patch) syncPair();
    if ('windowSec' in patch) fillTensionHelp(tensionHelp, settings.windowSec);
    if ('periodMin' in patch) chartDirty = true;
    handlers.onSettings(settings);
  };
  const panel = mountSettingsPanel(initial, update);
  // CSS reads the side colours from the palette, so text and canvas never drift apart.
  document.documentElement.style.setProperty('--up', css(UP_COLOR));
  document.documentElement.style.setProperty('--down', css(DOWN_COLOR));

  const status = el('status');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const priceNode = el('price');
  const price = new PriceReadout(priceNode, reducedMotion);
  const change = el('change');
  const fill = el('tension-fill');
  buildMeterScale(el('tension-track'), el('tension-scale'));
  const tensionValue = el('tension-value');
  const tensionHelp = el('tension-help');
  fillTensionHelp(tensionHelp, settings.windowSec);
  mountHint(el('tension-hint'), el<HTMLButtonElement>('tension-hint-btn'));
  const title = el('title');
  const audioLabel = el('audio-label');
  // Raw metric readouts are for tuning, not for listeners: shown only with ?debug in the URL.
  el('debug').hidden = !new URLSearchParams(location.search).has('debug');
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
    search: {
      placeholder: 'Search pairs',
      empty: 'No such pair on Binance Futures',
      // Without a loaded list (REST unreachable) any well-formed symbol can be tried as typed.
      fallback: (query) => {
        const s = query.toUpperCase();
        return pairList.length === 0 && SYMBOL_PATTERN.test(s) ? s : null;
      },
    },
    onPick: (symbol) => update({ symbol }),
  });
  let pairList: readonly string[] = [];
  const debug = {
    tension: el('tension'),
    direction: el('direction'),
    z: el('z'),
    volz: el('volz'),
    emaz: el('emaz'),
    warmup: el('warmup'),
  };

  audioToggle.addEventListener('click', () => handlers.onToggleAudio());

  const syncPair = () => {
    const live = settings.source === 'live';
    if (live) pair.set(settings.symbol);
    else pair.disable('Simulator');
    title.textContent = live
      ? `${settings.symbol} futures, played as sound`
      : 'A simulated market, played as sound';
  };
  syncPair();

  // ── scene ──
  let flow = new FlowMeter();
  let history: HistorySeries | null = null;
  let last: MetricsSnapshot | null = null;
  let chartDirty = false;
  const { aura, fx, chart } = mountStage({
    origin: priceNode,
    reducedMotion,
    bigTradeUsd: () => settings.tradeThresholdUsd,
    onFrame() {
      if (chartDirty && history && last) {
        chart.draw(history, last.ts, settings.periodMin * 60_000);
        chartDirty = false;
      }
    },
  });

  // ── immersive mode ──
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!panel.isOpen()) document.body.classList.add('idle');
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
      // there is while it is shorter.
      const first = history?.prices[0];
      if (!history || !first || Number.isNaN(s.price)) {
        change.textContent = '\u00a0';
        change.className = 'change';
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
      if (s.ready) {
        fill.style.width = `${Math.min(100, (s.tension / METER_MAX) * 100)}%`;
        fill.style.backgroundColor = css(tensionColor(s.tension));
        tensionValue.textContent = '';
      } else {
        // Tension needs a few minutes of this market's own statistics before it means anything.
        fill.style.width = `${Math.floor(s.warmup * 100)}%`;
        fill.style.backgroundColor = '';
        tensionValue.textContent = `calibrating · ${clock(s.warmupLeftSec)}`;
      }
      aura?.setTarget(auraTarget(s, flow.read(Date.now())));
      updateTitle(s);
      debug.tension.textContent = s.tension.toFixed(2);
      debug.direction.textContent = `${arrowOf(s.direction)} ${s.direction.toFixed(2)}`;
      debug.z.textContent = s.z.toFixed(2);
      debug.volz.textContent = s.volZ.toFixed(2);
      debug.emaz.textContent = s.ready ? s.emaZ.toFixed(2) : '—';
      debug.warmup.textContent = s.ready ? 'ready' : `${Math.floor(s.warmup * 100)}%`;
    },
    reset(h) {
      history = h;
      // The old pair's price must not linger in the tab, and its clock must not gate the new one.
      document.title = idleTitle;
      titleAt = 0;
      last = null;
      price.reset();
      // A new pair trades on a different notional scale; its pace baseline starts fresh.
      flow = new FlowMeter();
      vol.textContent = '—';
      tensionValue.textContent = '';
      for (const node of Object.values(debug)) node.textContent = '—';
      change.textContent = '\u00a0';
      clearEvent();
      fill.style.width = '0';
      fill.style.backgroundColor = '';
      fx.clear();
      chart.draw(h, Date.now(), settings.periodMin * 60_000);
      aura?.setTarget(CALM_AURA);
    },
    setStatus(s) {
      status.dataset.state = s.state;
      status.textContent = statusText(s, settings.source);
      // No snapshot yet: say what the empty readout is waiting for.
      if (!last && s.state === 'connecting') vol.textContent = 'Connecting to the market…';
      // Connected but no snapshot yet: the feed is replaying history before live trades flow.
      if (!last && s.state === 'open') vol.textContent = 'Loading recent trades…';
    },
    setPlayback(state) {
      audioToggle.dataset.state = state;
      audioToggle.disabled = state === 'starting';
      audioLabel.textContent =
        state === 'running' ? 'Stop' : state === 'starting' ? 'Starting…' : 'Listen';
    },
    showEvent(e) {
      chartDirty = true;
      const what = e.kind === 'liquidation' ? `LIQ ${e.side.toUpperCase()}` : e.side.toUpperCase();
      const times = e.count > 1 ? ` ×${e.count}` : '';
      shownEvent = { text: `${what} ${usdFmt.format(e.usd)}${times}`, at: Date.now() };
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
    setSymbols(list) {
      pairList = list;
      pair.setOptions(list);
    },
  };
}
