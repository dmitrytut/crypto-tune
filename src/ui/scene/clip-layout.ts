/**
 * The scene of a clip is phone-sized, so bubbles, drops and chart markers look as they do on a
 * phone (where clips are watched) rather than scattered over a desktop-wide canvas. CSS px;
 * times `pixelRatio` it is the clip's frame.
 */
export const CLIP_STAGE = { width: 432, height: 768, pixelRatio: 2.5 } as const;

/** A centred line of text: baseline `y`, font size and weight, stage px. */
export interface TextSpot {
  y: number;
  size: number;
  weight: number;
}

export interface ClipLayout {
  pair: TextSpot;
  price: TextSpot;
  change: TextSpot;
  event: TextSpot;
  watermark: TextSpot;
  /** The price/volume strip; drops land on its line. */
  chart: { x: number; y: number; width: number; height: number };
  /** Where liquidations burst from: the middle of the price. */
  origin: { x: number; y: number };
}

/**
 * Not a crop of the screen: price on top, the aura and particles through the middle, the chart
 * at the bottom and the watermark under it.
 * @package
 */
export const CLIP_LAYOUT: ClipLayout = {
  pair: { y: 72, size: 17, weight: 600 },
  price: { y: 130, size: 46, weight: 700 },
  change: { y: 160, size: 15, weight: 600 },
  event: { y: 188, size: 15, weight: 500 },
  chart: { x: 0, y: 556, width: CLIP_STAGE.width, height: 150 },
  watermark: { y: 744, size: 16, weight: 600 },
  origin: { x: CLIP_STAGE.width / 2, y: 114 },
};
