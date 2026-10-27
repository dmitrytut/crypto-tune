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
