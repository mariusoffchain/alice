import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SettlementRegistry, settlementRegistry,
  walkSettlementsBackward, walkSettlementsForward,
  type ChainReader, type KVStorage,
} from './arkade-onchain.ts';
import type { NormalizedOutspend, NormalizedTransaction } from './types.ts';

// Distinct 64-hex txids for the fake chain, one letter each.
const id = (c: string) => c.repeat(64);

function fakeStorage(): KVStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
}

function fakeTx(txid: string, opts: { height?: number; prev?: string; coinbase?: boolean } = {}): NormalizedTransaction {
  return {
    txid,
    version: 2,
    locktime: 0,
    sizeBytes: 200,
    weight: 800,
    vsize: 200,
    feeSats: 100,
    feeRateSatVb: 1,
    status: opts.height !== undefined
      ? { confirmed: true, blockHeight: opts.height, blockTime: 1_786_000_000 + opts.height }
      : { confirmed: false },
    inputs: [{
      prevTxid: opts.prev ?? id('0'),
      prevVout: 2,
      sequence: 0xffffffff,
      isCoinbase: opts.coinbase === true,
    }],
    outputs: [
      { index: 0, valueSats: 40_000 },
      { index: 1, valueSats: 990 },
      { index: 2, valueSats: 1_000_000 },
    ],
    isCoinbase: opts.coinbase === true,
    rbfSignaled: false,
    source: { name: 'test', baseUrl: 'https://x/api' },
  };
}

/** A fake chain: txs by id, and each tx's outspends (spender per vout). */
function fakeChain(
  txs: Record<string, NormalizedTransaction>,
  spends: Record<string, (string | null)[]>,
): ChainReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getTransaction(txid) {
      calls.push(`tx:${txid.slice(0, 4)}`);
      const t = txs[txid];
      if (!t) throw new Error('unknown tx');
      return t;
    },
    async getOutspends(txid): Promise<NormalizedOutspend[]> {
      calls.push(`out:${txid.slice(0, 4)}`);
      return (spends[txid] ?? []).map(s => (s ? { spent: true, txid: s, vin: 0 } : { spent: false }));
    },
  };
}

describe('SettlementRegistry', () => {
  it('adds, enriches and never downgrades a settlement', () => {
    const reg = new SettlementRegistry(fakeStorage());
    reg.add({ txid: id('a') });
    assert.equal(reg.get(id('a'))?.height, undefined);
    reg.add({ txid: id('a'), height: 900_000, timestamp: 123 });
    assert.equal(reg.get(id('a'))?.height, 900_000);
    // A later add without a height keeps the known one.
    reg.add({ txid: id('a') });
    assert.equal(reg.get(id('a'))?.height, 900_000);
    assert.equal(reg.get(id('a'))?.timestamp, 123);
  });

  it('exposes confirmed heights only', () => {
    const reg = new SettlementRegistry(fakeStorage());
    reg.add({ txid: id('a'), height: 1 });
    reg.add({ txid: id('b') });
    assert.deepEqual([...reg.heights()], [1]);
  });

  it('persists across instances through the same storage', () => {
    const storage = fakeStorage();
    const first = new SettlementRegistry(storage);
    first.add({ txid: id('a'), height: 5, timestamp: 9 });
    const second = new SettlementRegistry(storage);
    assert.deepEqual(second.get(id('a')), { txid: id('a'), height: 5, timestamp: 9 });
  });

  it('notifies subscribers on change, not on no-ops', () => {
    const reg = new SettlementRegistry(fakeStorage());
    let notified = 0;
    reg.subscribe(() => { notified++; });
    reg.add({ txid: id('a'), height: 1 });
    reg.add({ txid: id('a'), height: 1 }); // identical: no notification
    assert.equal(notified, 1);
  });

  it('starts empty on a corrupt cache', () => {
    const storage = fakeStorage();
    storage.setItem('alice_arkade_settlements_v1', '{not json');
    const reg = new SettlementRegistry(storage);
    assert.deepEqual(reg.all(), []);
  });

  it('rejects malformed txids from storage', () => {
    const storage = fakeStorage();
    storage.setItem('alice_arkade_settlements_v1', JSON.stringify([
      { txid: 'nope' }, { txid: id('a'), height: 2 },
    ]));
    const reg = new SettlementRegistry(storage);
    assert.equal(reg.all().length, 1);
    assert.equal(reg.get(id('a'))?.height, 2);
  });
});

describe('walkSettlementsForward', () => {
  it('follows the funding chain to the tip through the probe', async () => {
    // a -> b -> c commitments; a's other outputs spent by non-commitments.
    const chain = fakeChain(
      { [id('a')]: fakeTx(id('a'), { height: 100 }), [id('b')]: fakeTx(id('b'), { height: 106, prev: id('a') }), [id('c')]: fakeTx(id('c'), { height: 112, prev: id('b') }) },
      {
        [id('a')]: [id('e'), null, id('b')], // vout0 swept by a non-commitment, vout2 (change) by b
        [id('b')]: [null, null, id('c')],
        [id('c')]: [null, null, null], // tip: change unspent
      },
    );
    const commitments = new Set([id('a'), id('b'), id('c')]);
    const probed: string[] = [];
    const res = await walkSettlementsForward(chain, async t => { probed.push(t); return commitments.has(t); }, id('a'));
    assert.deepEqual(res, { found: [id('b'), id('c')], interrupted: false });
    // The sweep spender was probed once, rejected, and never followed.
    assert.ok(probed.includes(id('e')));
    assert.equal(settlementRegistry.get(id('b'))?.height, 106);
    assert.equal(settlementRegistry.get(id('c'))?.height, 112);
  });

  it('stops at maxHops', async () => {
    const chain = fakeChain(
      { [id('a')]: fakeTx(id('a'), { height: 1 }), [id('b')]: fakeTx(id('b'), { height: 2 }), [id('c')]: fakeTx(id('c'), { height: 3 }) },
      { [id('a')]: [null, null, id('b')], [id('b')]: [null, null, id('c')], [id('c')]: [] },
    );
    const res = await walkSettlementsForward(chain, async () => true, id('a'), { maxHops: 1 });
    assert.deepEqual(res.found, [id('b')]);
  });

  it('reports an interrupted walk on a failing lookup', async () => {
    const chain: ChainReader = {
      async getTransaction() { throw new Error('down'); },
      async getOutspends() { return []; },
    };
    const res = await walkSettlementsForward(chain, async () => true, id('a'));
    assert.deepEqual(res, { found: [], interrupted: true });
  });
});

describe('walkSettlementsBackward', () => {
  it('pages history until the first non-commitment parent', async () => {
    // funding (not a commitment) -> f -> g; walk back from g.
    const chain = fakeChain(
      {
        [id('g')]: fakeTx(id('g'), { height: 20, prev: id('f') }),
        [id('f')]: fakeTx(id('f'), { height: 10, prev: id('d') }),
        [id('d')]: fakeTx(id('d'), { height: 1 }),
      },
      {},
    );
    const commitments = new Set([id('f'), id('g')]);
    const res = await walkSettlementsBackward(chain, async t => commitments.has(t), id('g'));
    assert.deepEqual(res, { found: [id('f')], interrupted: false });
    assert.equal(settlementRegistry.get(id('f'))?.height, 10);
  });

  it('stops at a coinbase input', async () => {
    const chain = fakeChain({ [id('h')]: fakeTx(id('h'), { height: 5, coinbase: true }) }, {});
    const res = await walkSettlementsBackward(chain, async () => true, id('h'));
    assert.deepEqual(res, { found: [], interrupted: false });
  });
});
