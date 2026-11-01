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
  /** Text and link for the post's caption; copied, not put in the share sheet. */
  caption(): string;
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
 * one that started a render has expired by its end. Screen readers hear state changes only;
 * the countdown and the progress bar update quietly.
 */
export function mountClipDialog(h: ClipHandlers): ClipDialog {
  const dialog = el<HTMLDialogElement>('clip');
  const opener = el<HTMLButtonElement>('clip-open');
  const lengths = el<HTMLFieldSetElement>('clip-length');
  const preview = el<HTMLVideoElement>('clip-preview');
  const status = el('clip-status');
  const detail = el('clip-detail');
  const progress = el<HTMLProgressElement>('clip-progress');
  const make = el<HTMLButtonElement>('clip-make');
  const done = el('clip-done');
  const download = el<HTMLButtonElement>('clip-download');
  const share = el<HTMLButtonElement>('clip-share');

  let seconds: ClipSeconds = DEFAULT_SECONDS;
  let file: File | null = null;
  let fileUrl = '';
  let rendering: AbortController | null = null;
  /** The last render failed: its message stays until the next action. */
  let failed = false;
  let timer = 0;

  /** Announced only when the words change, so a repeated state is not read again. */
  const say = (text: string, quiet = '') => {
    if (status.textContent !== text) status.textContent = text;
    detail.textContent = quiet;
  };

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
        failed = false;
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
  /** Make is enabled once enough data is in; until then the status counts down. */
  const showReadiness = () => {
    if (rendering) return;
    const r = h.readiness(seconds);
    make.disabled = !r.ready;
    if (failed || file) return;
    if (r.ready) say(`Ready: the last ${seconds} s.`);
    else say('Preparing clip…', `${Math.ceil(r.leftMs / 1000)} s`);
  };

  make.addEventListener('click', async () => {
    clearClip();
    failed = false;
    const controller = new AbortController();
    rendering = controller;
    lengths.disabled = true;
    make.disabled = true;
    progress.value = 0;
    progress.hidden = false;
    say('Rendering…');
    try {
      const made = await h.make(
        seconds,
        (part) => {
          progress.value = part;
          detail.textContent = `${Math.floor(part * 100)} %`;
        },
        controller.signal,
      );
      // Closed meanwhile: the result belongs to no one.
      if (controller.signal.aborted) return;
      file = made;
      fileUrl = URL.createObjectURL(made);
      preview.src = fileUrl;
      preview.hidden = false;
      share.hidden = !navigator.canShare?.({ files: [made] });
      done.hidden = false;
      make.textContent = 'Make another';
      say(`Your ${seconds} s clip is ready.`);
      (share.hidden ? download : share).focus();
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Clip failed', err);
      failed = true;
      make.textContent = 'Try again';
      say('Could not make the clip.');
    } finally {
      if (rendering === controller) {
        rendering = null;
        lengths.disabled = false;
        progress.hidden = true;
        showReadiness();
        // Enabled again only now: the press that failed may try again from the keyboard.
        if (failed) make.focus();
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
    // With text or a link beside the file, iOS hands most apps (Messages, WhatsApp, Telegram)
    // the link and drops the video. So the video goes alone and the link waits on the clipboard
    // for the caption. Both calls run straight from the press: each needs the user activation.
    navigator.clipboard?.writeText(h.caption()).then(
      () => say('Link copied: paste it with the video.'),
      () => {},
    );
    navigator.share({ files: [file] }).then(
      () => h.onShared('share'),
      (err: unknown) => {
        // Closing the sheet is not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        h.onShareFailed(String(err));
        say('Could not share. Download it instead.');
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
    failed = false;
    lengths.disabled = false;
    progress.hidden = true;
    clearClip();
    make.textContent = 'Make clip';
    say('');
  });

  return {
    isOpen: modal.isOpen,
    enable() {
      opener.classList.add('ready');
    },
  };
}
