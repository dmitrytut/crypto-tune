import { describe, expect, it } from 'vitest';
import { CLIP_FORMAT } from '../../clip-format';
import { CLIP_LAYOUT, CLIP_STAGE } from '../clip-layout';

describe('clip layout', () => {
  it('fills exactly the encoded frame', () => {
    expect(CLIP_STAGE.width * CLIP_STAGE.pixelRatio).toBe(CLIP_FORMAT.width);
    expect(CLIP_STAGE.height * CLIP_STAGE.pixelRatio).toBe(CLIP_FORMAT.height);
  });

  it('stacks price, readouts, chart and watermark top to bottom inside the frame', () => {
    const { pair, price, change, event, chart, watermark } = CLIP_LAYOUT;
    // Each block as [top, bottom]; a text line spans its font size above the baseline and a
    // quarter of it below for descenders.
    const text = (t: { y: number; size: number }) => [t.y - t.size, t.y + t.size / 4];
    const blocks = [
      text(pair),
      text(price),
      text(change),
      text(event),
      [chart.y, chart.y + chart.height],
      text(watermark),
    ] as const;
    expect(blocks[0][0]).toBeGreaterThanOrEqual(0);
    expect(blocks.at(-1)?.[1]).toBeLessThanOrEqual(CLIP_STAGE.height);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i]?.[0], `block ${i} overlaps the one above`).toBeGreaterThan(
        blocks[i - 1]?.[1] ?? Number.POSITIVE_INFINITY,
      );
    }
    expect(chart.x).toBeGreaterThanOrEqual(0);
    expect(chart.x + chart.width).toBeLessThanOrEqual(CLIP_STAGE.width);
  });

  it('bursts liquidations from the price', () => {
    const { origin, price } = CLIP_LAYOUT;
    expect(origin.y).toBeLessThan(price.y);
    expect(origin.y).toBeGreaterThan(price.y - price.size);
  });
});
