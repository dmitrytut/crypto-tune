/** A run of equal heights longer than this stays flat between two knots; shorter ones blend, px. */
const MAX_BLEND_RUN_PX = 8;
/** Spacing of the samples along the smooth line, px. */
const SAMPLE_PX = 2;

/**
 * A line sampled into points, `xs` ascending, CSS px.
 * @package
 */
export interface SampledLine {
  xs: number[];
  ys: number[];
}

/**
 * A smooth line through a stepped one (`xs` ascending, px): every short run of equal heights
 * becomes one knot at its middle, so a staircase turns into a slope, while a run longer than
 * MAX_BLEND_RUN_PX keeps a knot at each end and stays flat. The knots are joined by a monotone
 * cubic (Fritsch–Carlson), which never overshoots them: the drawn extremes are real prices.
 * Sampled every SAMPLE_PX and at every knot.
 * @package
 */
export function smoothLine(xs: readonly number[], ys: readonly number[]): SampledLine {
  const kx: number[] = [];
  const ky: number[] = [];
  const n = xs.length;
  for (let i = 0; i < n; ) {
    const y = ys[i] as number;
    let j = i;
    while (j + 1 < n && ys[j + 1] === y) j++;
    const a = xs[i] as number;
    const b = xs[j] as number;
    if (b - a > MAX_BLEND_RUN_PX) kx.push(a, b);
    // The line keeps its ends where they are.
    else if (i === 0) kx.push(a);
    else if (j === n - 1) kx.push(b);
    else kx.push((a + b) / 2);
    while (ky.length < kx.length) ky.push(y);
    i = j + 1;
  }
  const m = monotoneTangents(kx, ky);
  const outX: number[] = [];
  const outY: number[] = [];
  for (let k = 0; k + 1 < kx.length; k++) {
    const x0 = kx[k] as number;
    const y0 = ky[k] as number;
    const y1 = ky[k + 1] as number;
    const h = (kx[k + 1] as number) - x0;
    const m0 = (m[k] as number) * h;
    const m1 = (m[k + 1] as number) * h;
    const steps = Math.max(1, Math.ceil(h / SAMPLE_PX));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      outX.push(x0 + t * h);
      outY.push(
        (2 * t3 - 3 * t2 + 1) * y0 +
          (t3 - 2 * t2 + t) * m0 +
          (-2 * t3 + 3 * t2) * y1 +
          (t3 - t2) * m1,
      );
    }
  }
  if (kx.length > 0) {
    outX.push(kx.at(-1) as number);
    outY.push(ky.at(-1) as number);
  }
  return { xs: outX, ys: outY };
}

/** Fritsch–Carlson tangents: a cubic Hermite through the knots with them stays monotone. */
function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let k = 0; k + 1 < n; k++) {
    d.push(
      ((ys[k + 1] as number) - (ys[k] as number)) / ((xs[k + 1] as number) - (xs[k] as number)),
    );
  }
  const m: number[] = new Array(n).fill(0);
  if (n < 2) return m;
  m[0] = d[0] as number;
  m[n - 1] = d[n - 2] as number;
  for (let k = 1; k < n - 1; k++) {
    const a = d[k - 1] as number;
    const b = d[k] as number;
    m[k] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  for (let k = 0; k < n - 1; k++) {
    const dk = d[k] as number;
    if (dk === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = (m[k] as number) / dk;
    const b = (m[k + 1] as number) / dk;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * dk;
      m[k + 1] = t * b * dk;
    }
  }
  return m;
}

/**
 * Height of a polyline at every whole pixel column 0…width−1, interpolated between its points
 * (`xs` ascending); NaN where the line does not reach. Writes into `out` when it has the right
 * length, so a chart redrawn every tick allocates nothing.
 * @package
 */
export function lineColumns(
  xs: readonly number[],
  ys: readonly number[],
  width: number,
  out?: Float32Array,
): Float32Array {
  const cols = out?.length === width ? out : new Float32Array(width);
  cols.fill(Number.NaN);
  for (let i = 1; i < xs.length; i++) {
    const xa = xs[i - 1] as number;
    const xb = xs[i] as number;
    const ya = ys[i - 1] as number;
    const yb = ys[i] as number;
    const from = Math.max(0, Math.ceil(xa));
    const to = Math.min(width - 1, Math.floor(xb));
    for (let c = from; c <= to; c++)
      cols[c] = xb === xa ? yb : ya + ((c - xa) / (xb - xa)) * (yb - ya);
  }
  return cols;
}
