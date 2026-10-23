import './hint.css';

/** Info icon (Lucide, ISC). */
const INFO_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
/** Gap between the label and its tip, and from the tip to the window edge, px. */
const GAP_PX = 8;

/** A mounted hint: `root` goes next to what it explains, `body` holds the tip's content. */
export interface Hint {
  root: HTMLElement;
  body: HTMLElement;
}

/** The one hint showing now; opening another closes it. */
let shown: { root: HTMLElement; hide(): void } | null = null;
let closersInstalled = false;
let nextId = 0;

/** Page-level closers, installed once with the first hint; they live as long as the page. */
function installClosers(): void {
  closersInstalled = true;
  document.addEventListener('pointerdown', (e) => {
    if (shown && !(e.target instanceof Node && shown.root.contains(e.target))) shown.hide();
  });
  // Capture, so inside the settings dialog Esc closes the tip first and the dialog stays.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !shown) return;
      e.preventDefault();
      e.stopPropagation();
      shown.hide();
    },
    true,
  );
  // The tip is placed once when shown; a scroll or resize would leave it beside nothing.
  document.addEventListener('scroll', () => shown?.hide(), true);
  window.addEventListener('resize', () => shown?.hide());
}

/**
 * A label that explains itself. The button is the ⓘ icon, or `label` followed by it with
 * `showLabel`; the tip opens in the top layer (a popover), so a scrolling dialog never clips
 * it, above the button when there is room and below otherwise. A mouse shows it on hover,
 * keyboard focus shows it, a click or tap pins it; Esc or a press elsewhere closes it.
 */
export function createHint(
  label: string,
  { showLabel = false, text = '' }: { showLabel?: boolean; text?: string } = {},
): Hint {
  if (!closersInstalled) installClosers();
  const root = document.createElement('span');
  root.className = 'hint';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hint-btn';
  if (showLabel) button.append(label);
  else button.setAttribute('aria-label', `About ${label}`);
  button.insertAdjacentHTML('beforeend', INFO_ICON);
  const body = document.createElement('div');
  body.className = 'hint-pop';
  body.id = `hint-${nextId++}`;
  body.setAttribute('role', 'tooltip');
  body.popover = 'manual';
  body.textContent = text;
  button.setAttribute('aria-describedby', body.id);
  button.setAttribute('aria-expanded', 'false');
  root.append(button, body);

  let pinned = false;
  const state = {
    root,
    hide() {
      pinned = false;
      button.setAttribute('aria-expanded', 'false');
      if (body.matches(':popover-open')) body.hidePopover();
      if (shown === state) shown = null;
    },
  };
  const show = () => {
    if (shown && shown !== state) shown.hide();
    shown = state;
    button.setAttribute('aria-expanded', 'true');
    if (!body.matches(':popover-open')) body.showPopover();
    const r = button.getBoundingClientRect();
    const left = Math.min(Math.max(r.left, GAP_PX), innerWidth - body.offsetWidth - GAP_PX);
    const above = r.top - GAP_PX - body.offsetHeight;
    body.style.left = `${left}px`;
    body.style.top = `${above >= GAP_PX ? above : r.bottom + GAP_PX}px`;
  };

  root.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') show();
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pinned) state.hide();
  });
  button.addEventListener('focus', () => {
    if (button.matches(':focus-visible')) show();
  });
  button.addEventListener('blur', () => {
    if (!pinned) state.hide();
  });
  button.addEventListener('click', () => {
    if (pinned) {
      state.hide();
      return;
    }
    pinned = true;
    show();
  });
  return { root, body };
}
