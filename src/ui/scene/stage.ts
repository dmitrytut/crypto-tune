import type { TradeSide } from '../../feed/market-feed';
import type { GraphicsMode } from '../../settings';
import { el } from '../dom';
import { CALM_AURA } from '../palette';
import { Aura } from './aura';
import { Chart } from './chart';
import { Fx } from './fx';
import { PointerStroke } from './interaction';
import { mountParticleInput } from './particle-input';
import { QualityController } from './quality';

const SHAKE_MS = 420;
const LITE_AURA_INTERVAL_SEC = 1 / 15;

export interface StageOptions {
  /** Element liquidations burst from (its centre), tracked through resizes. */
  origin: HTMLElement;
  reducedMotion: MediaQueryList;
  graphics(): GraphicsMode;
  /** Trades at or above this notional get the big-trade treatment; read every frame. */
  bigTradeUsd(): number;
  /** Runs at the end of every animation frame, e.g. to redraw the chart. */
  onFrame(): void;
  /** A manual particle hit, independent of market cues. */
  onParticleTouch(side: TradeSide, strength: number): void;
}

/** The visual layers: WebGL aura (null without hardware WebGL), event overlay and history chart. */
export interface Stage {
  aura: Aura | null;
  fx: Fx;
  chart: Chart;
  /** Erases both queued input and the old scene before a new pipeline begins. */
  clear(): void;
}

/**
 * Creates the scene layers from index.html, wires the overlay's hooks into the
 * aura and a screen shake, and drives everything from one animation loop.
 */
export function mountStage(o: StageOptions): Stage {
  const { reducedMotion } = o;
  const quality = new QualityController(o.graphics());
  let prevFrame: number | null = null;
  let auraElapsed = 0;
  const resetTiming = () => {
    quality.reset();
    prevFrame = null;
    auraElapsed = 0;
  };
  const aura = Aura.create(el('aura'), CALM_AURA);
  const stage = el('stage');
  const canvas = el<HTMLCanvasElement>('fx');
  const stroke = new PointerStroke();
  const cancelInput = mountParticleInput(canvas, stroke, reducedMotion);
  const fx = new Fx(canvas, {
    bloom: (x, y, color, strength) => aura?.bloom(x, y, color, strength),
    shock: (x, y, strength) => aura?.shock(x, y, strength),
    touch: o.onParticleTouch,
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
  const clear = () => {
    cancelInput();
    fx.clear();
  };
  const chartCanvas = el<HTMLCanvasElement>('chart');
  const chart = new Chart(chartCanvas, reducedMotion);

  const placeOrigin = () => {
    const r = o.origin.getBoundingClientRect();
    fx.setOrigin(r.left + r.width / 2, r.top + r.height / 2);
  };
  new ResizeObserver(placeOrigin).observe(o.origin);
  window.addEventListener('resize', placeOrigin);
  // Drops land on the price line; beside it, or while history is loading, they fall to the
  // screen bottom.
  let chartBox = chartCanvas.getBoundingClientRect();
  const placeChart = () => {
    chartBox = chartCanvas.getBoundingClientRect();
  };
  new ResizeObserver(placeChart).observe(chartCanvas);
  window.addEventListener('resize', placeChart);
  fx.setFloor((x) => {
    const y = chartBox.height > 0 ? chart.lineY(x - chartBox.left) : null;
    return y === null ? null : chartBox.top + y;
  });
  document.addEventListener('visibilitychange', () => {
    // Never sample hidden throttling or replay old particles after returning.
    clear();
    resetTiming();
  });

  window.addEventListener('resize', resetTiming);
  window.visualViewport?.addEventListener('resize', resetTiming);
  reducedMotion.addEventListener('change', resetTiming);
  const frame = (t: number) => {
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    const start = performance.now();
    const frameMs = prevFrame === null ? 0 : t - prevFrame;
    const dt = frameMs / 1000;
    prevFrame = t;
    quality.setMode(o.graphics());
    fx.setQuality(quality.level);
    auraElapsed += dt;
    if (quality.level === 'full' || auraElapsed >= LITE_AURA_INTERVAL_SEC) {
      // Reduced motion retains the barely drifting background, regardless of graphics mode.
      aura?.frame(reducedMotion.matches ? auraElapsed * 0.1 : auraElapsed, quality.level);
      auraElapsed = 0;
    }
    // Reduced motion: no new events are queued; clearing also wipes anything already
    // flying when the preference flips mid-session, so nothing freezes on screen.
    if (reducedMotion.matches) clear();
    else fx.interact(stroke);
    fx.frame(dt, o.bigTradeUsd());
    o.onFrame();
    quality.sample(frameMs, performance.now() - start);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    aura,
    fx,
    chart,
    clear() {
      clear();
      resetTiming();
    },
  };
}
