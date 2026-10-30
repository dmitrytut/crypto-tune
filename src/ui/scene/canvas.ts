/** Backing stores beyond 2× cost fill rate without a visible gain. @package */
export const MAX_DPR = 2;

/**
 * Matches the canvas backing store to its CSS size at the device pixel ratio
 * (capped at maxDpr) and returns that ratio for the 2D transform.
 * @package
 */
export function fitCanvas(canvas: HTMLCanvasElement, maxDpr = MAX_DPR): number {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}
