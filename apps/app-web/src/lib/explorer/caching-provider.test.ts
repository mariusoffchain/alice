import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CachingProvider, PriorityGate } from './caching-provider.ts';
import { ChainDataError, type ChainDataProvider } from './provider.ts';
import type { NormalizedTransaction } from './types.ts';
import type { AddressStats } from './signals.ts';

const source = { name: 'test', baseUrl: 'http://x' };

function fakeTx(txid: string): NormalizedTransaction {
  return {
    txid, version: 2, locktime: 0, sizeBytes: 0, weight: 0, vsize: 0,
    feeSats: 0, feeRateSatVb: 0,
    status: { confirmed: true }, inputs: [], outputs: [],
    isCoinbase: false, rbfSignaled: false, source,
  };
}

const noSleep = () => Promise.resolve();

describe('CachingProvider', () => {
  it('de-duplicates concurrent identical reads into one inner call', async () => {
    let calls = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) { calls += 1; return fakeTx(txid); },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { sleep: noSleep });

    const [a, b] = await Promise.all([p.getTransaction('AB'), p.getTransaction('ab')]);
    // Same normalized key ('ab'), fetched once; both coalesce onto the first result.
    assert.equal(a.txid, 'AB');
    assert.equal(b.txid, 'AB');
    assert.equal(calls, 1);

    // A later call reuses the cache too.
    await p.getTransaction('ab');
    assert.equal(calls, 1);
  });

  it('bounds concurrency to the configured limit', async () => {
    let active = 0, peak = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) {
        active += 1; peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, 5));
        active -= 1;
        return fakeTx(txid);
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { concurrency: 2, sleep: noSleep });

    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(id => p.getTransaction(id)));
    assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
  });

  it('drains a large burst without stranding any request (deadlock regression)', async () => {
    // The gate must hand every permit on. A whole-wallet scan fires dozens of
    // distinct lookups through it; a counting bug here would strand some and
    // hang the scan forever (observed as a frozen "scanning..." at N addresses).
    let peak = 0, active = 0, done = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) {
        active += 1; peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, Math.random() * 4));
        active -= 1; done += 1;
        return fakeTx(txid);
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { concurrency: 3, sleep: noSleep });

    const ids = Array.from({ length: 120 }, (_, i) => `tx${i}`);
    const results = await Promise.all(ids.map(id => p.getTransaction(id)));
    assert.equal(results.length, 120);
    assert.equal(done, 120);
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`);
  });

  it('retries a transient backend failure, then succeeds', async () => {
    let attempts = 0;
    const inner: ChainDataProvider = {
      source,
      async getAddressStats(address): Promise<AddressStats> {
        attempts += 1;
        if (attempts < 2) throw new ChainDataError('backend', 'throttled (429)');
        return { address, fundedCount: 1, spentCount: 0, txCount: 1, fundedSum: 0, spentSum: 0 };
      },
      async getTransaction() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { retries: 2, sleep: noSleep });

    const stats = await p.getAddressStats('bc1q');
    assert.equal(stats.fundedCount, 1);
    assert.equal(attempts, 2);
  });

  it('does not cache a transient failure, so a later call can retry', async () => {
    let attempts = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) {
        attempts += 1;
        if (attempts === 1) throw new ChainDataError('backend', 'throttled');
        return fakeTx(txid);
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    // No retries: the first call fails outright and must not be cached.
    const p = new CachingProvider(inner, { retries: 0, sleep: noSleep });

    await assert.rejects(() => p.getTransaction('ab'), ChainDataError);
    const tx = await p.getTransaction('ab');
    assert.equal(tx.txid, 'ab');
    assert.equal(attempts, 2);
  });

  it('does not cache a raw non-ChainDataError failure, so a later call can retry', async () => {
    // A provider bug or an unwrapped fetch failure (CORS, timeout DOMException)
    // must never be remembered as a stable fact: the next call tries again.
    let attempts = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return fakeTx(txid);
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { retries: 2, sleep: noSleep });

    await assert.rejects(() => p.getTransaction('ab'), TypeError);
    const tx = await p.getTransaction('ab');
    assert.equal(tx.txid, 'ab');
    assert.equal(attempts, 2);
  });

  it('caches a not-found error (stable, not worth retrying)', async () => {
    let attempts = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction() {
        attempts += 1;
        throw new ChainDataError('not-found', 'no such tx');
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { retries: 2, sleep: noSleep });

    await assert.rejects(() => p.getTransaction('ab'), ChainDataError);
    await assert.rejects(() => p.getTransaction('ab'), ChainDataError);
    assert.equal(attempts, 1);
  });

  it('hides optional methods the inner provider lacks', () => {
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) { return fakeTx(txid); },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner);
    assert.equal(typeof p.getOutspends, 'undefined');
    assert.equal(typeof p.getBlock, 'undefined');
  });

  it('exposes optional methods the inner provider implements', async () => {
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) { return fakeTx(txid); },
      async getAddressStats() { throw new Error('unused'); },
      async getOutspends() { return [{ spent: false }]; },
    };
    const p = new CachingProvider(inner);
    assert.equal(typeof p.getOutspends, 'function');
    const spends = await p.getOutspends!('ab');
    assert.deepEqual(spends, [{ spent: false }]);
  });
});

describe('PriorityGate', () => {
  it('serves interactive waiters before queued bulk waiters', async () => {
    const gate = new PriorityGate(1, 1);
    const order: string[] = [];
    const slow = gate.run('bulk', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push('first');
    });
    // Both queue behind the running task; interactive must go first even
    // though the bulk waiter was enqueued earlier.
    const laterBulk = gate.run('bulk', async () => { order.push('bulk'); });
    const interactive = gate.run('interactive', async () => { order.push('interactive'); });
    await Promise.all([slow, laterBulk, interactive]);
    assert.deepEqual(order, ['first', 'interactive', 'bulk']);
  });

  it('caps bulk concurrency below the total so interactive slots stay free', async () => {
    const gate = new PriorityGate(3, 2);
    let bulkActive = 0, bulkPeak = 0;
    const bulkTask = () => gate.run('bulk', async () => {
      bulkActive += 1; bulkPeak = Math.max(bulkPeak, bulkActive);
      await new Promise(r => setTimeout(r, 5));
      bulkActive -= 1;
    });
    // 6 bulk tasks over a cap of 2: never more than 2 at once, and while they
    // grind, an interactive task gets a slot immediately.
    const bulks = Promise.all(Array.from({ length: 6 }, bulkTask));
    let interactiveRan = false;
    await gate.run('interactive', async () => { interactiveRan = true; });
    assert.equal(interactiveRan, true);
    await bulks;
    assert.ok(bulkPeak <= 2, `bulk peak ${bulkPeak} exceeded 2`);
  });

  it('rejects a queued waiter as soon as its signal aborts, without a permit', async () => {
    const gate = new PriorityGate(1, 1);
    let release: () => void = () => {};
    const hold = gate.run('interactive', () => new Promise<void>(r => { release = r; }));
    const controller = new AbortController();
    const queued = gate.run('interactive', async () => 'ran', controller.signal);
    controller.abort();
    await assert.rejects(queued, (err: unknown) =>
      err instanceof ChainDataError && err.code === 'aborted');
    // The permit was never consumed by the aborted waiter: the next task runs.
    release();
    await hold;
    const after = await gate.run('interactive', async () => 'ok');
    assert.equal(after, 'ok');
  });
});

describe('CachingProvider abort', () => {
  it('rejects the caller with aborted and drops the entry so a retry works', async () => {
    let calls = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid, opts) {
        calls += 1;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 15);
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new ChainDataError('aborted', 'cancelled'));
          }, { once: true });
        });
        return fakeTx(txid);
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { sleep: noSleep });

    const controller = new AbortController();
    const pending = p.getTransaction('ab', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (err: unknown) =>
      err instanceof ChainDataError && err.code === 'aborted');

    // The aborted entry must not be cached: a fresh call fetches again.
    const tx = await p.getTransaction('ab');
    assert.equal(tx.txid, 'ab');
    assert.equal(calls, 2);
  });

  it('keeps a shared fetch alive while another caller still wants it', async () => {
    let innerAborted = false;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid, opts) {
        await new Promise(r => setTimeout(r, 15));
        if (opts?.signal?.aborted) { innerAborted = true; throw new ChainDataError('aborted', 'cancelled'); }
        return fakeTx(txid);
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { sleep: noSleep });

    const controller = new AbortController();
    const doomed = p.getTransaction('ab', { signal: controller.signal });
    const kept = p.getTransaction('ab'); // no signal: pins the shared fetch
    controller.abort();
    await assert.rejects(doomed, (err: unknown) =>
      err instanceof ChainDataError && err.code === 'aborted');
    const tx = await kept;
    assert.equal(tx.txid, 'ab');
    assert.equal(innerAborted, false);
  });
});

describe('CachingProvider persistent cache', () => {
  function memoryCache() {
    const store = new Map<string, unknown>();
    const ttls = new Map<string, number>();
    return {
      store, ttls,
      async get(key: string) { return store.get(key); },
      async set(key: string, value: unknown, ttlMs: number) { store.set(key, value); ttls.set(key, ttlMs); },
    };
  }

  it('serves a stored value without touching the network', async () => {
    const cache = memoryCache();
    await cache.set('tx|ab', fakeTx('ab'), 1000);
    let calls = 0;
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) { calls += 1; return fakeTx(txid); },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { sleep: noSleep, persistent: cache });
    const tx = await p.getTransaction('ab');
    assert.equal(tx.txid, 'ab');
    assert.equal(calls, 0);
  });

  it('persists a confirmed transaction but never an unconfirmed one', async () => {
    const cache = memoryCache();
    const inner: ChainDataProvider = {
      source,
      async getTransaction(txid) {
        const tx = fakeTx(txid);
        return txid === 'aa' ? tx : { ...tx, status: { confirmed: false } };
      },
      async getAddressStats() { throw new Error('unused'); },
    };
    const p = new CachingProvider(inner, { sleep: noSleep, persistent: cache });
    await p.getTransaction('aa');
    await p.getTransaction('bb');
    await new Promise(r => setTimeout(r, 0)); // writes are fire-and-forget
    assert.ok(cache.store.has('tx|aa'));
    assert.ok(!cache.store.has('tx|bb'));
  });
});
