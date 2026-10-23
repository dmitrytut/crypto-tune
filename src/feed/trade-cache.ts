import type { Trade } from './market-feed';

const DB_NAME = 'crypto-tune';
const DB_VERSION = 1;
const STORE = 'trades';

/**
 * A trade with the exchange's sequence id, so a restored cache can be extended without gaps.
 * @package
 */
export interface CachedTrade extends Trade {
  /** Contiguous per symbol (Binance aggregate trade id). */
  id: number;
}

/** Recent trades of one pair kept across reloads. */
export interface TradeStore {
  /** Saved trades, oldest first; empty when nothing is stored or storage is unavailable. */
  load(): Promise<CachedTrade[]>;
  /** Best effort: never throws, a failed save just means a longer fetch next time. */
  save(trades: readonly CachedTrade[]): Promise<void>;
}

/**
 * For feeds without persistence (and specs).
 * @package
 */
export const NO_STORE: TradeStore = {
  load: async () => [],
  save: async () => {},
};

/**
 * Column layout: typed arrays clone into IndexedDB compactly (~33 bytes per trade).
 * @package
 */
export interface TradeColumns {
  id: Float64Array;
  ts: Float64Array;
  price: Float64Array;
  qty: Float64Array;
  /** 1 = buy aggressor, 0 = sell. */
  buy: Uint8Array;
}

/** @package */
export function encodeTrades(trades: readonly CachedTrade[]): TradeColumns {
  const n = trades.length;
  const cols: TradeColumns = {
    id: new Float64Array(n),
    ts: new Float64Array(n),
    price: new Float64Array(n),
    qty: new Float64Array(n),
    buy: new Uint8Array(n),
  };
  for (const [i, t] of trades.entries()) {
    cols.id[i] = t.id;
    cols.ts[i] = t.ts;
    cols.price[i] = t.price;
    cols.qty[i] = t.qty;
    cols.buy[i] = t.side === 'buy' ? 1 : 0;
  }
  return cols;
}

/** @package */
export function decodeTrades(cols: TradeColumns): CachedTrade[] {
  const out: CachedTrade[] = [];
  for (let i = 0; i < cols.ts.length; i++) {
    out.push({
      id: cols.id[i] as number,
      ts: cols.ts[i] as number,
      price: cols.price[i] as number,
      qty: cols.qty[i] as number,
      side: cols.buy[i] ? 'buy' : 'sell',
    });
  }
  return out;
}

let db: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!db) {
    const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const conn = req.result;
      // Another tab deleting or upgrading the DB must not wait on us: let go and reopen later.
      conn.onversionchange = () => {
        conn.close();
        db = null;
      };
      resolve(conn);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    db = promise;
    // A failed open (private mode, blocked storage) must not be cached forever as a rejection.
    promise.catch(() => {
      db = null;
    });
  }
  return db;
}

async function request<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const d = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const tx = d.transaction(STORE, mode);
  const req = run(tx.objectStore(STORE));
  // Commit now, not when the task ends: a save on pagehide must land before the page is gone.
  if (mode === 'readwrite') tx.commit();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

/** Validates a stored record; records from older layouts (no ids) are simply not reused. */
function isColumns(v: unknown): v is TradeColumns {
  if (!v || typeof v !== 'object') return false;
  const cols = v as Partial<Record<keyof TradeColumns, unknown>>;
  const n = cols.ts instanceof Float64Array ? cols.ts.length : -1;
  return (
    n >= 0 &&
    cols.id instanceof Float64Array &&
    cols.id.length === n &&
    cols.price instanceof Float64Array &&
    cols.price.length === n &&
    cols.qty instanceof Float64Array &&
    cols.qty.length === n &&
    cols.buy instanceof Uint8Array &&
    cols.buy.length === n
  );
}

/**
 * Per-key trade store in IndexedDB (one record per pair, overwritten on save).
 * Every failure — no IndexedDB, quota, corrupt or outdated record — degrades to
 * "nothing cached": the feed then loads history over REST as on a first visit.
 */
export function indexedDbTradeStore(key: string): TradeStore {
  return {
    async load() {
      try {
        const v = await request('readonly', (s) => s.get(key));
        return isColumns(v) ? decodeTrades(v) : [];
      } catch {
        return [];
      }
    },
    async save(trades) {
      try {
        await request('readwrite', (s) => s.put(encodeTrades(trades), key));
      } catch (err) {
        console.warn('Trade cache not saved', err);
      }
    },
  };
}
