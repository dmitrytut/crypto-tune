import { describe, expect, it } from 'vitest';
import { type CollisionBody, CollisionSolver } from '../collisions';

const solver = new CollisionSolver();

const body = (x: number, y: number, r: number, vx = 0, vy = 0): CollisionBody => ({
  x,
  y,
  r,
  vx,
  vy,
});

const distance = (a: CollisionBody, b: CollisionBody) => Math.hypot(b.x - a.x, b.y - a.y);

const energy = (a: CollisionBody) => (a.r ** 2 * (a.vx ** 2 + a.vy ** 2)) / 2;

// These pin physical invariants, not the chosen restitution coefficient.
describe('CollisionSolver.resolve', () => {
  it('separates approaching drops and reverses their relative normal velocity with energy loss', () => {
    const left = body(0, 0, 10, 20);
    const right = body(18, 0, 10, -20);
    const before = energy(left) + energy(right);
    solver.resolve([right, left]);
    expect(distance(left, right)).toBeCloseTo(20);
    expect(left.vx).toBeLessThan(0);
    expect(right.vx).toBeGreaterThan(0);
    expect(left.vx + right.vx).toBeCloseTo(0);
    expect(energy(left) + energy(right)).toBeLessThan(before);
  });

  it('moves and accelerates a small drop more than a large drop while conserving momentum', () => {
    const small = body(0, 0, 5, 20);
    const large = body(14, 0, 10, -5);
    solver.resolve([small, large]);
    expect(distance(small, large)).toBeCloseTo(15);
    expect(-small.x / (large.x - 14)).toBeCloseTo(4);
    expect((20 - small.vx) / (large.vx + 5)).toBeCloseTo(4);
    expect(25 * small.vx + 100 * large.vx).toBeCloseTo(0);
  });

  it('changes only the normal component in a glancing contact', () => {
    const upper = body(0, 0, 10, 8, 9);
    const lower = body(0, 18, 10, -3, -4);
    solver.resolve([upper, lower]);
    expect(distance(upper, lower)).toBeCloseTo(20);
    expect(upper.vx).toBe(8);
    expect(lower.vx).toBe(-3);
    expect(lower.vy - upper.vy).toBeGreaterThan(0);
    expect(upper.vy + lower.vy).toBeCloseTo(5);
  });

  it('separates an existing overlap without bouncing drops already moving apart', () => {
    const left = body(0, 0, 10, -5);
    const right = body(18, 0, 10, 5);
    solver.resolve([left, right]);
    expect(distance(left, right)).toBeCloseTo(20);
    expect(left.vx).toBe(-5);
    expect(right.vx).toBe(5);
  });

  it('separates coincident centres deterministically without non-finite state', () => {
    const a = body(10, 10, 5);
    const b = body(10, 10, 5);
    solver.resolve([a, b]);
    expect(distance(a, b)).toBeCloseTo(10);
    expect((a.x + b.x) / 2).toBe(10);
    expect(a.y).toBe(10);
    expect(b.y).toBe(10);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.vx + b.vx).toBeCloseTo(0);
  });

  it('gives equally moving overlapping particles enough impulse to open a visible gap', () => {
    const left = body(0, 0, 10, 0, -30);
    const right = body(18, 0, 10, 0, -30);
    solver.resolve([left, right]);
    // A quarter-second after contact should show daylight, not just touching rims.
    left.x += left.vx * 0.25;
    right.x += right.vx * 0.25;
    expect(distance(left, right) - left.r - right.r).toBeGreaterThan(5);
    expect(left.vx + right.vx).toBeCloseTo(0);
    expect(left.vy).toBe(-30);
    expect(right.vy).toBe(-30);
  });

  it('does not repeatedly kick exactly touching particles travelling together', () => {
    const left = body(0, 0, 10, 0, -30);
    const right = body(20, 0, 10, 0, -30);
    solver.resolve([left, right]);
    expect(left.vx).toBe(0);
    expect(right.vx).toBe(0);
    expect(distance(left, right)).toBe(20);
  });

  it('does not collide separated circles whose horizontal bounds overlap', () => {
    const a = body(0, 0, 10, 3, 4);
    const b = body(12, 18, 10, -2, -1);
    const before = [{ ...a }, { ...b }];
    solver.resolve([a, b]);
    expect([a, b]).toEqual(before);
  });

  it('finds contacts beside an unrelated drop between their left edges', () => {
    const large = body(0, 0, 20, 5);
    const distant = body(-10, 100, 5);
    const small = body(22, 0, 5, -5);
    solver.resolve([small, distant, large]);
    expect(distance(large, small)).toBeCloseTo(25);
    expect(small.vx).toBeGreaterThan(0);
    expect(distant).toEqual(body(-10, 100, 5));
  });

  it('keeps finding existing contacts after an earlier correction changes sweep order', () => {
    const large = body(100, 100, 30);
    const upper = body(115, 150, 10);
    const pushed = body(120, 100, 5);
    const neighbor = body(122, 150, 5);
    solver.resolve([large, upper, pushed, neighbor]);
    expect(distance(large, pushed)).toBeCloseTo(35);
    expect(distance(upper, neighbor)).toBeCloseTo(15);
  });
});
