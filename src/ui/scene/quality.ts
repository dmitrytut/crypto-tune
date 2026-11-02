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
  /** Doubles on every recovery: a host that relapses in Full stops flipping every ~20 s. */
  private recoverWindows: number;

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
    const change =
      this.current === 'full'
        ? this.badWindows >= p.degradeWindows
        : this.goodWindows >= this.recoverWindows;
    if (change) {
      if (this.current === 'lite') this.recoverWindows *= 2;
      this.current = this.current === 'full' ? 'lite' : 'full';
      this.reset();
    } else this.clearWindow();
  }

  private clearWindow(): void {
    this.elapsedMs = 0;
    this.frames = 0;
    this.overloaded = 0;
    this.headroom = 0;
  }
}
