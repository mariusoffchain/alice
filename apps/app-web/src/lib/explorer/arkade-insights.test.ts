import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildArkadeBalanceSeries, buildArkadeTxHistory, virtualTxOutspends, virtualTxToNormalized } from './arkade-insights.ts';
import type { ArkadeVirtualTx, ArkadeVtxo } from './arkade.ts';

const id = (c: string) => c.repeat(64);

function vtxo(over: Partial<ArkadeVtxo>): ArkadeVtxo {
  return {
    txid: id('a'), vout: 0, amountSats: 1000,
    isSpent: false, isSwept: false, isPreconfirmed: false,
    commitmentTxids: [], ...over,
  };
}

const vtx: ArkadeVirtualTx = {
  txid: id('f'),
  inputs: [{ txid: id('1'), vout: 0, amountSats: 24_728 }],
  outputs: [
    { index: 0, amountSats: 501, scriptHex: '5120aa', isAnchor: false, vtxo: vtxo({ isSpent: true, spentBy: id('c') }) },
    { index: 1, amountSats: 24_227, scriptHex: '5120bb', isAnchor: false, vtxo: vtxo({}) },
    { index: 2, amountSats: 0, scriptHex: '51024e73', isAnchor: true },
  ],
};

describe('virtualTxToNormalized', () => {
  it('shapes a virtual tx for the flow graph', () => {
    const n = virtualTxToNormalized(vtx, 'arkade');
    assert.equal(n.txid, id('f'));
    assert.equal(n.inputs.length, 1);
    assert.equal(n.inputs[0].valueSats, 24_728);
    assert.equal(n.outputs.length, 3);
    assert.equal(n.feeSats, 0); // 24728 in = 24728 out
    assert.equal(n.outputs[0].spent, true);
    assert.equal(n.outputs[1].spent, false);
    assert.equal(n.status.confirmed, false);
  });

  it('reports no fee when an input amount is unknown', () => {
    const n = virtualTxToNormalized({ ...vtx, inputs: [{ txid: id('1'), vout: 0 }] }, 'arkade');
    assert.equal(n.feeSats, null);
  });
});

describe('virtualTxOutspends', () => {
  it('points spent outputs at their checkpoint spender', () => {
    const o = virtualTxOutspends(vtx);
    assert.deepEqual(o[0], { spent: true, txid: id('c'), vin: 0 });
    assert.deepEqual(o[1], { spent: false });
    assert.deepEqual(o[2], { spent: false });
  });
});

describe('buildArkadeBalanceSeries', () => {
  it('credits at creation, debits at the dated spender, anchors at today', () => {
    const vtxos: ArkadeVtxo[] = [
      // Received 1000 at t=100, spent by the ark tx that created the change.
      vtxo({ txid: id('a'), amountSats: 1000, createdAt: 100, isSpent: true, arkTxid: id('b') }),
      // The change: 400 back on the same address at t=200.
      vtxo({ txid: id('b'), amountSats: 400, createdAt: 200 }),
    ];
    const s = buildArkadeBalanceSeries(vtxos, 400);
    assert.equal(s.partial, false);
    // Start at 0, up to 1000 at t=100, then -1000 +400 at t=200 -> 400.
    assert.equal(s.points[0].balanceSats, 0);
    assert.equal(s.points[s.points.length - 1].balanceSats, 400);
    assert.equal(s.firstSeen, 100);
  });

  it('nets an undatable spend at creation and marks the series partial', () => {
    const s = buildArkadeBalanceSeries([
      vtxo({ txid: id('a'), amountSats: 1000, createdAt: 100, isSpent: true, arkTxid: id('9') }),
    ], 0);
    assert.equal(s.partial, true);
    // Credit and debit collapse at t=100: the line starts at 0 (no negative
    // drift from the dangling credit) and ends at 0.
    assert.equal(s.points[0].balanceSats, 0);
    assert.equal(s.points[s.points.length - 1].balanceSats, 0);
  });

  it('returns an empty series for undated vtxos', () => {
    const s = buildArkadeBalanceSeries([vtxo({ createdAt: undefined })], 0);
    assert.deepEqual(s.points, []);
    assert.equal(s.partial, true);
  });
});

describe('buildArkadeTxHistory', () => {
  it('nets a spend-with-change into one entry per transaction, newest first', () => {
    const history = buildArkadeTxHistory([
      vtxo({ txid: id('a'), amountSats: 1000, createdAt: 100, isSpent: true, arkTxid: id('b') }),
      vtxo({ txid: id('b'), amountSats: 400, createdAt: 200 }),
    ]);
    assert.equal(history.length, 2);
    // Newest first: the spend (received 400, spent 1000 -> net -600) at t=200.
    assert.deepEqual(history[0], { txid: id('b'), time: 200, deltaSats: -600 });
    assert.deepEqual(history[1], { txid: id('a'), time: 100, deltaSats: 1000 });
  });

  it('keeps undatable spenders at the end of the list', () => {
    const history = buildArkadeTxHistory([
      vtxo({ txid: id('a'), amountSats: 500, createdAt: 100, isSpent: true, arkTxid: id('9') }),
    ]);
    assert.equal(history.length, 2);
    assert.equal(history[0].txid, id('a'));
    assert.deepEqual(history[1], { txid: id('9'), time: undefined, deltaSats: -500 });
  });
});
