import './clip-dialog.css';
import { CLIP_LENGTHS_SEC, type ClipSeconds } from '../../../metrics/clip-buffer';
import { el } from '../../dom';
import { type Modal, mountModal } from '../modal/modal';

/** Everything the dialog needs from outside: data, rendering and the share wording. */
export interface ClipHandlers {
  /** Whether enough of the live market for a clip of `seconds` has arrived. */
  readiness(seconds: ClipSeconds): { ready: boolean; leftMs: number };
  /** Renders the clip; rejects with the signal's reason when the dialog closes. */
  make(
    seconds: ClipSeconds,
    onProgress: (done: number) => void,
    signal: AbortSignal,
  ): Promise<File>;
  /** Text and link that go with the file into the share sheet. */
  shareData(): { text: string; url: string };
  onShared(method: 'share' | 'download'): void;
  onShareFailed(reason: string): void;
}

export interface ClipDialog extends Modal {
  /** The browser can encode a clip: the header button shows. */
  enable(): void;
}

const DEFAULT_SECONDS: ClipSeconds = 30;
const READINESS_EVERY_MS = 1_000;

/**
 * The clip dialog behind the share icon: pick 15 or 30 s, make the clip of the market just
 * heard, preview it, then download it or (where the browser shares files, i.e. phones) share
 * it. Sharing needs its own press: the share sheet opens only within a user gesture, and the
 * one that started a render has expired by its end.
 */
export function mountClipDialog(h: ClipHandlers): ClipDialog {
  const dialog = el<HTMLDialogElement>('clip');
  const opener = el<HTMLButtonElement>('clip-open');
  const lengths = el<HTMLFieldSetElement>('clip-length');
  const preview = el<HTMLVideoElement>('clip-preview');
  const status = el('clip-status');
  const make = el<HTMLButtonElement>('clip-make');
  const done = el('clip-done');
  const download = el<HTMLButtonElement>('clip-download');
  const share = el<HTMLButtonElement>('clip-share');

  let seconds: ClipSeconds = DEFAULT_SECONDS;
  let file: File | null = null;
  let fileUrl = '';
  let rendering: AbortController | null = null;
  let timer = 0;

  lengths.replaceChildren(
    ...CLIP_LENGTHS_SEC.map((s) => {
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'clip-length';
      radio.className = 'visually-hidden';
      radio.value = String(s);
      radio.checked = s === seconds;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        seconds = s;
        showReadiness();
      });
      const label = document.createElement('label');
      label.append(radio, `${s} s`);
      return label;
    }),
  );

  const clearClip = () => {
    file = null;
    done.hidden = true;
    preview.hidden = true;
    preview.removeAttribute('src');
    preview.load();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = '';
  };
  /** Make is enabled once enough data is in; the status counts down until then. */
  const showReadiness = () => {
    if (rendering) return;
    const r = h.readiness(seconds);
    make.disabled = !r.ready;
    if (!r.ready) status.textContent = `Preparing clip… ${Math.ceil(r.leftMs / 1000)} s`;
    else if (!file) status.textContent = `Ready: the last ${seconds} s.`;
  };

  make.addEventListener('click', async () => {
    clearClip();
    const controller = new AbortController();
    rendering = controller;
    lengths.disabled = true;
    make.disabled = true;
    status.textContent = 'Rendering… 0 %';
    try {
      file = await h.make(
        seconds,
        (part) => {
          status.textContent = `Rendering… ${Math.floor(part * 100)} %`;
        },
        controller.signal,
      );
      fileUrl = URL.createObjectURL(file);
      preview.src = fileUrl;
      preview.hidden = false;
      share.hidden = !navigator.canShare?.({ files: [file] });
      done.hidden = false;
      make.textContent = 'Make another';
      status.textContent = `Your ${seconds} s clip is ready.`;
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Clip failed', err);
      make.textContent = 'Try again';
      status.textContent = 'Could not make the clip.';
    } finally {
      if (rendering === controller) {
        rendering = null;
        lengths.disabled = false;
        showReadiness();
      }
    }
  });

  download.addEventListener('click', () => {
    if (!file) return;
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = file.name;
    a.click();
    h.onShared('download');
  });

  share.addEventListener('click', () => {
    if (!file) return;
    // Called straight from the press: the share sheet needs its user activation.
    navigator.share({ files: [file], ...h.shareData() }).then(
      () => h.onShared('share'),
      (err: unknown) => {
        // Closing the sheet is not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        h.onShareFailed(String(err));
        status.textContent = 'Could not share. Download it instead.';
      },
    );
  });

  const modal = mountModal('clip', 'clip-open', () => {
    showReadiness();
    timer = window.setInterval(showReadiness, READINESS_EVERY_MS);
  });
  dialog.addEventListener('close', () => {
    window.clearInterval(timer);
    rendering?.abort(new DOMException('Clip dialog closed', 'AbortError'));
    rendering = null;
    lengths.disabled = false;
    clearClip();
    make.textContent = 'Make clip';
  });

  return {
    isOpen: modal.isOpen,
    enable() {
      opener.classList.add('ready');
    },
  };
}
