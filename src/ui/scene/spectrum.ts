import { SIZE_CLASSES, SPECTRUM_BUCKET_MS, type SpectrumBucket } from '../../metrics/history';

/**
 * The spectrogram under the chart as cells, `cols` × SIZE_CLASSES, index `col * SIZE_CLASSES +
 * class`: `level` is how busy a size class is in a column against that class's own busiest
 * column in view (0…1, square root so quiet cells still show), `buyShare` the share of its
 * volume bought (0.5 when there is none).
 * @package
 */
export interface SpectrumCells {
  cols: number;
  level: Float32Array;
  buyShare: Float32Array;
}

/**
 * Sums the buckets overlapping `from … from + span` into `cols` equal columns of time and levels
 * each size class on its own: big trades are rare, and against the small ones they would never
 * show.
 * @package
 */
export function spectrumCells(
  buckets: readonly SpectrumBucket[],
  from: number,
  span: number,
  cols: number,
): SpectrumCells {
  const n = cols * SIZE_CLASSES;
  const buy = new Float64Array(n);
  const sell = new Float64Array(n);
  for (const b of buckets) {
    if (b.ts + SPECTRUM_BUCKET_MS <= from) continue;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((b.ts - from) / span) * cols)));
    for (let k = 0; k < SIZE_CLASSES; k++) {
      const i = col * SIZE_CLASSES + k;
      buy[i] = (buy[i] as number) + (b.buyUsd[k] as number);
      sell[i] = (sell[i] as number) + (b.sellUsd[k] as number);
    }
  }
  const level = new Float32Array(n);
  const buyShare = new Float32Array(n).fill(0.5);
  for (let k = 0; k < SIZE_CLASSES; k++) {
    let peak = 0;
    for (let c = 0; c < cols; c++) {
      const i = c * SIZE_CLASSES + k;
      peak = Math.max(peak, (buy[i] as number) + (sell[i] as number));
    }
    if (peak === 0) continue;
    for (let c = 0; c < cols; c++) {
      const i = c * SIZE_CLASSES + k;
      const total = (buy[i] as number) + (sell[i] as number);
      if (total === 0) continue;
      level[i] = Math.sqrt(total / peak);
      buyShare[i] = (buy[i] as number) / total;
    }
  }
  return { cols, level, buyShare };
}
