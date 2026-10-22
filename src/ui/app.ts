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
import { el, usdFmt } from './dom';
import { FlowMeter } from './flow';
import { clock, priceDecimals, splitPrice } from './format';
import { auraTarget, css, DOWN_COLOR, isDown, tensionColor, UP_COLOR } from './palette';
import { Aura } from './scene/aura';
import { Chart } from './scene/chart';
import { Fx } from './scene/fx';
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

const volFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function statusText(s: FeedStatus): string {
  switch (s.state) {
    case 'connecting':
      return s.attempt > 1 ? `connecting #${s.attempt}` : 'connecting';
    case 'reconnecting':
      return `${s.reason}, retry in ${Math.ceil(s.inMs / 1000)}s`;
    case 'error':
      return `error: ${s.message}`;
    default:
      return s.state;
  }
}

/** Threshold marks on the track and value labels under it, positioned from TENSION_LEVELS. */
function buildMeterScale(track: HTMLElement, scale: HTMLElement): void {
  for (const v of [0, TENSION_LEVELS.mid, TENSION_LEVELS.high, METER_MAX]) {
    const pct = (v / METER_MAX) * 100;
    if (v > 0 && v < METER_MAX) {
      const mark = document.createElement('span');
      mark.className = 'meter-mark';
      mark.style.left = `${pct}%`;
      track.append(mark);
    }
    const label = document.createElement('span');
    label.textContent = String(v);
    label.style.left = `${pct}%`;
    // Edge labels align inward so they never overflow the meter.
    label.style.transform = `translateX(${v === 0 ? 0 : v === METER_MAX ? -100 : -50}%)`;
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
  mountSettingsPanel(initial, update);
  // CSS reads the side colours from the palette, so text and canvas never drift apart.
  document.documentElement.style.setProperty('--up', css(UP_COLOR));
  document.documentElement.style.setProperty('--down', css(DOWN_COLOR));

  const status = el('status');
  const price = el('price');
  const change = el('change');
  const fill = el('tension-fill');
  buildMeterScale(el('tension-track'), el('tension-scale'));
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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const aura = Aura.create(el('aura'), auraTarget({ tension: 0, direction: 0, volZ: 0, emaZ: 0 }));
  const stage = document.querySelector<HTMLElement>('.stage');
  const fx = new Fx(el('fx'), {
    bloom: (x, y, color, strength) => aura?.bloom(x, y, color, strength),
    shock: (x, y, strength) => aura?.shock(x, y, strength),
    shake: (strength) => {
      const a = 3 + 5 * strength;
      stage?.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${a}px, ${-a * 0.6}px)` },
          { transform: `translate(${-a * 0.8}px, ${a * 0.5}px)` },
          { transform: `translate(${a * 0.4}px, ${a * 0.3}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 420, easing: 'ease-out' },
      );
    },
  });
  const chart = new Chart(el('chart'));
  let flow = new FlowMeter();
  let history: HistorySeries | null = null;
  let last: MetricsSnapshot | null = null;
  let chartDirty = false;

  const placeOrigin = () => {
    const r = price.getBoundingClientRect();
    fx.setOrigin(r.left + r.width / 2, r.top + r.height / 2);
  };
  new ResizeObserver(placeOrigin).observe(price);
  window.addEventListener('resize', placeOrigin);
  document.addEventListener('visibilitychange', () => {
    // Events received while hidden were not queued; nothing stale to burst on return.
    if (!document.hidden) fx.clear();
  });

  let prevFrame = performance.now();
  const frame = (t: number) => {
    const dt = (t - prevFrame) / 1000;
    prevFrame = t;
    // Reduced motion: the aura barely drifts and no particles fly.
    aura?.frame(reducedMotion.matches ? dt * 0.1 : dt);
    // Reduced motion: no new events are queued; clearing also wipes anything already
    // flying when the preference flips mid-session, so nothing freezes on screen.
    if (reducedMotion.matches) fx.clear();
    fx.frame(dt, settings.tradeThresholdUsd);
    if (chartDirty && history && last) {
      chart.draw(history, last.ts);
      chartDirty = false;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ── immersive mode ──
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!el<HTMLDialogElement>('settings').open) document.body.classList.add('idle');
    }, IDLE_MS);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(ev, wake, { passive: true });
  }
  wake();

  // ── price: per-pair fixed decimals; only the digits that changed flash ──
  let decimals = -1;
  let priceText = '';
  const formatPrice = (p: number) => {
    if (decimals < 0) decimals = priceDecimals(p);
    return splitPrice(p, decimals);
  };
  const renderPrice = (p: number) => {
    if (Number.isNaN(p)) return;
    const { int, frac } = formatPrice(p);
    const text = int + frac;
    if (text === priceText) return;
    const prev = priceText;
    const up = Number(text.replaceAll(',', '')) > Number(prev.replaceAll(',', ''));
    // Only compare digit by digit when the layout is the same; otherwise nothing flashes.
    const flash = prev.length === text.length && !reducedMotion.matches;
    priceText = text;
    const part = (chars: string, offset: number, cls: string) => {
      const box = document.createElement('span');
      box.className = cls;
      for (const [i, ch] of [...chars].entries()) {
        const c = document.createElement('span');
        if (ch === ',' || ch === '.') c.className = 'sep';
        else if (flash && prev[offset + i] !== ch) c.className = up ? 'chg up' : 'chg down';
        c.textContent = ch;
        box.append(c);
      }
      return box;
    };
    price.replaceChildren(part(int, 0, 'int'), part(frac, int.length, 'frac'));
  };

  // ── tab title ──
  const idleTitle = document.title;
  let titleAt = 0;
  const updateTitle = (s: MetricsSnapshot) => {
    if (s.ts - titleAt < TITLE_EVERY_MS || Number.isNaN(s.price)) return;
    titleAt = s.ts;
    const name = settings.source === 'live' ? settings.symbol : 'SIM';
    const hot = s.tension >= TENSION_LEVELS.mid ? ` · ⚡${s.tension.toFixed(1)}` : '';
    const { int, frac } = formatPrice(s.price);
    document.title = `${arrowOf(s.direction)} ${int}${frac} · ${name}${hot}`;
  };

  return {
    render(s) {
      last = s;
      chartDirty = true;
      renderPrice(s.price);
      const pct = (Math.exp(s.ret) - 1) * 100;
      // Arrow and colour follow the number shown, not the smoothed direction.
      const shown = Math.abs(pct) < 0.005 ? 0 : pct;
      change.textContent = Number.isNaN(s.price)
        ? '\u00a0'
        : `${shown > 0 ? '▲' : shown < 0 ? '▼' : '•'} ${shown >= 0 ? '+' : ''}${shown.toFixed(2)}% · ${settings.windowSec}s`;
      change.className = `change ${shown > 0 ? 'up' : shown < 0 ? 'down' : ''}`;
      if (s.ready) {
        fill.style.width = `${Math.min(100, (s.tension / METER_MAX) * 100)}%`;
        fill.style.backgroundColor = css(tensionColor(s.tension));
        vol.textContent = `vol ${volFmt.format(s.volPerSec)}/s`;
      } else {
        // Tension needs a few minutes of this market's own statistics before it means anything.
        fill.style.width = `${Math.floor(s.warmup * 100)}%`;
        fill.style.backgroundColor = '';
        vol.textContent = `calibrating tension · ${clock(s.warmupLeftSec)}`;
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
      decimals = -1;
      priceText = '';
      // A new pair trades on a different notional scale; its pace baseline starts fresh.
      flow = new FlowMeter();
      for (const node of [price, vol, ...Object.values(debug)]) node.textContent = '—';
      lastEvent.textContent = '';
      change.textContent = '\u00a0';
      lastEvent.className = '';
      fill.style.width = '0';
      fill.style.backgroundColor = '';
      fx.clear();
      chart.draw(h, Date.now());
      aura?.setTarget(auraTarget({ tension: 0, direction: 0, volZ: 0, emaZ: 0 }));
    },
    setStatus(s) {
      status.dataset.state = s.state;
      status.textContent = statusText(s);
      // Connected but no snapshot yet: the feed is replaying history before live trades flow.
      if (s.state === 'open' && !last) vol.textContent = 'loading history…';
    },
    setPlayback(state) {
      audioToggle.dataset.state = state;
      audioToggle.disabled = state === 'starting';
      audioToggle.setAttribute('aria-label', state === 'running' ? 'Stop sound' : 'Start sound');
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
