/** Binance adds or delists a perpetual a few times a week at most: a day-old list is good enough. */
const TTL_MS = 24 * 60 * 60_000;
const KEY = 'crypto-tune.binance-symbols.v1';

/** The part of `Storage` the cache needs; specs pass an in-memory one. */
export type SymbolStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface Entry {
  /** When the list was fetched, epoch ms. */
  at: number;
  symbols: string[];
}

function isEntry(v: unknown): v is Entry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<Entry>;
  return (
    typeof e.at === 'number' &&
    Array.isArray(e.symbols) &&
    e.symbols.length > 0 &&
    e.symbols.every((s) => typeof s === 'string')
  );
}

/** `localStorage`, or null where reading it throws (storage disabled, sandboxed frame). */
function localStore(): SymbolStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The symbol list from `storage` if fetched less than a day ago, else from `fetchList`.
 * Only a non-empty fetched list is stored: a failed fetch rejects and an empty one is
 * returned as is, so the next call tries the network again. Storage failures and
 * malformed entries count as "nothing cached".
 */
export async function cachedSymbols(
  fetchList: () => Promise<string[]>,
  storage: SymbolStorage | null = localStore(),
  now: number = Date.now(),
): Promise<string[]> {
  try {
    const raw = storage?.getItem(KEY);
    const entry: unknown = raw ? JSON.parse(raw) : null;
    // A timestamp in the future (clock moved back) is not trusted as fresh.
    if (isEntry(entry) && entry.at <= now && now - entry.at < TTL_MS) return entry.symbols;
  } catch {
    // Unreadable or corrupt: fetch as on a first visit.
  }
  const symbols = await fetchList();
  if (symbols.length > 0) {
    try {
      storage?.setItem(KEY, JSON.stringify({ at: now, symbols } satisfies Entry));
    } catch {
      // Cache is optional (storage full or disabled).
    }
  }
  return symbols;
}
