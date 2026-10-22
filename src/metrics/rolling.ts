/**
 * Mean and population std over the last `capacity` samples, O(1) per push.
 * Uses windowed Welford updates; a full recompute every `capacity` pushes
 * bounds floating-point drift over long sessions.
 */
export class RollingStats {
  private readonly buf: Float64Array;
  private next = 0;
  private n = 0;
  private avg = 0;
  private m2 = 0;
  private sinceRecompute = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.buf = new Float64Array(capacity);
  }

  get count(): number {
    return this.n;
  }

  get mean(): number {
    return this.avg;
  }

  get variance(): number {
    return this.n > 0 ? this.m2 / this.n : 0;
  }

  get std(): number {
    return Math.sqrt(this.variance);
  }

  push(x: number): void {
    if (this.n < this.capacity) {
      this.n++;
      const delta = x - this.avg;
      this.avg += delta / this.n;
      this.m2 += delta * (x - this.avg);
    } else {
      const old = this.buf[this.next] as number;
      const oldAvg = this.avg;
      this.avg += (x - old) / this.n;
      this.m2 += (x - old) * (x - this.avg + old - oldAvg);
    }
    this.buf[this.next] = x;
    this.next = (this.next + 1) % this.capacity;
    if (++this.sinceRecompute >= this.capacity) this.recompute();
    else if (this.m2 < 0) this.m2 = 0;
  }

  clear(): void {
    this.next = this.n = this.avg = this.m2 = this.sinceRecompute = 0;
  }

  private recompute(): void {
    this.sinceRecompute = 0;
    // Buffer is full here (recompute fires only after `capacity` pushes).
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += this.buf[i] as number;
    const avg = sum / this.n;
    let m2 = 0;
    for (let i = 0; i < this.n; i++) {
      const d = (this.buf[i] as number) - avg;
      m2 += d * d;
    }
    this.avg = avg;
    this.m2 = m2;
  }
}
