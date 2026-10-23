import { el } from '../dom';
import { CALM_AURA, luminance, poolStrength } from '../palette';
import { Aura } from './aura';
import { Chart } from './chart';
import { Fx } from './fx';

const SHAKE_MS = 420;
/**
 * How often the aura under the readout text is read back. A large trade's bloom lands at once,
 * so the pool has to follow within a few frames; each readback is a few small rows at a third
 * of screen resolution.
 */
const BACKDROP_EVERY_MS = 100;
/** The readout's dark pool darkens fast when the aura brightens under the text, lifts slowly. */
const POOL_RISE_SEC = 0.08;
const POOL_FALL_SEC = 2;

export interface StageOptions {
  /** Element liquidations burst from (its centre), tracked through resizes. */
  origin: HTMLElement;
  /** Gets `--pool`, the opacity of the dark pool behind the readout. */
  readout: HTMLElement;
  /**
   * Text rows the pool keeps legible; each visible one is weighed against the aura under it in
   * its own current colour, and the most demanding sets `--pool`. Rows faded out by immersive
   * mode do not count.
   */
  legible: readonly HTMLElement[];
  reducedMotion: MediaQueryList;
  /** Trades at or above this notional get the big-trade treatment; read every frame. */
  bigTradeUsd(): number;
  /** Runs at the end of every animation frame, e.g. to redraw the chart. */
  onFrame(): void;
}

/** The visual layers: WebGL aura (null without WebGL), event overlay and history chart. */
export interface Stage {
  aura: Aura | null;
  fx: Fx;
  chart: Chart;
}

/**
 * Creates the scene layers from index.html, wires the overlay's hooks into the
 * aura and a screen shake, and drives everything from one animation loop.
 */
export function mountStage(o: StageOptions): Stage {
  const { reducedMotion } = o;
  // Resolves any CSS colour (color-mix, translucent) to the pixel it paints.
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!swatch) throw new Error('2D canvas unavailable');
  /** Luminance of an element's text colour drawn over black: translucent text at its alpha. */
  const textLuminance = (e: HTMLElement) => {
    swatch.clearRect(0, 0, 1, 1);
    swatch.fillStyle = getComputedStyle(e).color;
    swatch.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = swatch.getImageData(0, 0, 1, 1).data;
    const k = a / 255 / 255;
    return luminance([r * k, g * k, b * k]);
  };
  const aura = Aura.create(el('aura'), CALM_AURA);
  const stage = el('stage');
  const fx = new Fx(el('fx'), {
    bloom: (x, y, color, strength) => aura?.bloom(x, y, color, strength),
    shock: (x, y, strength) => aura?.shock(x, y, strength),
    shake: (strength) => {
      const a = 3 + 5 * strength;
      stage.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${a}px, ${-a * 0.6}px)` },
          { transform: `translate(${-a * 0.8}px, ${a * 0.5}px)` },
          { transform: `translate(${a * 0.4}px, ${a * 0.3}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: SHAKE_MS, easing: 'ease-out' },
      );
    },
  });
  const chart = new Chart(el('chart'));

  const placeOrigin = () => {
    const r = o.origin.getBoundingClientRect();
    fx.setOrigin(r.left + r.width / 2, r.top + r.height / 2);
  };
  new ResizeObserver(placeOrigin).observe(o.origin);
  window.addEventListener('resize', placeOrigin);
  document.addEventListener('visibilitychange', () => {
    // Events received while hidden were not queued; nothing stale to burst on return.
    if (!document.hidden) fx.clear();
  });

  let prevFrame = performance.now();
  let backdropAt = -Infinity;
  let poolTarget = 1;
  let pool = -1;
  let written = -1;
  const frame = (t: number) => {
    const dt = (t - prevFrame) / 1000;
    prevFrame = t;
    // Reduced motion: the aura barely drifts and no particles fly.
    aura?.frame(reducedMotion.matches ? dt * 0.1 : dt);
    if (aura) {
      if (t - backdropAt >= BACKDROP_EVERY_MS) {
        backdropAt = t;
        poolTarget = 0;
        for (const row of o.legible) {
          // Empty (no last event yet) or faded out by immersive mode: nothing to read.
          if (!row.textContent?.trim() || !row.checkVisibility({ opacityProperty: true })) continue;
          const backdrop = aura.backdropUnder(row.getBoundingClientRect());
          poolTarget = Math.max(poolTarget, poolStrength(backdrop, textLuminance(row)));
        }
      }
      const tau = poolTarget > pool ? POOL_RISE_SEC : POOL_FALL_SEC;
      pool = pool < 0 ? poolTarget : pool + (poolTarget - pool) * (1 - Math.exp(-dt / tau));
      // Smoothed every frame; the style is written only when it visibly changes.
      if (Math.abs(pool - written) > 0.005) {
        written = pool;
        o.readout.style.setProperty('--pool', pool.toFixed(3));
      }
    }
    // Reduced motion: no new events are queued; clearing also wipes anything already
    // flying when the preference flips mid-session, so nothing freezes on screen.
    if (reducedMotion.matches) fx.clear();
    fx.frame(dt, o.bigTradeUsd());
    o.onFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return { aura, fx, chart };
}
