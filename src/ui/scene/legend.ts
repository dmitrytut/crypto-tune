import { usdFmt } from '../format';
import { DOWN_COLOR, UP_COLOR } from '../palette';
import { fitCanvas } from './canvas';
import { bubbleRadius, SIZE_DECADES, SIZE_MIN_USD } from './spawn';
import { bubbleSprite, dropSprite, haloSprite } from './sprites';

/** One column of the trade legend: how a trade of `usd` looks, as a buy and as a sell. */
export interface LegendMark {
  usd: number;
  /** At or above the large trade threshold: drawn larger, with a halo. */
  big: boolean;
  /** Radius on screen, CSS px. */
  r: number;
  /** `≤ $1K`, `$10K`, … `≥ $1M`: the ends of the scale are open. */
  caption: string;
}

/** The largest mark the scene draws: a big trade at the top of the scale, CSS px. */
const MAX_R = bubbleRadius(Number.POSITIVE_INFINITY, true);
/**
 * Halo of a big mark, in radii. The scene draws it at 4 r; in the legend that would wash over
 * the neighbours, and the canvas would cut it. Rows and side insets leave room for it whole.
 */
const HALO_R = 1.5;
/** Height of one legend row (buys, then sells), CSS px: the largest mark with its halo. */
export const LEGEND_ROW_PX = Math.ceil(2 * MAX_R * HALO_R);
/**
 * Side room for the halo of an edge column, CSS px; the captions take the same padding. It also
 * covers marks scaled down to a narrow column: their halo is at most HALO_R / 2 columns wide.
 */
export const LEGEND_INSET_PX = Math.ceil(MAX_R * (HALO_R - 1));

/**
 * The size scale a step per decade, plus the large trade threshold when it falls between steps
 * or beyond them. Marks are as the scene draws them with this threshold: every step at or above
 * it is big.
 */
export function tradeLegend(bigUsd: number): LegendMark[] {
  const amounts = Array.from({ length: SIZE_DECADES + 1 }, (_, i) => SIZE_MIN_USD * 10 ** i);
  if (!amounts.includes(bigUsd)) amounts.push(bigUsd);
  amounts.sort((a, b) => a - b);
  const last = amounts.length - 1;
  return amounts.map((usd, i) => {
    const big = usd >= bigUsd;
    const amount = usdFmt.format(usd);
    const caption = i === 0 ? `≤ ${amount}` : i === last ? `≥ ${amount}` : amount;
    return { usd, big, r: bubbleRadius(usd, big), caption };
  });
}

/**
 * Draws `marks` in equal columns: a buy bubble in the top row, a sell drop in the bottom one,
 * with the scene's own sprites. A column narrower than the largest mark scales every mark down
 * alike, so their proportions hold on a phone.
 */
export function drawTradeLegend(canvas: HTMLCanvasElement, marks: readonly LegendMark[]): void {
  const dpr = fitCanvas(canvas);
  const g = canvas.getContext('2d');
  if (!g || marks.length === 0) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const col = (w - 2 * LEGEND_INSET_PX) / marks.length;
  const scale = Math.min(1, col / (2 * MAX_R));
  const rows = [
    { y: h / 4, sprite: bubbleSprite(UP_COLOR), halo: haloSprite(UP_COLOR) },
    { y: (h * 3) / 4, sprite: dropSprite(DOWN_COLOR), halo: haloSprite(DOWN_COLOR) },
  ];
  for (const { y, sprite, halo } of rows) {
    marks.forEach((m, i) => {
      const x = LEGEND_INSET_PX + col * (i + 0.5);
      const r = m.r * scale;
      if (m.big) {
        const hr = r * HALO_R;
        g.drawImage(halo, x - hr, y - hr, hr * 2, hr * 2);
      }
      g.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    });
  }
}
