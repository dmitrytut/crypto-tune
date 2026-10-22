import type { FeedStatus } from './market-feed';

/** @package */
export interface ReconnectOptions {
  /** First retry delay. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Force a reconnect when connecting or receiving stalls for this long. */
  silenceTimeoutMs?: number;
}

/** Exponential backoff with jitter in [0.5, 1] × capped delay. `attempt` starts at 1. */
function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const capped = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(capped * (0.5 + 0.5 * random()));
}

/**
 * WebSocket that reconnects with backoff and treats prolonged silence as a
 * dead connection. Backoff resets on the first message after (re)connect.
 * @package
 */
export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: number | undefined;
  private silenceTimer: number | undefined;
  private stopped = true;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly silenceTimeoutMs: number;

  constructor(
    private readonly url: string,
    private readonly onMessage: (data: string) => void,
    private readonly onStatus: (s: FeedStatus) => void,
    opts: ReconnectOptions = {},
  ) {
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.silenceTimeoutMs = opts.silenceTimeoutMs ?? 15_000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    this.dropSocket();
    this.onStatus({ state: 'closed' });
  }

  private open(): void {
    this.attempt++;
    this.onStatus({ state: 'connecting', attempt: this.attempt });
    const ws = new WebSocket(this.url);
    this.ws = ws;
    // Also serves as a connect timeout: a handshake can hang in CONNECTING indefinitely.
    this.armSilenceTimer();
    ws.onopen = () => {
      this.onStatus({ state: 'open' });
      this.armSilenceTimer();
    };
    ws.onmessage = (e: MessageEvent) => {
      this.attempt = 0;
      this.armSilenceTimer();
      if (typeof e.data === 'string') this.onMessage(e.data);
    };
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.scheduleRetry(`closed (${e.code})`);
    };
    // onerror is always followed by onclose; nothing to do here.
    ws.onerror = null;
  }

  private armSilenceTimer(): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.scheduleRetry('no data'), this.silenceTimeoutMs);
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    clearTimeout(this.silenceTimer);
    this.dropSocket();
    const inMs = backoffDelay(this.attempt + 1, this.baseDelayMs, this.maxDelayMs);
    this.onStatus({ state: 'reconnecting', attempt: this.attempt + 1, inMs, reason });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), inMs);
  }

  private dropSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
  }
}
