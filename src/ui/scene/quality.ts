import type { GraphicsMode } from '../../settings';

/** @package */
export type QualityLevel = Exclude<GraphicsMode, 'auto'>;

/** Visible-frame sampling and hysteresis; times in ms. @package */
export interface QualityParams {
  warmupMs: number;
  windowMs: number;
  workBudgetMs: number;
  slowFrameMs: number;
  headroomWorkMs: number;
  headroomFrameMs: number;
  overloadRatio: number;
  headroomRatio: number;
  degradeWindows: number;
  recoverWindows: number;
}

const DEFAULT_QUALITY_PARAMS: QualityParams = {
  warmupMs: 1000,
  windowMs: 1000,
  workBudgetMs: 12,
  slowFrameMs: 40,
  headroomWorkMs: 4,
  headroomFrameMs: 36,
  overloadRatio: 0.2,
  headroomRatio: 0.95,
  degradeWindows: 2,
  recoverWindows: 20,
};

/**
 * Thresholds for a scene capped to frames of at least `minFrameMs`: frame times count only
 * beyond the cap, so a 10 fps stream is not taken for overload. @package
 */
export function cappedQualityParams(
  minFrameMs: number,
  base: QualityParams = DEFAULT_QUALITY_PARAMS,
): QualityParams {
  return {
    ...base,
    slowFrameMs: base.slowFrameMs + minFrameMs,
    headroomFrameMs: base.headroomFrameMs + minFrameMs,
  };
}

/** Actual page load, not a device classification; no DOM, timers or per-frame allocations. @package */
export class QualityController {
  private current: QualityLevel;
  private warmupMs = 0;
  private elapsedMs = 0;
  private frames = 0;
  private overloaded = 0;
  private headroom = 0;
  private badWindows = 0;
  private goodWindows = 0;
  /**
   * Headroom windows a return to Full needs. Doubles when Full fails sooner than that after a
   * return (a host that only copes in Lite stops flipping); a longer stretch in Full restores it.
   */
  private recoverWindows: number;
  /** Windows sampled in Full since the last return; Infinity before any return. */
  private fullWindows = Infinity;

  constructor(
    private mode: GraphicsMode,
    private readonly params: QualityParams = DEFAULT_QUALITY_PARAMS,
  ) {
    this.current = mode === 'lite' ? 'lite' : 'full';
    this.recoverWindows = params.recoverWindows;
    this.reset();
  }

  get level(): QualityLevel {
    return this.current;
  }

  setMode(mode: GraphicsMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'auto') this.current = mode;
    this.recoverWindows = this.params.recoverWindows;
    this.fullWindows = Infinity;
    this.reset();
  }

  /** Discard interruption/startup samples without undoing an override or a previous downgrade. */
  reset(): void {
    this.warmupMs = this.params.warmupMs;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.clearWindow();
  }

  sample(frameMs: number, workMs: number): void {
    if (this.mode !== 'auto') return;
    if (this.warmupMs > 0) {
      this.warmupMs -= frameMs;
      return;
    }
    const p = this.params;
    this.elapsedMs += frameMs;
    this.frames++;
    if (workMs > p.workBudgetMs || frameMs > p.slowFrameMs) this.overloaded++;
    if (workMs <= p.headroomWorkMs && frameMs <= p.headroomFrameMs) this.headroom++;
    if (this.elapsedMs < p.windowMs) return;
    this.badWindows = this.overloaded / this.frames >= p.overloadRatio ? this.badWindows + 1 : 0;
    this.goodWindows = this.headroom / this.frames >= p.headroomRatio ? this.goodWindows + 1 : 0;
    if (this.current === 'full') this.fullWindows++;
    const change =
      this.current === 'full'
        ? this.badWindows >= p.degradeWindows
        : this.goodWindows >= this.recoverWindows;
    if (!change) {
      this.clearWindow();
      return;
    }
    if (this.current === 'full') {
      const relapse = this.fullWindows < this.recoverWindows;
      this.recoverWindows = relapse ? this.recoverWindows * 2 : p.recoverWindows;
      this.current = 'lite';
    } else {
      this.fullWindows = 0;
      this.current = 'full';
    }
    this.reset();
  }

  private clearWindow(): void {
    this.elapsedMs = 0;
    this.frames = 0;
    this.overloaded = 0;
    this.headroom = 0;
  }
}
