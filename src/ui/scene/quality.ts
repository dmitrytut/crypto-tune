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

/** @package */
export const DEFAULT_QUALITY_PARAMS: QualityParams = {
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

  constructor(
    private mode: GraphicsMode,
    private readonly params: QualityParams = DEFAULT_QUALITY_PARAMS,
  ) {
    this.current = mode === 'lite' ? 'lite' : 'full';
    this.reset();
  }

  get level(): QualityLevel {
    return this.current;
  }

  setMode(mode: GraphicsMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'auto') this.current = mode;
    this.reset();
  }

  /** Discard interruption/startup samples without undoing an override or a previous downgrade. */
  reset(): void {
    this.warmupMs = this.params.warmupMs;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.clearWindow();
  }

  sample(frameMs: number, workMs: number): QualityLevel {
    if (this.mode !== 'auto') return this.current;
    if (this.warmupMs > 0) {
      this.warmupMs -= frameMs;
      return this.current;
    }
    const p = this.params;
    this.elapsedMs += frameMs;
    this.frames++;
    if (workMs > p.workBudgetMs || frameMs > p.slowFrameMs) this.overloaded++;
    if (workMs <= p.headroomWorkMs && frameMs <= p.headroomFrameMs) this.headroom++;
    if (this.elapsedMs < p.windowMs) return this.current;
    this.badWindows = this.overloaded / this.frames >= p.overloadRatio ? this.badWindows + 1 : 0;
    this.goodWindows = this.headroom / this.frames >= p.headroomRatio ? this.goodWindows + 1 : 0;
    const change =
      this.current === 'full'
        ? this.badWindows >= p.degradeWindows
        : this.goodWindows >= p.recoverWindows;
    if (change) {
      this.current = this.current === 'full' ? 'lite' : 'full';
      this.reset();
    } else this.clearWindow();
    return this.current;
  }

  private clearWindow(): void {
    this.elapsedMs = 0;
    this.frames = 0;
    this.overloaded = 0;
    this.headroom = 0;
  }
}
