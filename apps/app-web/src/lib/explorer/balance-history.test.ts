import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressTxDelta, buildBalanceSeries, buildWalletBalanceSeries, walletTxDelta } from './balance-history.ts';
import type { NormalizedTransaction } from './types.ts';

function tx(blockTime: number, ins: [string, number][], outs: [string, number][]): NormalizedTransaction {
  return {
    txid: Math.random().toString(36).slice(2), version: 2, locktime: 0, sizeBytes: 200, weight: 800, vsize: 200,
    feeSats: 0, feeRateSatVb: 0, status: { confirmed: true, blockHeight: 1, blockTime },
    inputs: ins.map(([address, valueSats], i) => ({ prevTxid: 'b'.repeat(64), prevVout: i, address, valueSats, sequence: 0xffffffff, isCoinbase: false })),
    outputs: outs.map(([address, valueSats], index) => ({ index, address, valueSats })),
    isCoinbase: false, rbfSignaled: false, source: { name: 't', baseUrl: 'x' },
  };
}

describe('addressTxDelta', () => {
  it('is received minus spent for the address', () => {
    const t = tx(1000, [['A', 5000]], [['A', 2000], ['B', 3000]]);
    assert.equal(addressTxDelta(t, 'A'), 2000 - 5000);
    assert.equal(addressTxDelta(t, 'B'), 3000);
    assert.equal(addressTxDelta(t, 'C'), 0);
  });
});

describe('buildBalanceSeries', () => {
  it('is empty when there are no dated transactions', () => {
    const s = buildBalanceSeries([], 'A', 0);
    assert.deepEqual(s.points, []);
    assert.equal(s.firstSeen, null);
  });

  it('ends at the current balance and rises then falls with the deltas', () => {
    // received 10000, then sent 4000 -> current balance 6000
    const txs = [
      tx(2000, [], [['A', 10000]]),
      tx(3000, [['A', 10000]], [['A', 6000], ['B', 4000]]),
    ];
    const s = buildBalanceSeries(txs, 'A', 6000);
    assert.equal(s.firstSeen, 2000);
    assert.equal(s.lastSeen, 3000);
    // last point is the present, at the current balance
    assert.equal(s.points[s.points.length - 1].balanceSats, 6000);
    // the peak (after first tx) reaches 10000
    assert.ok(s.points.some(p => p.balanceSats === 10000));
    // starts at zero before any activity
    assert.equal(s.points[0].balanceSats, 0);
  });

  it('anchors to the current balance even with a partial history', () => {
    // Only one loaded tx (received 3000), but current balance is 5000: the
    // series still ends at 5000, and back-computes the earlier balance.
    const s = buildBalanceSeries([tx(1000, [], [['A', 3000]])], 'A', 5000);
    assert.equal(s.points[s.points.length - 1].balanceSats, 5000);
    assert.equal(s.points[0].balanceSats, 2000); // 5000 - 3000
  });

  it('ignores unconfirmed transactions', () => {
    const pending = tx(0, [], [['A', 1000]]);
    pending.status = { confirmed: false };
    const s = buildBalanceSeries([pending], 'A', 1000);
    assert.deepEqual(s.points, []);
  });
});

describe('walletTxDelta / buildWalletBalanceSeries', () => {
  const wallet = new Set(['A', 'CHG']); // a receive address and a change address

  it('nets a self-transfer (receive -> change) to just the fee effect', () => {
    // 10000 in on A, then spent: 6000 back to change, 3900 out to B (100 fee).
    const t = tx(3000, [['A', 10000]], [['CHG', 6000], ['B', 3900]]);
    assert.equal(walletTxDelta(t, wallet), 6000 - 10000); // -4000 left the wallet
  });

  it('deduplicates a transaction touching two wallet addresses', () => {
    const shared = tx(2000, [['A', 10000]], [['CHG', 6000], ['B', 4000]]);
    // Same tx handed in twice (as when fetched from both A's and CHG's history).
    const s = buildWalletBalanceSeries([shared, shared], wallet, 6000);
    // One receive of 10000 then -4000 net: the peak 10000 appears once.
    assert.equal(s.points.filter(p => p.balanceSats === 10000).length, 1);
    assert.equal(s.points[s.points.length - 1].balanceSats, 6000);
  });

  it('folds multiple addresses into one wallet timeline', () => {
    const txs = [
      tx(1000, [], [['A', 10000]]),       // +10000
      tx(2000, [], [['CHG', 5000]]),      // +5000 -> 15000
      tx(3000, [['A', 10000]], [['B', 9000]]), // -10000 -> 5000
    ];
    const s = buildWalletBalanceSeries(txs, wallet, 5000);
    assert.equal(s.points[s.points.length - 1].balanceSats, 5000);
    assert.ok(s.points.some(p => p.balanceSats === 15000));
    assert.equal(s.points[0].balanceSats, 0);
  });
});
