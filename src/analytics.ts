/**
 * Events for Umami (the beacon in index.html counts only on the production host).
 * No identifiers: whether a listener comes back is the number of distinct days this browser has
 * pressed Listen, kept in localStorage and sent with each `listen` event.
 *
 * - `listen` { pair, days }: audio started. Unique visitors per day = daily listeners;
 *   `days` ≥ 2 = returning listeners.
 * - `listen_10m` { pair }: audio kept running for 10 minutes, once per page load: a listener,
 *   not a press-and-leave.
 * - `clip_support` { supported, reason }: once per session, the share of browsers that cannot
 *   make a clip (and see no clip button).
 * - `clip_recorded` { pair, seconds, render_s }: a clip was made; `render_s` is how long that
 *   took, the speed on phones.
 * - `clip_shared` { pair, method }: sent to the share sheet or downloaded.
 * - `clip_failed` { stage, reason }: making or sharing a clip broke.
 */
declare global {
  interface Window {
    /** Set by the Umami script once it loads; missing in dev, behind a blocker or before load. */
    umami?: { track(event: string, data?: Record<string, string | number>): void };
  }
}

const ENGAGED_MS = 10 * 60_000;
const KEY = 'crypto-tune.listen-days.v1';

/** The part of `Storage` the day counter needs; specs pass an in-memory one. */
type DayStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `localStorage`, or null where reading it throws (storage disabled, sandboxed frame). */
function localStore(): DayStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Distinct days this browser has listened, `now`'s day included, and records it. Days are local
 * calendar days (a listener's evening is one day, not two UTC ones). Unavailable storage counts
 * as a first day; a corrupt entry starts the count over.
 * @package
 */
export function countListenDay(
  storage: DayStorage | null = localStore(),
  now: Date = new Date(),
): number {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let prev: { day?: unknown; days?: unknown } | null = null;
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') prev = raw;
  } catch {
    // Unreadable or corrupt: counted as a first day and overwritten below.
  }
  const count = Number.isInteger(prev?.days) ? Math.max(0, Number(prev?.days)) : 0;
  const days = prev?.day === day ? Math.max(count, 1) : count + 1;
  try {
    storage?.setItem(KEY, JSON.stringify({ day, days }));
  } catch {
    // Storage full or disabled: the next start counts from what is stored.
  }
  return days;
}

export class ListenTracker {
  private engagedTimer = 0;
  private engagedSent = false;

  /** Audio started for `pair` (an exchange symbol, or `simulator`). */
  started(pair: string): void {
    window.umami?.track('listen', { pair, days: countListenDay() });
    if (this.engagedSent) return;
    window.clearTimeout(this.engagedTimer);
    this.engagedTimer = window.setTimeout(() => {
      this.engagedSent = true;
      window.umami?.track('listen_10m', { pair });
    }, ENGAGED_MS);
  }

  stopped(): void {
    window.clearTimeout(this.engagedTimer);
  }
}

const SUPPORT_KEY = 'crypto-tune.clip-support.v1';

export class ClipTracker {
  /**
   * Once per session: a reload must not count a browser twice. Marked sent only when Umami is
   * there to take it (not yet loaded, blocked, or a dev host), so a later load still counts.
   */
  support(result: { supported: boolean; reason?: string }): void {
    const umami = window.umami;
    if (!umami) return;
    try {
      if (sessionStorage.getItem(SUPPORT_KEY)) return;
      sessionStorage.setItem(SUPPORT_KEY, '1');
    } catch {
      // No session storage: counted on every load, a small overcount.
    }
    umami.track('clip_support', {
      supported: result.supported ? 'yes' : 'no',
      reason: result.reason ?? 'none',
    });
  }

  recorded(pair: string, seconds: number, renderMs: number): void {
    window.umami?.track('clip_recorded', { pair, seconds, render_s: Math.round(renderMs / 1000) });
  }

  shared(pair: string, method: 'share' | 'download'): void {
    window.umami?.track('clip_shared', { pair, method });
  }

  failed(stage: 'audio' | 'video' | 'share', reason: string): void {
    window.umami?.track('clip_failed', { stage, reason: reason.slice(0, 100) });
  }
}
