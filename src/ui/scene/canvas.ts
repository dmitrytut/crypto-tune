/** Backing stores beyond 2× cost fill rate without a visible gain. */
const MAX_DPR = 2;

/**
 * Matches the canvas backing store to its CSS size at the device pixel ratio
 * (capped at MAX_DPR) and returns that ratio for the 2D transform.
 * @package
 */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}
