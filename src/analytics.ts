/**
 * Listening events for Umami (the beacon in index.html counts only on the production host).
 * No identifiers: whether a listener comes back is the number of distinct days this browser has
 * pressed Listen, kept in localStorage and sent with each `listen` event.
 *
 * - `listen` { pair, days }: audio started. Unique visitors per day = daily listeners;
 *   `days` ≥ 2 = returning listeners.
 * - `listen_10m` { pair }: audio kept running for 10 minutes, once per page load: a listener,
 *   not a press-and-leave.
 */
declare global {
  interface Window {
    /** Set by the Umami script once it loads; missing in dev, behind a blocker or before load. */
    umami?: { track(event: string, data?: Record<string, string | number>): void };
  }
}

const ENGAGED_MS = 10 * 60_000;
const KEY = 'crypto-tune.listen-days.v1';

/** Local calendar day, `YYYY-MM-DD`: a listener's day, not UTC's. */
function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Distinct days this browser has listened, today included; 1 when storage is unavailable. */
function countListenDay(): number {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const prev =
      raw && typeof raw === 'object' && 'day' in raw && 'days' in raw ? raw : { day: '', days: 0 };
    const day = localDay();
    const count = Number.isInteger(prev.days) ? Number(prev.days) : 0;
    const days = prev.day === day ? Math.max(count, 1) : count + 1;
    localStorage.setItem(KEY, JSON.stringify({ day, days }));
    return days;
  } catch {
    return 1;
  }
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
