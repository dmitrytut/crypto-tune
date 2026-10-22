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
import { el } from './dom';
import { FlowMeter } from './flow';
import { clock, usdFmt, volFmt } from './format';
import { auraTarget, CALM_AURA, css, DOWN_COLOR, isDown, tensionColor, UP_COLOR } from './palette';
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

/** Named zones under the meter, each label at the level where the zone starts. */
const METER_ZONES = [
  [0, 'Calm'],
  [TENSION_LEVELS.mid, 'Tense'],
  [TENSION_LEVELS.high, 'Shock'],
] as const;

/** Threshold marks on the track and zone names under it, positioned from TENSION_LEVELS. */
function buildMeterScale(track: HTMLElement, scale: HTMLElement): void {
  for (const [v, name] of METER_ZONES) {
    const pct = (v / METER_MAX) * 100;
    if (v > 0) {
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

const arrowOf = (d: number) => (d > 0.2 ? '▲' : d < -0.2 ? '▼' : '•');

export function mountApp(initial: Settings, handlers: AppHandlers): AppView {
  let settings = initial;
  let symbols = new Set<string>();
  const update = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    if ('source' in patch) syncSymbolChip();
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
  const title = el('title');
  const audioLabel = el('audio-label');
  // Raw metric readouts are for tuning, not for listeners: shown only with ?debug in the URL.
  el('debug').hidden = !new URLSearchParams(location.search).has('debug');
  const vol = el('vol');
  const lastEvent = el('last-event');
  const audioToggle = el<HTMLButtonElement>('audio-toggle');
  const symbol = el<HTMLInputElement>('symbol');
  const symbolList = el<HTMLDataListElement>('symbols');
  const symbolError = el('symbol-error');
  const debug = {
    tension: el('tension'),
    direction: el('direction'),
    z: el('z'),
    volz: el('volz'),
    emaz: el('emaz'),
    warmup: el('warmup'),
  };

  audioToggle.addEventListener('click', () => handlers.onToggleAudio());

  const syncSymbolChip = () => {
    const live = settings.source === 'live';
    symbol.disabled = !live;
    symbol.value = live ? settings.symbol : 'SIMULATOR';
    title.textContent = live
      ? `${settings.symbol} futures, played as sound`
      : 'A simulated market, played as sound';
    symbolError.hidden = true;
  };
  syncSymbolChip();
  symbol.addEventListener('change', () => {
    const next = symbol.value.trim().toUpperCase();
    // Without a loaded list (REST unreachable) accept any well-formed symbol.
    const valid = SYMBOL_PATTERN.test(next) && (symbols.size === 0 || symbols.has(next));
    symbolError.hidden = valid;
    symbolError.textContent = valid ? '' : `${next || '∅'}: no such pair on Binance Futures`;
    if (!valid) return;
    symbol.value = next;
    symbol.blur();
    if (next !== settings.symbol) update({ symbol: next });
  });

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
        chart.draw(history, last.ts);
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
      const pct = (Math.exp(s.ret) - 1) * 100;
      // Arrow and colour follow the number shown, not the smoothed direction.
      const shown = Math.abs(pct) < 0.005 ? 0 : pct;
      change.textContent = Number.isNaN(s.price)
        ? '\u00a0'
        : `${shown > 0 ? '▲' : shown < 0 ? '▼' : '•'} ${shown >= 0 ? '+' : ''}${shown.toFixed(2)}% · ${settings.windowSec}s`;
      change.className = `change ${shown > 0 ? 'up' : shown < 0 ? 'down' : ''}`;
      vol.textContent = Number.isFinite(s.volPerSec) ? `vol ${volFmt.format(s.volPerSec)}/s` : '—';
      if (s.ready) {
        fill.style.width = `${Math.min(100, (s.tension / METER_MAX) * 100)}%`;
        fill.style.backgroundColor = css(tensionColor(s.tension));
        tensionValue.textContent = s.tension.toFixed(1);
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
      for (const node of [vol, tensionValue, ...Object.values(debug)]) node.textContent = '—';
      lastEvent.textContent = '';
      change.textContent = '\u00a0';
      lastEvent.className = '';
      fill.style.width = '0';
      fill.style.backgroundColor = '';
      fx.clear();
      chart.draw(h, Date.now());
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
      lastEvent.textContent = `${what} ${usdFmt.format(e.usd)}${times}`;
      lastEvent.className = isDown(e.side) ? 'down' : 'up';
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
      symbols = new Set(list);
      symbolList.replaceChildren(
        ...list.map((s) => {
          const opt = document.createElement('option');
          opt.value = s;
          return opt;
        }),
      );
    },
  };
}
