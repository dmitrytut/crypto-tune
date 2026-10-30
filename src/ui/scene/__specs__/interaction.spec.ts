import { describe, expect, it } from 'vitest';
import { PointerStroke } from '../interaction';

describe('PointerStroke', () => {
  it('hits a padded tap and exposes distance for selecting the nearest object', () => {
    const stroke = new PointerStroke();
    stroke.begin(20, 30, 12);
    expect(stroke.isTap(0)).toBe(true);
    expect(stroke.hits(35, 30, 3)).toBe(true);
    expect(stroke.hits(35.1, 30, 3)).toBe(false);
    expect(stroke.distanceSq(23, 34)).toBe(25);
    expect(stroke.distanceSq(20, 31)).toBeLessThan(stroke.distanceSq(23, 34));
  });

  it('catches small objects crossed between distant samples, including tangent endpoints', () => {
    const stroke = new PointerStroke();
    stroke.begin(0, 0, 0);
    stroke.move(100, 0);
    expect(stroke.isTap(0)).toBe(false);
    expect(stroke.hits(50, 0, 1)).toBe(true);
    expect(stroke.hits(100, 3, 3)).toBe(true);
    expect(stroke.hits(-3, 0, 3)).toBe(true);
    expect(stroke.hits(50, 3.1, 3)).toBe(false);
  });

  it('keeps corners instead of cutting a diagonal through objects off the actual path', () => {
    const stroke = new PointerStroke();
    stroke.begin(0, 0, 0);
    stroke.move(0, 100);
    stroke.move(100, 100);
    expect(stroke.hits(0, 50, 1)).toBe(true);
    expect(stroke.hits(50, 100, 1)).toBe(true);
    expect(stroke.hits(50, 50, 1)).toBe(false);
  });

  it('retains a quick released tap until consumed and does not replay it next frame', () => {
    const stroke = new PointerStroke();
    stroke.begin(20, 30, 0);
    stroke.finish();
    expect(stroke.hits(20, 30, 1)).toBe(true);
    stroke.drain();
    expect(stroke.hits(20, 30, 1)).toBe(false);
    stroke.move(60, 30);
    expect(stroke.length).toBe(0);
  });

  it('continues an active gesture from its last endpoint after a frame, not from its start', () => {
    const stroke = new PointerStroke();
    stroke.begin(0, 0, 0);
    stroke.move(0, 100);
    stroke.drain();
    stroke.move(100, 100);
    expect(stroke.hits(50, 100, 1)).toBe(true);
    expect(stroke.hits(0, 50, 1)).toBe(false);
    expect(stroke.hits(50, 50, 1)).toBe(false);
  });

  it('cancels pending hits and starts a later gesture without joining the two', () => {
    const stroke = new PointerStroke();
    stroke.begin(0, 0, 0);
    stroke.move(100, 0);
    stroke.cancel();
    expect(stroke.hits(50, 0, 1)).toBe(false);
    stroke.move(100, 100);
    expect(stroke.length).toBe(0);
    stroke.begin(200, 200, 0);
    expect(stroke.hits(100, 100, 1)).toBe(false);
    expect(stroke.hits(200, 200, 1)).toBe(true);
  });

  it('bounds an event flood without inventing a path through skipped samples', () => {
    const stroke = new PointerStroke();
    stroke.begin(0, 0, 0);
    for (let i = 1; i <= 1000; i++) stroke.move(0, i);
    stroke.move(1000, 1000);
    expect(stroke.length).toBeLessThanOrEqual(64);
    expect(stroke.hits(500, 500, 1)).toBe(false);
    stroke.drain();
    stroke.move(1000, 1100);
    expect(stroke.hits(1000, 1050, 1)).toBe(true);
    expect(stroke.hits(500, 500, 1)).toBe(false);
  });

  it('does not turn a held tap with small finger jitter into repeated hits', () => {
    const stroke = new PointerStroke();
    stroke.begin(20, 30, 12);
    stroke.drain();
    stroke.move(22, 31);
    expect(stroke.length).toBe(0);
    stroke.move(30, 30);
    expect(stroke.hits(27, 30, 1)).toBe(true);
  });

  it('preserves two released taps before a frame without joining their positions', () => {
    const stroke = new PointerStroke();
    stroke.begin(0, 0, 12);
    stroke.finish();
    stroke.begin(100, 100, 3);
    stroke.finish();
    expect(stroke.length).toBe(2);
    expect(stroke.hits(0, 0, 1)).toBe(true);
    expect(stroke.hits(100, 100, 1)).toBe(true);
    expect(stroke.hits(50, 50, 1)).toBe(false);
    expect(stroke.hits(10, 0, 1)).toBe(true);
    expect(stroke.hits(110, 100, 1)).toBe(false);
  });

  it('does not spend queue capacity on stationary events or start a stroke from hover', () => {
    const stroke = new PointerStroke();
    stroke.move(10, 10);
    expect(stroke.length).toBe(0);
    stroke.begin(10, 10, 0);
    for (let i = 0; i < 1000; i++) stroke.move(10, 10);
    expect(stroke.length).toBe(1);
    expect(stroke.isTap(0)).toBe(true);
  });
});
