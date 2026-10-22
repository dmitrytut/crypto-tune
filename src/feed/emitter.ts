import type { Unsubscribe } from './types';

/** Minimal typed listener set shared by feed implementations. */
export class Emitter<T> {
  private readonly listeners = new Set<(v: T) => void>();

  on(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(v: T): void {
    for (const cb of this.listeners) cb(v);
  }
}
