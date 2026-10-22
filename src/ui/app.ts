import type { FeedStatus } from '../feed/market-feed';
import type { MetricsSnapshot } from '../metrics/engine';
import { TENSION_LEVELS } from '../metrics/tension';
import { LIMITS, type Settings, type SourceKind, SYMBOL_PATTERN, TONICS } from '../settings';
import './styles.css';

/** Tension value at the right edge of the meter. */
const METER_MAX = 5;

export interface AppHandlers {
  /** Called with the full updated settings after any control change. */
  onSettings(next: Settings): void;
  /** Start/Stop pressed; runs inside the click so the AudioContext may start. */
  onToggleAudio(): void;
}

/** What the Start/Stop button shows. */
export type PlaybackView = 'stopped' | 'starting' | 'running';

export interface AppView {
  render(s: MetricsSnapshot): void;
  /** Clear readouts when the pipeline restarts so stale numbers never show under a new label. */
  reset(): void;
  setStatus(s: FeedStatus): void;
  setFeedLabel(label: string): void;
  setSymbols(symbols: string[]): void;
  setPlayback(state: PlaybackView): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing in index.html`);
  return node as T;
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
  const stops = [0, TENSION_LEVELS.mid, TENSION_LEVELS.high, METER_MAX];
  for (const v of stops) {
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

export function mountApp(initial: Settings, handlers: AppHandlers): AppView {
  let settings = initial;
  let symbols = new Set<string>();
  const update = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    handlers.onSettings(settings);
  };

  const status = el('status');
  const label = el('feed-label');
  const price = el('price');
  const fill = el('tension-fill');
  buildMeterScale(el('tension-track'), el('tension-scale'));
  const tension = el('tension');
  const direction = el('direction');
  const z = el('z');
  const volz = el('volz');
  const vol = el('vol');
  const warmup = el('warmup');
  const symbol = el<HTMLInputElement>('symbol');
  const symbolList = el<HTMLDataListElement>('symbols');
  const symbolError = el('symbol-error');
  const windowIn = el<HTMLInputElement>('window');
  const windowOut = el<HTMLOutputElement>('window-out');
  const sens = el<HTMLInputElement>('sensitivity');
  const sensOut = el<HTMLOutputElement>('sens-out');
  const emaz = el('emaz');
  const audioToggle = el<HTMLButtonElement>('audio-toggle');
  const tonic = el<HTMLSelectElement>('tonic');
  const baseVol = el<HTMLInputElement>('base-volume');
  const baseVolOut = el<HTMLOutputElement>('base-vol-out');
  const tensionVol = el<HTMLInputElement>('tension-volume');
  const tensionVolOut = el<HTMLOutputElement>('tension-vol-out');

  audioToggle.addEventListener('click', () => handlers.onToggleAudio());

  tonic.replaceChildren(
    ...TONICS.map((t) => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = t;
      return opt;
    }),
  );
  tonic.value = settings.tonic;
  tonic.addEventListener('change', () => {
    update({ tonic: TONICS.find((t) => t === tonic.value) ?? settings.tonic });
  });

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
    radio.checked = radio.value === settings.source;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      symbol.disabled = radio.value !== 'live';
      update({ source: radio.value as SourceKind });
    });
  }

  symbol.value = settings.symbol;
  symbol.disabled = settings.source !== 'live';
  symbol.addEventListener('change', () => {
    const next = symbol.value.trim().toUpperCase();
    // Without a loaded list (REST unreachable) accept any well-formed symbol.
    const valid = SYMBOL_PATTERN.test(next) && (symbols.size === 0 || symbols.has(next));
    symbolError.hidden = valid;
    symbolError.textContent = valid ? '' : `${next || '∅'}: нет такой пары на Binance Futures`;
    if (!valid) return;
    symbol.value = next;
    if (next !== settings.symbol) update({ symbol: next });
  });

  const bindRange = (
    input: HTMLInputElement,
    out: HTMLOutputElement,
    limits: { min: number; max: number; step: number },
    value: number,
    format: (v: number) => string,
    apply: (v: number) => void,
    commitOn: 'input' | 'change',
  ) => {
    input.min = String(limits.min);
    input.max = String(limits.max);
    input.step = String(limits.step);
    input.value = String(value);
    out.value = format(value);
    input.addEventListener('input', () => {
      out.value = format(Number(input.value));
    });
    input.addEventListener(commitOn, () => apply(Number(input.value)));
  };
  // Window change resets metrics, so commit only on release.
  bindRange(
    windowIn,
    windowOut,
    LIMITS.windowSec,
    settings.windowSec,
    String,
    (v) => update({ windowSec: v }),
    'change',
  );
  bindRange(
    sens,
    sensOut,
    LIMITS.sensitivity,
    settings.sensitivity,
    (v) => v.toFixed(2),
    (v) => update({ sensitivity: v }),
    'input',
  );
  bindRange(
    baseVol,
    baseVolOut,
    LIMITS.layerVolumeDb,
    settings.baseVolumeDb,
    String,
    (v) => update({ baseVolumeDb: v }),
    'input',
  );
  bindRange(
    tensionVol,
    tensionVolOut,
    LIMITS.layerVolumeDb,
    settings.tensionVolumeDb,
    String,
    (v) => update({ tensionVolumeDb: v }),
    'input',
  );

  return {
    render(s) {
      price.textContent = Number.isNaN(s.price) ? '—' : priceFmt.format(s.price);
      fill.style.width = `${Math.min(100, (s.tension / METER_MAX) * 100)}%`;
      fill.dataset.level =
        s.tension >= TENSION_LEVELS.high ? 'high' : s.tension >= TENSION_LEVELS.mid ? 'mid' : 'low';
      tension.textContent = s.tension.toFixed(2);
      const arrow = s.direction > 0.2 ? '▲' : s.direction < -0.2 ? '▼' : '•';
      direction.textContent = `${arrow} ${s.direction.toFixed(2)}`;
      direction.className = s.direction > 0.2 ? 'up' : s.direction < -0.2 ? 'down' : '';
      z.textContent = s.z.toFixed(2);
      volz.textContent = s.volZ.toFixed(2);
      vol.textContent = volFmt.format(s.volPerSec);
      warmup.textContent = s.ready ? 'готово' : `${Math.floor(s.warmup * 100)}%`;
      emaz.textContent = s.ready ? s.emaZ.toFixed(2) : '—';
    },
    reset() {
      for (const node of [price, tension, direction, z, volz, vol, warmup, emaz]) {
        node.textContent = '—';
      }
      direction.className = '';
      fill.style.width = '0';
      fill.dataset.level = 'low';
    },
    setStatus(s) {
      status.dataset.state = s.state;
      status.textContent = statusText(s);
    },
    setFeedLabel(text) {
      label.textContent = text;
    },
    setPlayback(state) {
      audioToggle.dataset.state = state;
      audioToggle.disabled = state === 'starting';
      audioToggle.textContent =
        state === 'running' ? '■ Stop' : state === 'starting' ? '…' : '▶ Start';
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
