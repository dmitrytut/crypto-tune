import type { Trade } from './market-feed';
import type { TradeStore } from './warm-start';

const DB_NAME = 'crypto-tune';
const DB_VERSION = 1;
const STORE = 'trades';

/** Column layout: typed arrays clone into IndexedDB compactly (~25 bytes per trade). */
export interface TradeColumns {
  ts: Float64Array;
  price: Float64Array;
  qty: Float64Array;
  /** 1 = buy aggressor, 0 = sell. */
  buy: Uint8Array;
}

export function encodeTrades(trades: readonly Trade[]): TradeColumns {
  const n = trades.length;
  const cols: TradeColumns = {
    ts: new Float64Array(n),
    price: new Float64Array(n),
    qty: new Float64Array(n),
    buy: new Uint8Array(n),
  };
  for (const [i, t] of trades.entries()) {
    cols.ts[i] = t.ts;
    cols.price[i] = t.price;
    cols.qty[i] = t.qty;
    cols.buy[i] = t.side === 'buy' ? 1 : 0;
  }
  return cols;
}

export function decodeTrades(cols: TradeColumns): Trade[] {
  const out: Trade[] = [];
  for (let i = 0; i < cols.ts.length; i++) {
    out.push({
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
  const req = run(d.transaction(STORE, mode).objectStore(STORE));
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

function isColumns(v: unknown): v is TradeColumns {
  return (
    !!v &&
    typeof v === 'object' &&
    'ts' in v &&
    v.ts instanceof Float64Array &&
    'price' in v &&
    v.price instanceof Float64Array &&
    'qty' in v &&
    v.qty instanceof Float64Array &&
    'buy' in v &&
    v.buy instanceof Uint8Array &&
    v.price.length === v.ts.length &&
    v.qty.length === v.ts.length &&
    v.buy.length === v.ts.length
  );
}

/**
 * Per-key trade store in IndexedDB (one record per pair, overwritten on save).
 * Every failure — no IndexedDB, quota, corrupt record — degrades to "nothing
 * cached": the app then fetches history over REST as on a first visit.
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
