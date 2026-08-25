// A transparent wrapper around any ChainDataProvider that tames request bursts.
// A single transaction analysis fans out into address stats, parent lookups,
// outspends and a child fetch, which hammers a throttled public endpoint. The
// defences, none of which the detectors or the UI need to know about:
//
//   1. In-flight de-duplication and result caching: the same txid or address
//      asked twice (common, parents are shared) is fetched once.
//   2. Bounded concurrency with PRIORITIES: at most N network calls run at a
//      time, and interactive requests (a tab opening, the live ribbon) always
//      pass in front of bulk ones (a whole-wallet scan). Bulk requests can
//      never hold every slot, so a stalling scan cannot freeze the UI.
//   3. Cancellation: callers pass an AbortSignal; a request whose every caller
//      has aborted leaves the queue (or aborts its fetch) immediately instead
//      of burning slots for a view that no longer exists.
//   4. Retry with backoff on transient backend failures (429/5xx surface as
//      ChainDataError 'backend'), which is exactly the throttling case.
//   5. An optional persistent cache for immutable chain data (blocks, confirmed
//      transactions), so reopening a view costs zero network round-trips.
//
// Reads are cached; the in-memory cache is per-instance and per-network (one
// wrapper per network), so it never crosses chains. Not-found and invalid-input
// errors are cached too: they are stable facts, no point retrying them.

import type { ChainDataProvider, RequestOptions, RequestPriority } from './provider.ts';
import { ChainDataError } from './provider.ts';
import type {
  BlockAudit,
  BlockTxSummary,
  DataSource,
  NormalizedBlock,
  NormalizedOutspend,
  NormalizedTransaction,
  ProjectedBlock,
} from './types.ts';
import type { AddressStats } from './signals.ts';
import type { AddressUtxo } from './address-insights.ts';

/** At most this many network calls run at once across the whole wrapper.
 *  Deliberately modest: the public mempool.space endpoint rate-limits per IP,
 *  and a wider burst just converts into 429s. */
const DEFAULT_CONCURRENCY = 4;
/** Of those, bulk requests may hold at most this many at a time, so at least
 *  (concurrency - bulkConcurrency) slots are always free for interactive ones. */
const DEFAULT_BULK_CONCURRENCY = 3;
/** Retry a transient backend failure up to this many extra times. */
const DEFAULT_RETRIES = 2;
/** Base backoff; doubles each attempt (200ms, 400ms), with jitter. */
const BACKOFF_BASE_MS = 200;

// Persistent-cache lifetimes. Immutable chain data (a mined block, a confirmed
// transaction) is capped only to bound storage growth; mutable lookups get a
// short window that still makes "reopen the same view" free.
const TTL_SHORT_MS = 10 * 60 * 1000;
const TTL_DAY_MS = 24 * 60 * 60 * 1000;
const TTL_LONG_MS = 7 * 24 * 60 * 60 * 1000;

/** A tiny async key-value store for cross-session caching (IndexedDB in the
 *  browser, a Map in tests). Failures must be swallowed by the implementation:
 *  a broken cache should degrade to "no cache", never break a fetch. */
export type PersistentCache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
};

export type CachingOptions = {
  concurrency?: number;
  bulkConcurrency?: number;
  retries?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Cross-session cache for immutable results; omitted means memory-only. */
  persistent?: PersistentCache;
};

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function abortedError(): ChainDataError {
  return new ChainDataError('aborted', 'The request was cancelled.');
}

type Waiter = {
  grant: () => void;
  cancel: (err: ChainDataError) => void;
};

// A counting semaphore with two priority classes. A permit is taken on acquire
// and, on release, handed DIRECTLY to the next eligible waiter (rather than
// incrementing a shared counter the waiter then decrements). That hand-off is
// what keeps the permit count exact under bursts. Interactive waiters are always
// served before bulk ones, and bulk holds at most `bulkMax` permits at a time,
// so a stalled scan can never occupy the whole gate. A waiter whose signal
// aborts leaves the queue at once without ever taking a permit.
export class PriorityGate {
  private permits: number;
  private bulkRunning = 0;
  private readonly bulkMax: number;
  private readonly interactiveQueue: Waiter[] = [];
  private readonly bulkQueue: Waiter[] = [];

  constructor(total: number, bulkMax: number) {
    this.permits = Math.max(1, total);
    this.bulkMax = Math.min(Math.max(1, bulkMax), this.permits);
  }

  private acquire(priority: RequestPriority, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortedError());
    if (this.permits > 0 && (priority === 'interactive' || this.bulkRunning < this.bulkMax)) {
      this.permits -= 1;
      if (priority === 'bulk') this.bulkRunning += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const queue = priority === 'interactive' ? this.interactiveQueue : this.bulkQueue;
      const waiter: Waiter = {
        grant: () => {
          if (signal) signal.removeEventListener('abort', onAbort);
          if (priority === 'bulk') this.bulkRunning += 1;
          resolve();
        },
        cancel: (err) => reject(err),
      };
      const onAbort = () => {
        const i = queue.indexOf(waiter);
        if (i >= 0) queue.splice(i, 1);
        waiter.cancel(abortedError());
      };
      queue.push(waiter);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release(priority: RequestPriority): void {
    if (priority === 'bulk') this.bulkRunning -= 1;
    // Hand the permit straight to the next eligible waiter: interactive first,
    // then bulk if it still has headroom. Otherwise return it to the pool.
    const next = this.interactiveQueue.shift()
      ?? (this.bulkRunning < this.bulkMax ? this.bulkQueue.shift() : undefined);
    if (next) next.grant();
    else this.permits += 1;
  }

  async run<T>(priority: RequestPriority, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(priority, signal);
    try {
      return await task();
    } finally {
      this.release(priority);
    }
  }
}

// Only these two error codes are worth retrying: 'backend' (the endpoint
// answered 429/5xx) and 'network' (a transient reachability blip). 'not-found'
// and 'invalid-input' are stable and get cached as-is; 'aborted' means the
// caller is gone, so retrying would be pure waste.
function isTransient(err: unknown): boolean {
  return err instanceof ChainDataError && (err.code === 'backend' || err.code === 'network');
}

// One shared in-flight entry per (method, key). Callers with a signal are
// counted; when the last one aborts, the underlying fetch is aborted too. A
// caller without a signal pins the entry (it can never be cancelled).
type Entry = {
  promise: Promise<unknown>;
  controller: AbortController;
  waiters: number;
  pinned: boolean;
  settled: boolean;
};

/** How long a persisted value stays valid; null means "do not persist". */
type PersistTtl<T> = number | ((value: T) => number | null);

export class CachingProvider implements ChainDataProvider {
  readonly source: DataSource;
  private readonly inner: ChainDataProvider;
  private readonly gate: PriorityGate;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly persistent?: PersistentCache;
  // One in-flight/result cache per read method, keyed by the argument.
  private readonly caches = new Map<string, Map<string, Entry>>();

  constructor(inner: ChainDataProvider, opts: CachingOptions = {}) {
    this.inner = inner;
    this.source = inner.source;
    this.gate = new PriorityGate(
      Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY),
      Math.max(1, opts.bulkConcurrency ?? DEFAULT_BULK_CONCURRENCY),
    );
    this.retries = Math.max(0, opts.retries ?? DEFAULT_RETRIES);
    this.sleep = opts.sleep ?? realSleep;
    this.persistent = opts.persistent;

    // Mirror the inner provider's capability surface: drop the optional methods
    // it does not implement, so consumers' `typeof provider.getX === 'function'`
    // feature checks stay accurate instead of always seeing a rejecting stub.
    const optional = [
      'getOutspends', 'getAddressTxs', 'getAddressUtxos', 'getRecentBlocks',
      'getMempoolBlocks', 'getBlock', 'getBlockTxs', 'getBlockSummary', 'getBlockAudit',
    ] as const;
    for (const m of optional) {
      if (typeof inner[m] !== 'function') {
        (this as Record<string, unknown>)[m] = undefined;
      }
    }
  }

  // Each attempt acquires a concurrency slot only for the fetch itself; the
  // backoff sleep happens OUTSIDE the gate, so a throttled request waiting to
  // retry does not hold a slot and strangle the other in-flight lookups (this
  // is what made a whole-wallet scan crawl when the public endpoint threw 429s).
  private async withRetry<T>(
    fetch: (o: RequestOptions) => Promise<T>,
    o: RequestOptions,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (o.signal?.aborted) throw abortedError();
      try {
        return await this.gate.run(o.priority ?? 'interactive', () => fetch(o), o.signal);
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || attempt === this.retries) throw err;
        const backoff = BACKOFF_BASE_MS * 2 ** attempt;
        await this.sleep(backoff + Math.floor(Math.random() * BACKOFF_BASE_MS));
      }
    }
    throw lastErr;
  }

  /** Coalesce by (method, key); read through the persistent cache, then run the
   *  fetch through the gate with retry. On a transient failure or a full abort
   *  the cache entry is dropped so a later call may try again. */
  private memo<T>(
    method: string,
    key: string,
    opts: RequestOptions | undefined,
    fetch: (o: RequestOptions) => Promise<T>,
    persistTtl?: PersistTtl<T>,
  ): Promise<T> {
    let byKey = this.caches.get(method);
    if (!byKey) { byKey = new Map(); this.caches.set(method, byKey); }
    const hit = byKey.get(key);
    if (hit) return this.attach<T>(hit, opts?.signal, () => byKey.delete(key));

    const controller = new AbortController();
    const entry: Entry = { promise: Promise.resolve(), controller, waiters: 0, pinned: false, settled: false };
    const shared: RequestOptions = {
      signal: controller.signal,
      priority: opts?.priority,
      timeoutMs: opts?.timeoutMs,
    };
    const storageKey = `${method}|${key}`;
    entry.promise = (async () => {
      if (this.persistent && persistTtl !== undefined) {
        const stored = await this.persistent.get(storageKey);
        if (stored !== undefined) return stored as T;
      }
      const value = await this.withRetry(fetch, shared);
      if (this.persistent && persistTtl !== undefined) {
        const ttl = typeof persistTtl === 'function' ? persistTtl(value) : persistTtl;
        if (ttl !== null && ttl > 0) void this.persistent.set(storageKey, value, ttl);
      }
      return value;
    })().then(
      (value) => { entry.settled = true; return value; },
      (err: unknown) => {
        entry.settled = true;
        // Cache only STABLE failures ('not-found', 'invalid-input'): asking
        // again cannot change those. Everything else, including a raw error a
        // provider let slip, is dropped so a later call retries instead of
        // replaying a stale failure forever. Never evict a NEWER entry that
        // replaced this one after an abort-driven eviction.
        const stable = err instanceof ChainDataError
          && (err.code === 'not-found' || err.code === 'invalid-input');
        if (!stable && byKey.get(key) === entry) byKey.delete(key);
        throw err;
      },
    );
    byKey.set(key, entry);
    return this.attach<T>(entry, opts?.signal, () => byKey.delete(key));
  }

  /** Tie one caller to a shared entry: their promise rejects as soon as THEIR
   *  signal aborts, and the shared fetch itself is aborted only when no caller
   *  is left wanting the result. `evict` drops the entry from the cache the
   *  moment it is abandoned, so an immediate re-request starts fresh instead of
   *  attaching to a dying fetch. */
  private attach<T>(entry: Entry, signal: AbortSignal | undefined, evict: () => void): Promise<T> {
    if (!signal) {
      entry.pinned = true;
      return entry.promise as Promise<T>;
    }
    if (signal.aborted) return Promise.reject(abortedError());
    entry.waiters += 1;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const onAbort = () => {
        if (done) return;
        done = true;
        entry.waiters -= 1;
        if (entry.waiters === 0 && !entry.pinned && !entry.settled) {
          evict();
          entry.controller.abort();
        }
        reject(abortedError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      (entry.promise as Promise<T>).then(
        (v) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          entry.waiters -= 1;
          resolve(v);
        },
        (e: unknown) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          entry.waiters -= 1;
          reject(e);
        },
      );
    });
  }

  getTransaction(txid: string, opts?: RequestOptions): Promise<NormalizedTransaction> {
    return this.memo(
      'tx', txid.trim().toLowerCase(), opts,
      (o) => this.inner.getTransaction(txid, o),
      // A confirmed transaction is immutable; an unconfirmed one is not.
      (tx) => (tx.status.confirmed ? TTL_LONG_MS : null),
    );
  }

  getAddressStats(address: string, opts?: RequestOptions): Promise<AddressStats> {
    return this.memo(
      'addrStats', address.trim(), opts,
      (o) => this.inner.getAddressStats(address, o),
      TTL_SHORT_MS,
    );
  }

  getOutspends(txid: string, opts?: RequestOptions): Promise<NormalizedOutspend[]> {
    if (!this.inner.getOutspends) return Promise.reject(new ChainDataError('backend', 'Outspends unsupported.'));
    const fn = this.inner.getOutspends.bind(this.inner);
    // Outspends flip as coins get spent: memory-only, never persisted.
    return this.memo('outspends', txid.trim().toLowerCase(), opts, (o) => fn(txid, o));
  }

  // Address tx pages and utxos are cheap to re-fetch and page-dependent; still
  // worth de-duplicating within a burst, keyed by the full argument set.
  getAddressTxs(address: string, afterTxid?: string, opts?: RequestOptions): Promise<NormalizedTransaction[]> {
    if (!this.inner.getAddressTxs) return Promise.reject(new ChainDataError('backend', 'Address txs unsupported.'));
    const fn = this.inner.getAddressTxs.bind(this.inner);
    return this.memo(
      'addrTxs', `${address.trim()}|${afterTxid ?? ''}`, opts,
      (o) => fn(address, afterTxid, o),
      TTL_SHORT_MS,
    );
  }

  getAddressUtxos(address: string, opts?: RequestOptions): Promise<AddressUtxo[]> {
    if (!this.inner.getAddressUtxos) return Promise.reject(new ChainDataError('backend', 'Address utxos unsupported.'));
    const fn = this.inner.getAddressUtxos.bind(this.inner);
    return this.memo('addrUtxos', address.trim(), opts, (o) => fn(address, o), TTL_SHORT_MS);
  }

  // Block endpoints: cache confirmed data (immutable once mined). Recent-blocks
  // and mempool-blocks change, so they run through the gate but are not cached.
  getRecentBlocks(beforeHeight?: number, opts?: RequestOptions): Promise<NormalizedBlock[]> {
    if (!this.inner.getRecentBlocks) return Promise.reject(new ChainDataError('backend', 'Recent blocks unsupported.'));
    const fn = this.inner.getRecentBlocks.bind(this.inner);
    // The live tip batch changes with every block: gate + retry, no caching.
    if (beforeHeight === undefined) return this.withRetry((o) => fn(undefined, o), opts ?? {});
    // Paged history (beforeHeight set) is settled chain: persist for a day.
    return this.memo('recentBlocks', String(beforeHeight), opts, (o) => fn(beforeHeight, o), TTL_DAY_MS);
  }

  getMempoolBlocks(opts?: RequestOptions): Promise<ProjectedBlock[]> {
    if (!this.inner.getMempoolBlocks) return Promise.reject(new ChainDataError('backend', 'Mempool blocks unsupported.'));
    const fn = this.inner.getMempoolBlocks.bind(this.inner);
    return this.withRetry((o) => fn(o), opts ?? {});
  }

  getBlock(heightOrHash: string, opts?: RequestOptions): Promise<NormalizedBlock> {
    if (!this.inner.getBlock) return Promise.reject(new ChainDataError('backend', 'Block lookup unsupported.'));
    const fn = this.inner.getBlock.bind(this.inner);
    // A height near the tip can be reorganised; a hash cannot. Persist heights
    // briefly and hashes for the long haul.
    const key = heightOrHash.trim();
    const ttl = /^\d+$/.test(key) ? TTL_SHORT_MS : TTL_LONG_MS;
    return this.memo('block', key, opts, (o) => fn(heightOrHash, o), ttl);
  }

  getBlockTxs(hash: string, startIndex: number, opts?: RequestOptions): Promise<NormalizedTransaction[]> {
    if (!this.inner.getBlockTxs) return Promise.reject(new ChainDataError('backend', 'Block txs unsupported.'));
    const fn = this.inner.getBlockTxs.bind(this.inner);
    return this.memo('blockTxs', `${hash.trim()}|${startIndex}`, opts, (o) => fn(hash, startIndex, o), TTL_LONG_MS);
  }

  getBlockSummary(hash: string, opts?: RequestOptions): Promise<BlockTxSummary[]> {
    if (!this.inner.getBlockSummary) return Promise.reject(new ChainDataError('backend', 'Block summary unsupported.'));
    const fn = this.inner.getBlockSummary.bind(this.inner);
    return this.memo('blockSummary', hash.trim(), opts, (o) => fn(hash, o), TTL_LONG_MS);
  }

  getBlockAudit(hash: string, opts?: RequestOptions): Promise<BlockAudit | null> {
    if (!this.inner.getBlockAudit) return Promise.reject(new ChainDataError('backend', 'Block audit unsupported.'));
    const fn = this.inner.getBlockAudit.bind(this.inner);
    // "Not audited" (null) can flip to audited later: only persist real audits.
    return this.memo('blockAudit', hash.trim(), opts, (o) => fn(hash, o), (a) => (a ? TTL_LONG_MS : null));
  }
}
