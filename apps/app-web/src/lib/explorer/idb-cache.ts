// IndexedDB-backed PersistentCache for the CachingProvider: immutable chain
// data (mined blocks, confirmed transactions) survives reloads and sessions,
// so reopening a block map costs zero network round-trips.
//
// Deliberately forgiving: every failure path degrades to "no cache" (get
// resolves undefined, set resolves silently). A user with IndexedDB disabled,
// a full disk, or a private-browsing window just gets the memory-only
// behaviour, never an error. Expired entries are dropped lazily on read and
// swept once per open.

import type { PersistentCache } from './caching-provider.ts';

const DB_NAME = 'explorer-cache';
// Bump to throw away every cached shape after a breaking change to the
// normalized models. v2: Liquid fee-output extraction + amountKnown on
// in/outputs, so previously cached transactions must be re-normalized.
const DB_VERSION = 2;
const STORE = 'entries';

type StoredEntry = {
  key: string;
  value: unknown;
  /** Absolute expiry, ms since epoch. */
  exp: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      const store = db.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('exp', 'exp');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/** Delete every expired entry, via the exp index; best effort. */
function sweep(db: IDBDatabase): void {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const range = IDBKeyRange.upperBound(Date.now());
    tx.objectStore(STORE).index('exp').openCursor(range).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  } catch { /* sweeping is opportunistic */ }
}

/**
 * A PersistentCache namespaced per network (one namespace per provider, so
 * mainnet and testnet entries never collide), or undefined where IndexedDB is
 * unavailable (SSR, tests, locked-down browsers).
 */
export function createIdbCache(namespace: string): PersistentCache | undefined {
  if (typeof indexedDB === 'undefined') return undefined;

  // One shared open per cache instance; a failed open disables the cache for
  // the rest of the session instead of retrying on every call.
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> => {
    if (!dbPromise) {
      dbPromise = openDb().then(
        (d) => { sweep(d); return d; },
        () => null,
      );
    }
    return dbPromise;
  };

  const fullKey = (key: string) => `${namespace}|${key}`;

  return {
    async get(key: string): Promise<unknown> {
      const d = await db();
      if (!d) return undefined;
      try {
        const entry = await new Promise<StoredEntry | undefined>((resolve, reject) => {
          const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(fullKey(key));
          req.onsuccess = () => resolve(req.result as StoredEntry | undefined);
          req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
        });
        if (!entry) return undefined;
        if (entry.exp <= Date.now()) return undefined; // stale; the sweep will collect it
        return entry.value;
      } catch {
        return undefined;
      }
    },

    async set(key: string, value: unknown, ttlMs: number): Promise<void> {
      const d = await db();
      if (!d) return;
      try {
        const entry: StoredEntry = { key: fullKey(key), value, exp: Date.now() + ttlMs };
        await new Promise<void>((resolve, reject) => {
          const req = d.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
        });
      } catch { /* a failed write just means no cross-session cache */ }
    },
  };
}
