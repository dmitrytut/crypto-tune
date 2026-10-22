import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectingSocket } from './reconnecting-socket';
import type { FeedStatus } from './types';

/** Socket that never completes its handshake unless told to. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

describe('ReconnectingSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('abandons a handshake that hangs in CONNECTING and retries', () => {
    const statuses: FeedStatus[] = [];
    const sock = new ReconnectingSocket(
      'wss://x',
      () => {},
      (s) => statuses.push(s),
      {
        silenceTimeoutMs: 5_000,
        baseDelayMs: 1_000,
      },
    );
    sock.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(5_000);
    expect(FakeWebSocket.instances[0]?.closed).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', reason: 'no data' });

    // Second attempt without any data: delay within [0.5, 1] × 2 × base.
    vi.advanceTimersByTime(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    sock.stop();
  });

  it('reconnects after an open socket goes silent, and backoff resets on data', () => {
    const got: string[] = [];
    const statuses: FeedStatus[] = [];
    const sock = new ReconnectingSocket(
      'wss://x',
      (d) => got.push(d),
      (s) => statuses.push(s),
      {
        silenceTimeoutMs: 5_000,
        baseDelayMs: 1_000,
      },
    );
    sock.start();
    const first = FakeWebSocket.instances[0] as FakeWebSocket;
    first.open();
    first.onmessage?.({ data: 'a' });
    vi.advanceTimersByTime(4_999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    // First retry after data uses attempt 1: delay within [0.5, 1] × base.
    const retry = statuses.at(-1);
    expect(retry).toMatchObject({ state: 'reconnecting', attempt: 1 });
    expect(retry?.state === 'reconnecting' && retry.inMs).toBeLessThanOrEqual(1_000);
    expect(got).toEqual(['a']);
    sock.stop();
  });

  it('stops retrying after stop()', () => {
    const sock = new ReconnectingSocket(
      'wss://x',
      () => {},
      () => {},
      { silenceTimeoutMs: 1_000 },
    );
    sock.start();
    sock.stop();
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
