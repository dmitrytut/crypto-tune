import type { TradeSide } from '../../feed/market-feed';
import type { GraphicsMode } from '../../settings';
import { el } from '../dom';
import { CALM_AURA } from '../palette';
import { Aura } from './aura';
import { Chart } from './chart';
import { Fx } from './fx';
import { GestureFeedback } from './gesture-feedback';
import { PointerStroke } from './interaction';
import { mountParticleInput } from './particle-input';
import { cappedQualityParams, QualityController } from './quality';

const SHAKE_MS = 420;
const LITE_AURA_INTERVAL_SEC = 1 / 15;

/**
 * `auto`: the aura on hardware WebGL only; `on`: on software WebGL too (a GPU-less server that
 * streams the picture, where the CPU is there for it); `off`: never.
 */
export type AuraMode = 'auto' | 'on' | 'off';

export interface StageOptions {
  /** Element liquidations burst from (its centre), tracked through resizes and scrolling. */
  origin: HTMLElement;
  reducedMotion: MediaQueryList;
  graphics(): GraphicsMode;
  /** Trades at or above this notional get the big-trade treatment; read every frame. */
  bigTradeUsd(): number;
  /** Runs at the end of every animation frame, e.g. to redraw the chart. */
  onFrame(): void;
  /** A manual particle hit, independent of market cues. */
  onParticleTouch(side: TradeSide, strength: number): void;
  aura: AuraMode;
  /** Frame-rate cap; null: every display frame. */
  maxFps: number | null;
  /** Text size multiplier for trade and liquidation labels. */
  labelScale: number;
}

/** The visual layers: WebGL aura (null without hardware WebGL), event overlay and history chart. */
export interface Stage {
  aura: Aura | null;
  fx: Fx;
  chart: Chart;
  /** Erases both queued input and the old scene before a new pipeline begins. */
  clear(): void;
  /** Stops or restarts the animation loop; the scene restarts empty. */
  setPaused(paused: boolean): void;
}

/**
 * Creates the scene layers from index.html, wires the overlay's hooks into the
 * aura and a screen shake, and drives everything from one animation loop.
 */
export function mountStage(o: StageOptions): Stage {
  const { reducedMotion } = o;
  // The 1 ms slack keeps a 60 Hz display at 30 fps under a 30 cap instead of rounding to 20.
  const minFrameMs = o.maxFps ? 1000 / o.maxFps - 1 : 0;
  // The cap's interval is not overload: Auto judges frames by their time beyond it.
  const quality = new QualityController(o.graphics(), cappedQualityParams(minFrameMs));
  let prevFrame: number | null = null;
  let auraElapsed = 0;
  const resetTiming = () => {
    quality.reset();
    prevFrame = null;
    auraElapsed = 0;
  };
  const aura = o.aura === 'off' ? null : Aura.create(el('aura'), CALM_AURA, o.aura === 'on');
  const stage = el('stage');
  const canvas = el<HTMLCanvasElement>('fx');
  const stroke = new PointerStroke();
  const feedback = new GestureFeedback(canvas, reducedMotion);
  const cancelInput = mountParticleInput(canvas, stroke, reducedMotion, feedback);
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
  fx.labelScale = o.labelScale;
  const clear = () => {
    cancelInput();
    fx.clear();
  };
  const chartCanvas = el<HTMLCanvasElement>('chart');
  const chart = new Chart(chartCanvas, reducedMotion);

  // The overlay is fixed; both anchors move when a short or zoomed page scrolls.
  let chartBox = chartCanvas.getBoundingClientRect();
  const place = () => {
    const r = o.origin.getBoundingClientRect();
    fx.setOrigin(r.left + r.width / 2, r.top + r.height / 2);
    chartBox = chartCanvas.getBoundingClientRect();
  };
  const placement = new ResizeObserver(place);
  placement.observe(o.origin);
  placement.observe(chartCanvas);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  // Beside the price line, or while history loads, drops fall to the screen bottom.
  fx.setFloor((x) => {
    const y = chartBox.height > 0 ? chart.lineY(x - chartBox.left) : null;
    return y === null ? null : chartBox.top + y;
  });
  document.addEventListener('visibilitychange', () => {
    // Never sample hidden throttling or replay old particles after returning.
    clear();
    resetTiming();
  });

  // Layout and motion changes skew a sample, not the clock: resetting time would stall a resize.
  const resetSampling = () => quality.reset();
  window.addEventListener('resize', resetSampling);
  window.visualViewport?.addEventListener('resize', resetSampling);
  reducedMotion.addEventListener('change', resetSampling);
  let raf = 0;
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    if (prevFrame !== null && t - prevFrame < minFrameMs) return;
    const start = performance.now();
    const frameMs = prevFrame === null ? 0 : t - prevFrame;
    const dt = frameMs / 1000;
    prevFrame = t;
    quality.setMode(o.graphics());
    fx.setQuality(quality.level);
    auraElapsed += dt;
    // The 1 ms slack keeps frame-time rounding from stretching Lite's 15 Hz to every 5th frame.
    if (quality.level === 'full' || auraElapsed >= LITE_AURA_INTERVAL_SEC - 0.001) {
      // Reduced motion: the aura barely drifts, regardless of graphics mode.
      aura?.frame(reducedMotion.matches ? auraElapsed * 0.1 : auraElapsed, quality.level);
      auraElapsed = 0;
    }
    // Keep the non-moving press acknowledgment in reduced motion, but no market particles.
    if (reducedMotion.matches) {
      stroke.cancel();
      fx.clear();
    } else fx.interact(stroke);
    fx.frame(dt, o.bigTradeUsd());
    feedback.draw(t);
    o.onFrame();
    quality.sample(frameMs, performance.now() - start);
  };
  let paused = false;
  raf = requestAnimationFrame(frame);
  const setPaused = (next: boolean) => {
    if (next === paused) return;
    paused = next;
    if (paused) {
      cancelAnimationFrame(raf);
      return;
    }
    // The time away is not one long frame or a quality sample, and its particles are stale.
    clear();
    resetTiming();
    raf = requestAnimationFrame(frame);
  };

  return {
    aura,
    fx,
    chart,
    clear() {
      clear();
      resetTiming();
    },
    setPaused,
  };
}
