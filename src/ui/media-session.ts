/**
 * Browsers hand media keys and the OS "now playing" controls only to a page playing an <audio> or
 * <video> element; Web Audio alone does not count. A looped silent element runs alongside the
 * music for that. Chrome treats media shorter than 5 s as a notification sound with no controls.
 */
const SILENCE_SEC = 10;
const SILENCE_RATE_HZ = 8000;
const ARTIST = 'Crypto Tune';
/** public/apple-touch-icon.png, resolved against the page: the build is served from two paths. */
const ARTWORK = { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' };

/** What a media key or the OS controls asked for. */
export interface MediaActions {
  play(): void;
  pause(): void;
}

/** The page's side of the OS media controls. */
export interface MediaKeys {
  /** Call inside the press that starts audio: the element may only start from a user gesture. */
  play(): void;
  pause(): void;
  /** What the OS controls show as the track, e.g. the pair. */
  setTitle(title: string): void;
}

/**
 * Wires media keys (play/pause on keyboards and headsets) and the OS media controls to `actions`,
 * in the tab and outside it. If the browser or OS pauses the element itself (e.g. a phone
 * handing the audio to another app), the music stops with it. Mount once per page.
 */
export function mountMediaKeys(actions: MediaActions): MediaKeys {
  const session = 'mediaSession' in navigator ? navigator.mediaSession : null;
  const handlers = [
    ['play', actions.play],
    ['pause', actions.pause],
    ['stop', actions.pause],
  ] as const;
  for (const [action, handler] of handlers) {
    try {
      session?.setActionHandler(action, handler);
    } catch {
      // A browser that does not know an action throws; the others still work.
    }
  }

  let title = '';
  let element: HTMLAudioElement | null = null;
  const showMetadata = () => {
    if (!session) return;
    const artwork = [{ ...ARTWORK, src: new URL(ARTWORK.src, document.baseURI).href }];
    session.metadata = new MediaMetadata({ title, artist: ARTIST, artwork });
  };

  return {
    play() {
      if (!element) {
        const wav = new Blob([silentWav(SILENCE_SEC, SILENCE_RATE_HZ)], { type: 'audio/wav' });
        element = new Audio(URL.createObjectURL(wav));
        element.loop = true;
        // Paused by the browser or OS rather than by us: stop the music with it.
        element.addEventListener('pause', actions.pause);
      }
      // Refused (no gesture): the music still plays, only without media keys.
      element.play().catch(() => {});
      showMetadata();
      if (session) session.playbackState = 'playing';
    },
    pause() {
      element?.pause();
      if (session) session.playbackState = 'paused';
    },
    setTitle(next) {
      title = next;
      if (session?.metadata) showMetadata();
    },
  };
}

/** 16-bit mono PCM WAV of zeros. */
function silentWav(seconds: number, rateHz: number): ArrayBuffer {
  const dataBytes = seconds * rateHz * 2;
  const wav = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(wav);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rateHz, true);
  v.setUint32(28, rateHz * 2, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per frame
  v.setUint16(34, 16, true); // bits per sample
  tag(36, 'data');
  v.setUint32(40, dataBytes, true);
  return wav;
}
