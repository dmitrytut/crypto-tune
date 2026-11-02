import { describe, expect, it } from 'vitest';
import type { GraphicsMode } from '../../../settings';
import { cappedQualityParams, QualityController, type QualityParams } from '../quality';

const params: QualityParams = {
  warmupMs: 100,
  windowMs: 100,
  workBudgetMs: 12,
  slowFrameMs: 40,
  headroomWorkMs: 4,
  headroomFrameMs: 36,
  overloadRatio: 0.2,
  headroomRatio: 0.95,
  degradeWindows: 2,
  recoverWindows: 3,
};

function advance(c: QualityController, frames: number, workMs: number, frameMs = 10): void {
  for (let i = 0; i < frames; i++) c.sample(frameMs, workMs);
}

function ready(mode: GraphicsMode = 'auto'): QualityController {
  const c = new QualityController(mode, params);
  c.sample(params.warmupMs, 0);
  return c;
}

describe('QualityController', () => {
  it('requires consecutive overloaded windows rather than one expensive frame', () => {
    const c = ready();
    c.sample(5000, 100);
    expect(c.level).toBe('full');
    advance(c, 10, 1);
    advance(c, 10, 20);
    expect(c.level).toBe('full');
    advance(c, 10, 20);
    expect(c.level).toBe('lite');
  });

  it('recognizes sustained slow cadence even when JS submission is cheap', () => {
    const c = ready();
    advance(c, 4, 1, 50);
    expect(c.level).toBe('lite');
  });

  it.each([1000 / 30, 1000 / 60, 1000 / 120])(
    'does not classify healthy %f ms cadence as overload',
    (frameMs) => {
      const c = ready();
      advance(c, 300, 2, frameMs);
      expect(c.level).toBe('full');
    },
  );

  it('judges a frame-capped scene by the time beyond the cap', () => {
    const capMs = 1000 / 10 - 1;
    const capped = new QualityController('auto', cappedQualityParams(capMs, params));
    capped.sample(params.warmupMs, 0);
    advance(capped, 30, 2, 100);
    expect(capped.level).toBe('full');
    advance(capped, 4, 2, capMs + 50);
    expect(capped.level).toBe('lite');
  });

  it('uses the share of bad frames rather than the worst sample', () => {
    const c = ready();
    for (let window = 0; window < 3; window++) {
      advance(c, 1, 20);
      advance(c, 9, 1);
    }
    expect(c.level).toBe('full');
    for (let window = 0; window < 2; window++) {
      advance(c, 2, 20);
      advance(c, 8, 1);
    }
    expect(c.level).toBe('lite');
  });

  it('waits through warm-up before using startup cost as a signal', () => {
    const c = new QualityController('auto', params);
    advance(c, 10, 100);
    advance(c, 10, 20);
    expect(c.level).toBe('full');
    advance(c, 10, 20);
    expect(c.level).toBe('lite');
  });

  it('restores quality only after uninterrupted headroom, not merely absence of overload', () => {
    const c = ready();
    advance(c, 20, 20);
    expect(c.level).toBe('lite');
    c.sample(params.warmupMs, 0);
    advance(c, 20, 1);
    expect(c.level).toBe('lite');
    advance(c, 10, 6);
    advance(c, 20, 1);
    expect(c.level).toBe('lite');
    advance(c, 10, 1);
    expect(c.level).toBe('full');
  });

  it('doubles the headroom it needs after each relapse, until the mode is picked again', () => {
    const c = ready();
    const relapse = () => {
      advance(c, 20, 20);
      expect(c.level).toBe('lite');
      c.sample(params.warmupMs, 0);
    };
    relapse();
    advance(c, 30, 1);
    expect(c.level).toBe('full');
    c.sample(params.warmupMs, 0);
    relapse();
    advance(c, 50, 1);
    expect(c.level).toBe('lite');
    advance(c, 10, 1);
    expect(c.level).toBe('full');
    c.setMode('full');
    c.setMode('auto');
    c.sample(params.warmupMs, 0);
    relapse();
    advance(c, 30, 1);
    expect(c.level).toBe('full');
  });

  it('resets an overload streak and warm-up after an interruption while keeping its level', () => {
    const c = ready();
    advance(c, 10, 20);
    c.reset();
    c.sample(5000, 100);
    advance(c, 10, 20);
    expect(c.level).toBe('full');
    advance(c, 10, 20);
    expect(c.level).toBe('lite');
    c.reset();
    expect(c.level).toBe('lite');
  });

  it('never overrides explicit Full or Lite and starts fresh on return to Auto', () => {
    const c = ready('full');
    advance(c, 100, 30);
    expect(c.level).toBe('full');
    c.setMode('lite');
    advance(c, 100, 1);
    expect(c.level).toBe('lite');
    c.setMode('auto');
    expect(c.level).toBe('lite');
    c.sample(params.warmupMs, 0);
    advance(c, 20, 1);
    expect(c.level).toBe('lite');
    advance(c, 10, 1);
    expect(c.level).toBe('full');
  });
});
