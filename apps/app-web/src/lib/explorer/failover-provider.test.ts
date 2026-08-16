import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FailoverProvider } from './failover-provider.ts';
import { ChainDataError, type ChainDataProvider } from './provider.ts';
import type { NormalizedTransaction } from './types.ts';

function fakeTx(txid: string, from: string): NormalizedTransaction {
  return {
    txid, version: 2, locktime: 0, sizeBytes: 0, weight: 0, vsize: 0,
    feeSats: 0, feeRateSatVb: 0,
    status: { confirmed: true }, inputs: [], outputs: [],
    isCoinbase: false, rbfSignaled: false,
    source: { name: from, baseUrl: `http://${from}` },
  };
}

/** A stub endpoint whose getTransaction behaviour is scripted per call. */
function endpoint(name: string, behave: (calls: number) => 'ok' | 'throttle' | 'not-found') {
  let calls = 0;
  const provider: ChainDataProvider = {
    source: { name, baseUrl: `http://${name}` },
    async getTransaction(txid) {
      calls += 1;
      const b = behave(calls);
      if (b === 'throttle') throw new ChainDataError('backend', `${name} throttled (429)`);
      if (b === 'not-found') throw new ChainDataError('not-found', 'no such tx');
      return fakeTx(txid, name);
    },
    async getAddressStats() { throw new Error('unused'); },
    async getMempoolBlocks() {
      calls += 1;
      return [];
    },
  };
  return { provider, count: () => calls };
}

describe('FailoverProvider', () => {
  it('serves from the primary on the happy path, fallbacks untouched', async () => {
    const a = endpoint('primary', () => 'ok');
    const b = endpoint('backup', () => 'ok');
    const p = new FailoverProvider([{ provider: a.provider }, { provider: b.provider }]);
    const tx = await p.getTransaction('t1');
    assert.equal(tx.source.name, 'primary');
    assert.equal(b.count(), 0);
  });

  it('fails over to the next endpoint on a throttled primary', async () => {
    const a = endpoint('primary', () => 'throttle');
    const b = endpoint('backup', () => 'ok');
    const p = new FailoverProvider([{ provider: a.provider }, { provider: b.provider }]);
    const tx = await p.getTransaction('t1');
    assert.equal(tx.source.name, 'backup');
  });

  it('penalizes a failing endpoint: later calls skip it during the cooldown, then return to it', async () => {
    let clock = 0;
    const a = endpoint('primary', (n) => (n === 1 ? 'throttle' : 'ok'));
    const b = endpoint('backup', () => 'ok');
    const p = new FailoverProvider(
      [{ provider: a.provider }, { provider: b.provider }],
      { cooldownMs: 1000, now: () => clock },
    );

    assert.equal((await p.getTransaction('t1')).source.name, 'backup'); // primary throttled, penalized
    assert.equal((await p.getTransaction('t2')).source.name, 'backup'); // straight to backup
    assert.equal(a.count(), 1); // the penalized primary was not retried

    clock = 1001; // cooldown over: the primary is preferred again
    assert.equal((await p.getTransaction('t3')).source.name, 'primary');
  });

  it('still tries penalized endpoints when everything is penalized', async () => {
    let clock = 0;
    const a = endpoint('primary', (n) => (n <= 1 ? 'throttle' : 'ok'));
    const b = endpoint('backup', () => 'throttle');
    const p = new FailoverProvider(
      [{ provider: a.provider }, { provider: b.provider }],
      { cooldownMs: 60_000, now: () => clock },
    );
    await assert.rejects(() => p.getTransaction('t1'), ChainDataError); // both throttled
    clock = 10; // both still penalized, but degraded beats dead
    const tx = await p.getTransaction('t2');
    assert.equal(tx.source.name, 'primary');
  });

  it('treats not-found as a real answer, never a reason to fail over', async () => {
    const a = endpoint('primary', () => 'not-found');
    const b = endpoint('backup', () => 'ok');
    const p = new FailoverProvider([{ provider: a.provider }, { provider: b.provider }]);
    await assert.rejects(() => p.getTransaction('t1'), (err: unknown) =>
      err instanceof ChainDataError && err.code === 'not-found');
    assert.equal(b.count(), 0);
  });

  it('rethrows aborted immediately without trying the fallback', async () => {
    const a: ChainDataProvider = {
      source: { name: 'primary', baseUrl: 'http://primary' },
      async getTransaction() { throw new ChainDataError('aborted', 'cancelled'); },
      async getAddressStats() { throw new Error('unused'); },
    };
    const b = endpoint('backup', () => 'ok');
    const p = new FailoverProvider([{ provider: a }, { provider: b.provider }]);
    await assert.rejects(() => p.getTransaction('t1'), (err: unknown) =>
      err instanceof ChainDataError && err.code === 'aborted');
    assert.equal(b.count(), 0);
  });

  it('never sends mempool-/v1 reads to an esplora-only fallback', async () => {
    const a = endpoint('primary', () => 'throttle');
    const b = endpoint('esplora', () => 'ok');
    const p = new FailoverProvider([
      { provider: a.provider },
      { provider: b.provider, esploraOnly: true },
    ]);
    // getMempoolBlocks is /v1-only: with the primary down and only an
    // esplora-only fallback left, the call must fail rather than 404 weirdly.
    const aFails: ChainDataProvider = {
      ...a.provider,
      async getMempoolBlocks() { throw new ChainDataError('backend', 'throttled'); },
    };
    const p2 = new FailoverProvider([
      { provider: aFails },
      { provider: b.provider, esploraOnly: true },
    ]);
    await assert.rejects(() => p2.getMempoolBlocks(), ChainDataError);
    assert.equal(b.count(), 0);
    // But the esplora-compatible read does fail over to it.
    const tx = await p.getTransaction('t1');
    assert.equal(tx.source.name, 'esplora');
  });
});
