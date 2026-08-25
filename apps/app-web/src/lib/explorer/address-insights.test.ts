import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { averageUtxoAge, linkedAddresses } from './address-insights.ts';
import type { NormalizedTransaction } from './types.ts';

function tx(inputs: string[], outputs: string[]): NormalizedTransaction {
  return {
    txid: Math.random().toString(36).slice(2), version: 2, locktime: 0, sizeBytes: 200, weight: 800, vsize: 200,
    feeSats: 0, feeRateSatVb: 0, status: { confirmed: true, blockHeight: 1 },
    inputs: inputs.map((address, i) => ({ prevTxid: 'b'.repeat(64), prevVout: i, address, valueSats: 1000, sequence: 0xffffffff, isCoinbase: false })),
    outputs: outputs.map((address, index) => ({ index, address, valueSats: 500 })),
    isCoinbase: false, rbfSignaled: false, source: { name: 't', baseUrl: 'x' },
  };
}

describe('linkedAddresses', () => {
  it('links addresses co-spent with the target', () => {
    const txs = [tx(['A', 'B', 'C'], ['X']), tx(['A', 'D'], ['Y'])];
    assert.deepEqual(linkedAddresses(txs, 'A').sort(), ['B', 'C', 'D']);
  });

  it('ignores transactions where the address is only an output', () => {
    const txs = [tx(['B', 'C'], ['A'])]; // A received, never co-spent
    assert.deepEqual(linkedAddresses(txs, 'A'), []);
  });

  it('never links an address to itself', () => {
    const txs = [tx(['A', 'A', 'B'], ['X'])];
    assert.deepEqual(linkedAddresses(txs, 'A'), ['B']);
  });
});

describe('averageUtxoAge', () => {
  it('returns null when nothing is confirmed', () => {
    assert.equal(averageUtxoAge([{ valueSats: 100 }], 1000), null);
  });

  it('weights the age by value', () => {
    const now = 100 * 86400;
    // 900 sats aged 10 days, 100 sats aged 90 days -> weighted ~18 days
    const age = averageUtxoAge([
      { valueSats: 900, blockTime: (100 - 10) * 86400 },
      { valueSats: 100, blockTime: (100 - 90) * 86400 },
    ], now);
    assert.ok(age);
    assert.equal(age!.count, 2);
    assert.ok(Math.abs(age!.days - 18) < 0.5, `expected ~18 days, got ${age!.days}`);
  });
});
