import './settings-panel.css';
import { HISTORY_PERIODS_MIN } from '../../../metrics/history';
import { LIMITS, type Settings, type SourceKind, TONICS } from '../../../settings';
import { el } from '../../dom';
import { durationLabel, usdFmt } from '../../format';
import { createHint } from '../hint/hint';
import { type Modal, mountModal } from '../modal/modal';
import { mountPicker } from '../picker/picker';

/** Threshold slider resolution in decades; values snap to two significant digits. */
const LOG_STEP = 0.05;
const snapUsd = (log10: number) => Number((10 ** log10).toPrecision(2));

/**
 * The ⓘ tip of every setting: what it is and what it changes, for a listener rather than a
 * trader. Keyed by the control's id; the tip goes into the `.field-head` row just before it.
 */
const HELP: Record<string, { label: string; text: string }> = {
  period: {
    label: 'Period',
    text: 'How far back the price change, the volume and the chart look.',
  },
  tonic: {
    label: 'Tonic',
    text: 'The key the music is in. It changes only the pitch, not how the music reacts.',
  },
  'base-volume': {
    label: 'Base',
    text: 'Volume of the calm background that always plays: drone, melody and bells.',
  },
  'tension-volume': {
    label: 'Tension',
    text: 'Volume of what joins when the market gets tense: bass, shaker and a rising noise.',
  },
  'events-volume': {
    label: 'Events',
    text: 'Volume of liquidation gongs, large-trade plucks and any enabled interaction sounds.',
  },
  'interaction-sound': {
    label: 'Interaction sounds',
    text: 'Optional quiet accents when you tap or drag through particles. They play only while Listen is on.',
  },
  window: {
    label: 'Price-change window',
    text:
      'How many seconds of price movement count as one move. Shorter catches quick spikes, ' +
      'longer only steadier moves. Changing it restarts the analysis.',
  },
  sensitivity: {
    label: 'Sensitivity',
    text:
      'How easily the music tenses up. Above ×1 smaller moves are enough; below ×1 it waits ' +
      'for bigger ones.',
  },
  'liq-threshold': {
    label: 'Liquidation threshold',
    text:
      "A liquidation is a trader's position closed by force. Ones at least this big sound as " +
      'a gong and get a dot on the chart.',
  },
  'trade-threshold': {
    label: 'Large trade threshold',
    text:
      'Single market orders at least this big sound as a pluck and get a dot on the chart. ' +
      'Lower both thresholds for small coins.',
  },
  source: {
    label: 'Source',
    text:
      'Live plays the real Binance futures market. Simulator plays a made-up market with ' +
      'regular sell-offs and rallies, to hear every sound quickly.',
  },
};

/**
 * Binds every control in the settings dialog to `update`. The dialog opens
 * from the gear button, closes on ✕, Esc, or a click on the backdrop.
 */
export function mountSettingsPanel(
  initial: Settings,
  update: (patch: Partial<Settings>) => void,
): Modal {
  const dialog = el<HTMLDialogElement>('settings');
  const modal = mountModal('settings', 'settings-open');

  for (const [id, { label, text }] of Object.entries(HELP)) {
    const head = el(id).previousElementSibling;
    if (!head) throw new Error(`#${id} needs its label just before it in index.html`);
    head.append(createHint(label, { text }).root);
  }

  const tonic = mountPicker(el('tonic'), {
    label: 'Tonic',
    onPick: (value) => {
      const t = TONICS.find((x) => x === value);
      if (t) update({ tonic: t });
    },
  });
  tonic.setOptions(TONICS);
  tonic.set(initial.tonic);

  for (const radio of dialog.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
    radio.checked = radio.value === initial.source;
    radio.addEventListener('change', () => {
      if (radio.checked) update({ source: radio.value as SourceKind });
    });
  }

  // Period of the change, volume and chart: one radio per HISTORY_PERIODS_MIN, labelled 1m … 1h.
  el('period').replaceChildren(
    ...HISTORY_PERIODS_MIN.map((periodMin) => {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'period';
      radio.className = 'visually-hidden';
      radio.value = String(periodMin);
      radio.checked = periodMin === initial.periodMin;
      radio.addEventListener('change', () => {
        if (radio.checked) update({ periodMin });
      });
      const label = document.createElement('label');
      label.append(radio, durationLabel(periodMin * 60_000));
      return label;
    }),
  );

  const range = (
    id: string,
    limits: { min: number; max: number; step: number },
    value: number,
    format: (v: number) => string,
    apply: (v: number) => void,
    commitOn: 'input' | 'change' = 'input',
  ) => {
    const input = el<HTMLInputElement>(id);
    const out = el<HTMLOutputElement>(`${id}-out`);
    // The readout with its unit ("-6 dB", "$20K"), hidden from assistive tech: it is what a
    // screen reader speaks as the slider's value, instead of the raw (often log10) position.
    const readout = out.closest('.field-value');
    if (!readout) throw new Error(`#${id}-out needs a .field-value wrapper in index.html`);
    const show = (v: number) => {
      out.value = format(v);
      input.setAttribute('aria-valuetext', readout.textContent ?? out.value);
    };
    input.min = String(limits.min);
    input.max = String(limits.max);
    input.step = String(limits.step);
    input.value = String(value);
    show(value);
    input.addEventListener('input', () => show(Number(input.value)));
    input.addEventListener(commitOn, () => apply(Number(input.value)));
  };
  // Notional thresholds: the slider moves log10(USD) so each decade gets equal travel.
  const usdRange = (
    id: string,
    limits: { min: number; max: number },
    value: number,
    apply: (usd: number) => void,
  ) =>
    range(
      id,
      { min: Math.log10(limits.min), max: Math.log10(limits.max), step: LOG_STEP },
      Math.log10(value),
      (v) => usdFmt.format(snapUsd(v)),
      (v) => apply(snapUsd(v)),
      'change',
    );

  range('base-volume', LIMITS.layerVolumeDb, initial.baseVolumeDb, String, (v) =>
    update({ baseVolumeDb: v }),
  );
  range('tension-volume', LIMITS.layerVolumeDb, initial.tensionVolumeDb, String, (v) =>
    update({ tensionVolumeDb: v }),
  );
  range('events-volume', LIMITS.layerVolumeDb, initial.eventsVolumeDb, String, (v) =>
    update({ eventsVolumeDb: v }),
  );
  const interactionSound = el<HTMLInputElement>('interaction-sound');
  interactionSound.checked = initial.interactionSound;
  interactionSound.addEventListener('change', () =>
    update({ interactionSound: interactionSound.checked }),
  );
  // Window change resets metrics, so commit only on release.
  range(
    'window',
    LIMITS.windowSec,
    initial.windowSec,
    String,
    (v) => update({ windowSec: v }),
    'change',
  );
  range(
    'sensitivity',
    LIMITS.sensitivity,
    initial.sensitivity,
    (v) => v.toFixed(2),
    (v) => update({ sensitivity: v }),
  );
  usdRange('liq-threshold', LIMITS.liqThresholdUsd, initial.liqThresholdUsd, (usd) =>
    update({ liqThresholdUsd: usd }),
  );
  usdRange('trade-threshold', LIMITS.tradeThresholdUsd, initial.tradeThresholdUsd, (usd) =>
    update({ tradeThresholdUsd: usd }),
  );
  return modal;
}
