import './hint.css';

/**
 * A label that explains itself: `root` holds the label `button` and its tip. Hover or
 * keyboard focus shows the tip (CSS), a click or tap pins it, Esc or a press anywhere
 * else closes it. Those two listeners live on `document` with no teardown: mount once
 * per page.
 */
export function mountHint(root: HTMLElement, button: HTMLButtonElement): void {
  const set = (open: boolean) => {
    root.toggleAttribute('data-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  set(false);
  button.addEventListener('click', () => set(!root.hasAttribute('data-open')));
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Node && root.contains(e.target))) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
}
