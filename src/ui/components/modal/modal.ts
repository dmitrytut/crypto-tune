import './modal.css';
import { el } from '../../dom';

/** What the rest of the view may ask a modal dialog. */
export interface Modal {
  isOpen(): boolean;
}

/**
 * Opens `<dialog id={id}>` as a modal from the button `#openerId`, then calls `onOpen` (the
 * dialog has its layout by then). It closes on its ✕ (a `method="dialog"` submit), Esc, or a
 * click on the backdrop.
 */
export function mountModal(id: string, openerId: string, onOpen?: () => void): Modal {
  const dialog = el<HTMLDialogElement>(id);
  el(openerId).addEventListener('click', () => {
    dialog.showModal();
    onOpen?.();
  });
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    // A drag from dialog content can also end with the dialog as the click target.
    if (downOnBackdrop && e.target === dialog) dialog.close();
  });
  return { isOpen: () => dialog.open };
}
