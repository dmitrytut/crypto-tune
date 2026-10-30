import { el } from '../dom';
import type { GestureFeedback } from './gesture-feedback';
import { DRAG_SLOP_PX, type PointerStroke } from './interaction';

const TOUCH_PADDING_PX = 12;

/**
 * A single canvas owns game gestures; overlays and controls keep their native pointer behavior.
 * @package
 */
export function mountParticleInput(
  canvas: HTMLCanvasElement,
  stroke: PointerStroke,
  reducedMotion: MediaQueryList,
  feedback: GestureFeedback,
): () => void {
  let active = -1;
  let blocked = -1;
  let pendingTap = false;
  let panAllowed = false;
  let startX = 0;
  let startY = 0;
  const root = document.documentElement;
  const viewport = window.visualViewport;

  // touch-action is decided before pointerdown: changing it during a gesture cannot restore pan.
  const updatePan = () => {
    const scrolls = root.scrollHeight > root.clientHeight;
    const zoomed = viewport !== null && viewport.scale > 1.01;
    panAllowed = scrolls || zoomed;
    canvas.style.touchAction = panAllowed ? 'pan-y pinch-zoom' : 'pinch-zoom';
  };
  updatePan();
  const resize = new ResizeObserver(updatePan);
  resize.observe(root);
  // Root has a fixed height; content may grow without changing its observed box.
  resize.observe(el('stage'));
  window.addEventListener('resize', updatePan);
  viewport?.addEventListener('resize', updatePan);

  const begin = (x: number, y: number, padding: number) => {
    stroke.begin(x, y, padding);
    feedback.begin(x, y);
  };
  const move = (x: number, y: number) => {
    stroke.move(x, y);
    feedback.move(x, y);
  };

  const cancel = () => {
    active = -1;
    blocked = -1;
    pendingTap = false;
    stroke.cancel();
    feedback.clear();
  };
  // Capture phase sees a second finger even if it lands on a button, chart or dialog.
  // One active pointer across input devices also prevents a mouse/pen from splicing a touch path.
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (active !== -1 && event.pointerId !== active) {
        const first = active;
        cancel();
        blocked = first;
      }
    },
    true,
  );

  canvas.addEventListener('pointerdown', (event) => {
    if (
      active !== -1 ||
      blocked !== -1 ||
      document.hidden ||
      !event.isPrimary ||
      (event.pointerType !== 'touch' && event.button !== 0) ||
      (event.pointerType !== 'touch' &&
        event.pointerType !== 'mouse' &&
        event.pointerType !== 'pen')
    )
      return;
    // Capture before window's bubbling wake handler reveals the hidden Listen button.
    canvas.setPointerCapture(event.pointerId);
    active = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    // Let a scroll-eligible touch prove it is a tap or horizontal stroke before any pop.
    pendingTap = event.pointerType === 'touch' && panAllowed;
    if (!pendingTap) begin(startX, startY, event.pointerType === 'touch' ? TOUCH_PADDING_PX : 3);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== active) return;
    if (pendingTap) {
      const dx = Math.abs(event.clientX - startX);
      const dy = Math.abs(event.clientY - startY);
      if (dx <= DRAG_SLOP_PX || dx <= dy) return;
      pendingTap = false;
      begin(startX, startY, TOUCH_PADDING_PX);
    }
    move(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === blocked) blocked = -1;
    if (event.pointerId !== active) return;
    if (pendingTap) {
      const distanceSq = (event.clientX - startX) ** 2 + (event.clientY - startY) ** 2;
      if (distanceSq <= DRAG_SLOP_PX ** 2) begin(event.clientX, event.clientY, TOUCH_PADDING_PX);
      pendingTap = false;
    } else {
      move(event.clientX, event.clientY);
    }
    stroke.finish();
    feedback.finish();
    active = -1;
    // Implicit lostpointercapture follows normal pointerup; keep the queued tap until rAF.
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (event.pointerId === blocked) blocked = -1;
    if (event.pointerId === active) cancel();
  });
  canvas.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === blocked) blocked = -1;
    if (event.pointerId === active) cancel();
  });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  });
  reducedMotion.addEventListener('change', cancel);
  return cancel;
}
