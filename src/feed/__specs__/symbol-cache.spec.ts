import { describe, expect, it, vi } from 'vitest';
import { cachedSymbols, type SymbolStorage } from '../symbol-cache';

const DAY_MS = 24 * 60 * 60_000;
const T0 = 1_792_700_000_000;
const LIST = ['BTCUSDT', 'ETHUSDT'];

function memoryStorage(): SymbolStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('cachedSymbols', () => {
  it('serves the stored list for a day, then fetches again', async () => {
    const storage = memoryStorage();
    const fetchList = vi.fn(async () => LIST);
    await cachedSymbols('usdm', fetchList, storage, T0);
    expect(await cachedSymbols('usdm', fetchList, storage, T0 + DAY_MS - 1)).toEqual(LIST);
    expect(fetchList).toHaveBeenCalledTimes(1);
    await cachedSymbols('usdm', fetchList, storage, T0 + DAY_MS);
    expect(fetchList).toHaveBeenCalledTimes(2);
  });

  it('keeps each market its own list', async () => {
    const storage = memoryStorage();
    await cachedSymbols('usdm', async () => LIST, storage, T0);
    const coinM = ['BTCUSD_PERP'];
    expect(await cachedSymbols('coinm', async () => coinM, storage, T0 + 1)).toEqual(coinM);
    expect(await cachedSymbols('usdm', async () => [], storage, T0 + 2)).toEqual(LIST);
  });

  it('does not cache a failed fetch', async () => {
    const storage = memoryStorage();
    await expect(
      cachedSymbols('usdm', () => Promise.reject(new Error('HTTP 418')), storage, T0),
    ).rejects.toThrow('HTTP 418');
    expect(await cachedSymbols('usdm', async () => LIST, storage, T0 + 1)).toEqual(LIST);
  });

  it('returns but does not cache an empty list', async () => {
    const storage = memoryStorage();
    expect(await cachedSymbols('usdm', async () => [], storage, T0)).toEqual([]);
    const fetchList = vi.fn(async () => LIST);
    expect(await cachedSymbols('usdm', fetchList, storage, T0 + 1)).toEqual(LIST);
    expect(fetchList).toHaveBeenCalledOnce();
  });

  it.each([
    ['corrupt JSON', '{'],
    ['an old bare array', JSON.stringify(LIST)],
    ['an empty list', JSON.stringify({ at: T0, symbols: [] })],
    ['a timestamp in the future', JSON.stringify({ at: T0 + 60_000, symbols: ['OLDUSDT'] })],
  ])('refetches over %s', async (_, raw) => {
    const storage = memoryStorage();
    storage.data.set('crypto-tune.binance-symbols.usdm.v1', raw);
    expect(await cachedSymbols('usdm', async () => LIST, storage, T0)).toEqual(LIST);
  });

  it('still returns the list when storage throws', async () => {
    const broken: SymbolStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(await cachedSymbols('usdm', async () => LIST, broken, T0)).toEqual(LIST);
  });
});
