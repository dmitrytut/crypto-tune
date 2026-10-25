import { describe, expect, it } from 'vitest';
import { countListenDay } from '../analytics';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

/** Local time, as the counter reads it. */
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute);

describe('countListenDay', () => {
  it('counts each distinct local day once, gaps included', () => {
    const storage = memoryStorage();
    expect(countListenDay(storage, at(25, 9))).toBe(1);
    expect(countListenDay(storage, at(25, 21))).toBe(1);
    expect(countListenDay(storage, at(26))).toBe(2);
    expect(countListenDay(storage, at(30))).toBe(3);
  });

  it('turns the day at local midnight', () => {
    const storage = memoryStorage();
    expect(countListenDay(storage, at(25, 23, 59))).toBe(1);
    expect(countListenDay(storage, at(26, 0, 1))).toBe(2);
  });

  it('starts over from a corrupt entry and keeps counting after it', () => {
    const storage = memoryStorage();
    storage.setItem('crypto-tune.listen-days.v1', 'garbage{');
    expect(countListenDay(storage, at(25))).toBe(1);
    expect(countListenDay(storage, at(26))).toBe(2);
  });

  it('counts a first day without storage or when writing fails', () => {
    expect(countListenDay(null, at(25))).toBe(1);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(countListenDay(full, at(25))).toBe(1);
  });
});
