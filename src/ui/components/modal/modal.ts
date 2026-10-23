import './modal.css';
import { el } from '../../dom';

/** What the rest of the view may ask a modal dialog. */
export interface Modal {
  isOpen(): boolean;
}

/**
 * Opens `<dialog id={id}>` as a modal from the button `#openerId`. It closes on its ✕ (a
 * `method="dialog"` submit), Esc, or a click on the backdrop.
 */
export function mountModal(id: string, openerId: string): Modal {
  const dialog = el<HTMLDialogElement>(id);
  el(openerId).addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', (e) => {
    // A click on the dialog element itself (not its content) is a click on the backdrop.
    if (e.target === dialog) dialog.close();
  });
  return { isOpen: () => dialog.open };
}
