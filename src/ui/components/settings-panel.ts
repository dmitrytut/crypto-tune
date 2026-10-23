import './settings-panel.css';
import { HISTORY_PERIODS_MIN } from '../../metrics/history';
import { LIMITS, type Settings, type SourceKind, TONICS } from '../../settings';
import { el } from '../dom';
import { durationLabel, usdFmt } from '../format';
import { mountPicker } from './picker';

/** Threshold slider resolution in decades; values snap to two significant digits. */
const LOG_STEP = 0.05;
const snapUsd = (log10: number) => Number((10 ** log10).toPrecision(2));

/** What the rest of the view may ask the settings dialog. */
export interface SettingsPanel {
  isOpen(): boolean;
}

/**
 * Binds every control in the settings dialog to `update`. The dialog opens
 * from the gear button, closes on ✕, Esc, or a click on the backdrop.
 */
export function mountSettingsPanel(
  initial: Settings,
  update: (patch: Partial<Settings>) => void,
): SettingsPanel {
  const dialog = el<HTMLDialogElement>('settings');
  el('settings-open').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (e) => {
    // A click on the dialog element itself (not its content) is a click on the backdrop.
    if (e.target === dialog) dialog.close();
  });

  const tonic = mountPicker(el('tonic'), {
    label: 'Tonic',
    onPick: (value) => {
      const t = TONICS.find((x) => x === value);
      if (t) update({ tonic: t });
    },
  });
  tonic.setOptions(TONICS);
  tonic.set(initial.tonic);

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="source"]')) {
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
  return { isOpen: () => dialog.open };
}
