import './meter.css';
import { DEFAULT_METRICS_CONFIG, type MetricsSnapshot } from '../../../metrics/engine';
import { TENSION_LEVELS } from '../../../metrics/tension';
import { el } from '../../dom';
import { clock } from '../../format';
import { css, tensionColor } from '../../palette';
import { createHint } from '../hint/hint';

/** Tension value at the right edge of the meter. */
const METER_MAX = 5;

/** Named zones of the meter, each starting at its level, and what the music does there. */
const METER_ZONES = [
  { from: 0, name: 'Calm', sound: 'the base drone and arpeggio' },
  { from: TENSION_LEVELS.mid, name: 'Tense', sound: 'tempo and filter rise, sub and shaker join' },
  { from: TENSION_LEVELS.high, name: 'Shock', sound: 'double time and noise, the aura tears' },
] as const;

/**
 * The tension meter in index.html (`#tension-*`): a track coloured by tension, threshold marks
 * with zone names, a hint explaining what it measures, and the calibration countdown while
 * tension is still warming up. Mounted once for the page's lifetime.
 */
export class TensionMeter {
  private readonly track = el('tension-track');
  private readonly fill = el('tension-fill');
  private readonly value = el('tension-value');
  private readonly help = createHint('Tension', { showLabel: true });

  constructor(windowSec: number) {
    const track = this.track;
    // The fill is the reading; assistive tech gets it as a meter with the zone in words.
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', 'Tension');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(METER_MAX));
    this.setReading(0, 'Calm');
    const scale = el('tension-scale');
    // The zone names under the track repeat what the meter's value text says.
    scale.setAttribute('aria-hidden', 'true');
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
    // The label opens the meter's head; the calibration countdown sits after it.
    this.value.before(this.help.root);
    this.setWindow(windowSec);
  }

  /** The hint names the return window N, which the user can change. */
  setWindow(windowSec: number): void {
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
    this.help.body.replaceChildren(intro, zones, tune);
  }

  render(s: Pick<MetricsSnapshot, 'ready' | 'tension' | 'warmup' | 'warmupLeftSec'>): void {
    if (s.ready) {
      this.fill.style.width = `${Math.min(100, (s.tension / METER_MAX) * 100)}%`;
      this.fill.style.backgroundColor = css(tensionColor(s.tension));
      this.value.textContent = '';
      const zone = METER_ZONES.findLast(({ from }) => s.tension >= from) ?? METER_ZONES[0];
      this.setReading(s.tension, `${zone.name}, ${s.tension.toFixed(1)}`);
    } else {
      // Tension needs a few minutes of this market's own statistics before it means anything.
      this.fill.style.width = `${Math.floor(s.warmup * 100)}%`;
      this.fill.style.backgroundColor = '';
      this.value.textContent = `calibrating · ${clock(s.warmupLeftSec)}`;
      this.setReading(0, `Calibrating, ${clock(s.warmupLeftSec)} left`);
    }
  }

  reset(): void {
    this.fill.style.width = '0';
    this.fill.style.backgroundColor = '';
    this.value.textContent = '';
    this.setReading(0, 'Calm');
  }

  /** The meter's value for assistive tech; written only when the spoken text changes. */
  private setReading(tension: number, text: string): void {
    if (this.track.getAttribute('aria-valuetext') === text) return;
    this.track.setAttribute('aria-valuenow', Math.min(tension, METER_MAX).toFixed(1));
    this.track.setAttribute('aria-valuetext', text);
  }
}
