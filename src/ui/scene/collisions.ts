/** A circular particle in CSS px and px/s; mass is proportional to its area. @package */
export interface CollisionBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** Keep most impact speed so a contact reads as a rebound, not an inelastic clump. */
const RESTITUTION = 0.75;
/** A gentle contact still opens an 8 px gap in 250 ms instead of resting rim-to-rim, px/s. */
const MIN_SEPARATION_SPEED = 32;

const byLeftEdge = (a: CollisionBody, b: CollisionBody) => a.x - a.r - (b.x - b.r);

/**
 * Resolves contacts in one particle group; the caller supplies a scratch list, which is sorted.
 * Nearby circles exchange normal impulse; tangential motion and separating velocities stay intact.
 * @package
 */
export class CollisionSolver {
  private readonly leftEdges: number[] = [];

  resolve(bodies: CollisionBody[]): void {
    bodies.sort(byLeftEdge);
    // Freeze the sweep before separating circles: corrections can reorder their left edges.
    this.leftEdges.length = bodies.length;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (body) this.leftEdges[i] = body.x - body.r;
    }
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const left = this.leftEdges[i];
      if (!a || left === undefined) continue;
      const right = left + 2 * a.r;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const nextLeft = this.leftEdges[j];
        if (!b || nextLeft === undefined) continue;
        if (nextLeft > right) break;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const radius = a.r + b.r;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > radius * radius) continue;
        const distance = Math.sqrt(distanceSq);
        // Coincident centres have no geometric normal; a fixed horizontal one is deterministic.
        const nx = distance > 0 ? dx / distance : 1;
        const ny = distance > 0 ? dy / distance : 0;
        const areaA = a.r * a.r;
        const areaB = b.r * b.r;
        const shareA = areaB / (areaA + areaB);
        const shareB = 1 - shareA;
        const overlap = radius - distance;
        a.x -= nx * overlap * shareA;
        a.y -= ny * overlap * shareA;
        b.x += nx * overlap * shareB;
        b.y += ny * overlap * shareB;
        const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (approach > 0 || (approach === 0 && overlap === 0)) continue;
        const separatingSpeed = Math.max(MIN_SEPARATION_SPEED, -RESTITUTION * approach);
        const impulse = separatingSpeed - approach;
        a.vx -= nx * impulse * shareA;
        a.vy -= ny * impulse * shareA;
        b.vx += nx * impulse * shareB;
        b.vy += ny * impulse * shareB;
      }
    }
  }
}
