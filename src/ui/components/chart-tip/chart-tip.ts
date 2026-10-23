import './chart-tip.css';
import { eventLabel } from '../../format';
import { isDown } from '../../palette';
import type { MarkerHit } from '../../scene/chart';

/** Gap between the marker and the tooltip, and from the tooltip to the window edge, px. */
const GAP_PX = 8;
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Tooltip for the event markers on the chart, one line: `SELL $219K 04:04:12`.
 * A mouse shows it on hover; a tap shows it until the next tap elsewhere. `find`
 * hit-tests the chart in canvas CSS px. Its outside-press listener lives on `document`
 * with no teardown: mount once per page.
 */
export function mountChartTip(
  canvas: HTMLCanvasElement,
  tip: HTMLElement,
  find: (x: number, y: number) => MarkerHit | null,
): void {
  const what = tip.querySelector<HTMLElement>('.chart-tip-what');
  const when = tip.querySelector<HTMLElement>('.chart-tip-when');
  if (!what || !when) throw new Error('#chart-tip markup incomplete in index.html');

  const hide = () => {
    tip.hidden = true;
    canvas.style.cursor = '';
  };
  const show = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    const hit = find(e.clientX - box.left, e.clientY - box.top);
    if (!hit) {
      hide();
      return;
    }
    const m = hit.marker;
    what.textContent = eventLabel(m.kind, m.side, m.usd);
    what.className = `chart-tip-what ${isDown(m.side) ? 'down' : 'up'}`;
    when.textContent = timeFmt.format(m.ts);
    tip.hidden = false;
    canvas.style.cursor = 'pointer';
    // Centred above the marker, kept inside the window.
    const half = tip.offsetWidth / 2;
    const cx = box.left + hit.x;
    const left = Math.min(Math.max(cx, GAP_PX + half), innerWidth - GAP_PX - half);
    tip.style.left = `${left}px`;
    tip.style.top = `${box.top + hit.y - hit.r - GAP_PX}px`;
  };

  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show);
  // A finger lifting fires pointerleave too; touch tips close on the next press elsewhere.
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) hide();
  });
}
