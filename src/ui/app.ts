import type {
  FeedStatus,
  Liquidation,
  LiquidationSide,
  Trade,
  TradeSide,
} from '../feed/market-feed';
import type { MetricsSnapshot } from '../metrics/engine';
import type { HistorySeries } from '../metrics/history';
import { TENSION_LEVELS } from '../metrics/tension';
import { type Settings, SYMBOL_PATTERN } from '../settings';
import { el, usdFmt } from './dom';
import { FlowMeter } from './flow';
import { auraTarget } from './palette';
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

export interface AppHandlers {
  /** Called with the full updated settings after any control change. */
  onSettings(next: Settings): void;
  /** Start/Stop pressed; runs inside the click so the AudioContext may start. */
  onToggleAudio(): void;
}

/** What the Start/Stop button shows. */
export type PlaybackView = 'stopped' | 'starting' | 'running';

export type EventReadout =
  | { kind: 'liquidation'; side: LiquidationSide; usd: number; count: number }
  | { kind: 'trade'; side: TradeSide; usd: number; count: number };

export interface AppView {
  render(s: MetricsSnapshot): void;
  /** Clear readouts and visuals when the pipeline restarts. */
  reset(history: HistorySeries): void;
  setStatus(s: FeedStatus): void;
  setSymbols(symbols: string[]): void;
  setPlayback(state: PlaybackView): void;
  /** Last event that crossed its threshold (shown even while audio is stopped). */
  showEvent(e: EventReadout): void;
  /** Every trade, for the particle stream. */
  trade(t: Trade): void;
  /** Every liquidation, for the shock waves. */
  liquidation(l: Liquidation): void;
}

const priceFmt = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7 });
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
    symbolError.textContent = valid ? '' : `${next || '∅'}: нет такой пары на Binance Futures`;
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
  let shownPrice = Number.NaN;

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

  // ── tab title ──
  let titleAt = 0;
  const updateTitle = (s: MetricsSnapshot) => {
    if (s.ts - titleAt < TITLE_EVERY_MS || Number.isNaN(s.price)) return;
    titleAt = s.ts;
    const name = settings.source === 'live' ? settings.symbol : 'SIM';
    const hot = s.tension >= TENSION_LEVELS.mid ? ` · ⚡${s.tension.toFixed(1)}` : '';
    document.title = `${arrowOf(s.direction)} ${priceFmt.format(s.price)} · ${name}${hot}`;
  };

  return {
    render(s) {
      last = s;
      chartDirty = true;
      price.textContent = Number.isNaN(s.price) ? '—' : priceFmt.format(s.price);
      if (!Number.isNaN(shownPrice) && s.price !== shownPrice && !reducedMotion.matches) {
        // Restart the flash animation: drop the class, force a style flush, add it back.
        price.classList.remove('tick-up', 'tick-down');
        void price.offsetWidth;
        price.classList.add(s.price > shownPrice ? 'tick-up' : 'tick-down');
      }
      shownPrice = s.price;
      const pct = (Math.exp(s.ret) - 1) * 100;
      // Arrow and colour follow the number shown, not the smoothed direction.
      const shown = Math.abs(pct) < 0.005 ? 0 : pct;
      change.textContent = Number.isNaN(s.price)
        ? '\u00a0'
        : `${shown > 0 ? '▲' : shown < 0 ? '▼' : '•'} ${shown >= 0 ? '+' : ''}${shown.toFixed(2)}% за ${settings.windowSec} с`;
      change.className = `change ${shown > 0 ? 'up' : shown < 0 ? 'down' : ''}`;
      if (s.ready) {
        fill.style.width = `${Math.min(100, (s.tension / METER_MAX) * 100)}%`;
        fill.dataset.level =
          s.tension >= TENSION_LEVELS.high
            ? 'high'
            : s.tension >= TENSION_LEVELS.mid
              ? 'mid'
              : 'low';
        vol.textContent = `vol ${volFmt.format(s.volPerSec)}/s`;
      } else {
        fill.style.width = `${Math.floor(s.warmup * 100)}%`;
        fill.dataset.level = 'warmup';
        vol.textContent = `разогрев ${Math.floor(s.warmup * 100)}%`;
      }
      aura?.setTarget(auraTarget(s, flow.read(Date.now())));
      updateTitle(s);
      debug.tension.textContent = s.tension.toFixed(2);
      debug.direction.textContent = `${arrowOf(s.direction)} ${s.direction.toFixed(2)}`;
      debug.z.textContent = s.z.toFixed(2);
      debug.volz.textContent = s.volZ.toFixed(2);
      debug.emaz.textContent = s.ready ? s.emaZ.toFixed(2) : '—';
      debug.warmup.textContent = s.ready ? 'готово' : `${Math.floor(s.warmup * 100)}%`;
    },
    reset(h) {
      history = h;
      last = null;
      shownPrice = Number.NaN;
      // A new pair trades on a different notional scale; its pace baseline starts fresh.
      flow = new FlowMeter();
      for (const node of [price, vol, lastEvent, ...Object.values(debug)]) node.textContent = '—';
      change.textContent = '\u00a0';
      lastEvent.className = '';
      fill.style.width = '0';
      fill.dataset.level = 'low';
      fx.clear();
      chart.draw(h, Date.now());
      aura?.setTarget(auraTarget({ tension: 0, direction: 0, volZ: 0, emaZ: 0 }));
    },
    setStatus(s) {
      status.dataset.state = s.state;
      status.textContent = statusText(s);
    },
    setPlayback(state) {
      audioToggle.dataset.state = state;
      audioToggle.disabled = state === 'starting';
      audioToggle.setAttribute(
        'aria-label',
        state === 'running' ? 'Выключить звук' : 'Включить звук',
      );
    },
    showEvent(e) {
      chartDirty = true;
      const what =
        e.kind === 'liquidation' ? `ликв. ${e.side.toUpperCase()}` : e.side.toUpperCase();
      const times = e.count > 1 ? ` ×${e.count}` : '';
      lastEvent.textContent = `${what} ${usdFmt.format(e.usd)}${times}`;
      // A long liquidation and an aggressive sell both push price down.
      lastEvent.className = e.side === 'long' || e.side === 'sell' ? 'down' : 'up';
    },
    trade(t) {
      flow.add(t.side, t.price * t.qty, t.ts);
      if (!document.hidden && !reducedMotion.matches) fx.trade(t.side, t.price * t.qty);
    },
    liquidation(l) {
      // Hidden tab: nothing to see. Reduced motion: no waves, shocks or shake at all.
      if (document.hidden || reducedMotion.matches) return;
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
