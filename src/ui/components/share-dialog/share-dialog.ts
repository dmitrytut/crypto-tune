import './share-dialog.css';
import { CLIP_LENGTHS_SEC, type ClipSeconds } from '../../../metrics/clip-buffer';
import { el } from '../../dom';
import { type Modal, mountModal } from '../modal/modal';

/** Everything the dialog needs from outside: the link, clip data and rendering, analytics. */
export interface ShareHandlers {
  /** The pair's page to share, with a line to go with it. */
  link(): { text: string; url: string };
  onLinkShared(method: 'share' | 'copy'): void;
  /** Whether enough of the live market for a clip of `seconds` has arrived. */
  readiness(seconds: ClipSeconds): { ready: boolean; leftMs: number };
  /** Renders the clip; rejects with the signal's reason when the dialog closes. */
  make(
    seconds: ClipSeconds,
    onProgress: (done: number) => void,
    signal: AbortSignal,
  ): Promise<File>;
  onClipShared(method: 'share' | 'download'): void;
  onClipShareFailed(reason: string): void;
}

export interface ShareDialog extends Modal {
  /** The browser can encode a clip: the clip part shows. */
  enableClips(): void;
}

const DEFAULT_SECONDS: ClipSeconds = 30;
const READINESS_EVERY_MS = 1_000;
/** How long "Link copied" (or a failure) stands in for the link button's label. */
const FLASH_MS = 1_500;

/**
 * The Share dialog behind the header icon. First the clip part, where the browser can encode
 * one: pick 15 or 30 s, make the clip of the market just heard, preview it, then download it or
 * (where the browser shares files, i.e. phones) share the video. Then, after an "or", Share
 * link: the system share sheet on touch devices, a copy elsewhere (a desktop share sheet rarely
 * beats a paste). Sharing the video needs
 * its own press: the share sheet opens only within a user gesture, and the one that started a
 * render has expired by its end. Screen readers hear state changes only; the countdown and the
 * progress bar update quietly.
 */
export function mountShareDialog(h: ShareHandlers): ShareDialog {
  const dialog = el<HTMLDialogElement>('share');
  const shareLink = el<HTMLButtonElement>('share-link');
  const clipSection = el('clip-section');
  const lengths = el<HTMLFieldSetElement>('clip-length');
  const preview = el<HTMLVideoElement>('clip-preview');
  const status = el('clip-status');
  const detail = el('clip-detail');
  const progress = el<HTMLProgressElement>('clip-progress');
  const make = el<HTMLButtonElement>('clip-make');
  const done = el('clip-done');
  const download = el<HTMLButtonElement>('clip-download');
  const share = el<HTMLButtonElement>('clip-share');
  const touch = window.matchMedia('(pointer: coarse)');

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
    if (file || (failed && r.ready)) return;
    failed = false;
    if (r.ready) say(`Ready: the last ${seconds} s.`);
    else say('Preparing clip…', `${Math.ceil(r.leftMs / 1000)} s`);
  };
  const watchReadiness = () => {
    window.clearInterval(timer);
    showReadiness();
    timer = window.setInterval(showReadiness, READINESS_EVERY_MS);
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
    h.onClipShared('download');
  });

  share.addEventListener('click', () => {
    if (!file) return;
    // The video goes alone: with text or a link beside the file, iOS hands most apps (Messages,
    // WhatsApp, Telegram) the link and drops the video. Share link is the button for the link.
    navigator.share({ files: [file] }).then(
      () => h.onClipShared('share'),
      (err: unknown) => {
        // Closing the sheet is not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        h.onClipShareFailed(String(err));
        say('Could not share. Download it instead.');
      },
    );
  });

  let labelTimer = 0;
  /** Says on the link button what just happened, then goes back to its name. */
  const flash = (label: string) => {
    shareLink.textContent = label;
    window.clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      shareLink.textContent = 'Share link';
    }, FLASH_MS);
  };
  const copyLink = (url: string) => {
    if (!navigator.clipboard) return flash('Could not copy');
    navigator.clipboard.writeText(url).then(
      () => {
        h.onLinkShared('copy');
        flash('Link copied');
      },
      () => flash('Could not copy'),
    );
  };
  shareLink.addEventListener('click', () => {
    const link = h.link();
    if (!touch.matches || !navigator.canShare?.(link)) {
      copyLink(link.url);
      return;
    }
    navigator.share(link).then(
      () => h.onLinkShared('share'),
      (err: unknown) => {
        // Closing the sheet is not a failure; anything else falls back to a copy.
        if (!(err instanceof DOMException && err.name === 'AbortError')) copyLink(link.url);
      },
    );
  });

  let clips = false;
  const modal = mountModal('share', 'share-open', () => {
    if (clips) watchReadiness();
  });
  dialog.addEventListener('close', () => {
    window.clearInterval(timer);
    rendering?.abort(new DOMException('Share dialog closed', 'AbortError'));
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
    enableClips() {
      clips = true;
      clipSection.hidden = false;
      if (modal.isOpen()) watchReadiness();
    },
  };
}
