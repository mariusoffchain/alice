import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAddressContext, buildBlockContext, buildTxContext, detectAddressReuse, detectAddressReuseForAddress, type AddressStats } from './signals.ts';
import { toAbstractSignal } from './audit-core.ts';
import type { NormalizedTransaction } from './types.ts';

function tx(partial: Partial<NormalizedTransaction>): NormalizedTransaction {
  return {
    txid: 'a'.repeat(64),
    version: 2,
    locktime: 0,
    sizeBytes: 200,
    weight: 800,
    vsize: 200,
    feeSats: 1000,
    feeRateSatVb: 5,
    status: { confirmed: true, blockHeight: 800000 },
    inputs: [],
    outputs: [],
    isCoinbase: false,
    rbfSignaled: false,
    source: { name: 'test', baseUrl: 'https://x/api' },
    ...partial,
  };
}

const input = (address?: string) => ({
  prevTxid: 'b'.repeat(64), prevVout: 0, address, valueSats: 1000, sequence: 0xffffffff, isCoinbase: false,
});
const output = (index: number, address?: string) => ({ index, address, valueSats: 500 });

describe('detectAddressReuse', () => {
  it('finds nothing when every address is distinct and unseen', () => {
    const t = tx({
      inputs: [input('bc1qin')],
      outputs: [output(0, 'bc1qpay'), output(1, 'bc1qchange')],
    });
    assert.deepEqual(detectAddressReuse(t), []);
  });

  it('flags an address that appears in both an input and an output (intra-tx)', () => {
    const t = tx({
      inputs: [input('bc1qsame')],
      outputs: [output(0, 'bc1qsame'), output(1, 'bc1qother')],
    });
    const signals = detectAddressReuse(t);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].ruleId, 'ADDRESS_REUSE');
    assert.equal(signals[0].confidence, 'certain');
    assert.deepEqual(signals[0].subjects, ['bc1qsame']);
    assert.equal(signals[0].evidence.intraTransaction, true);
  });

  it('flags the same address across two outputs', () => {
    const t = tx({
      inputs: [input('bc1qin')],
      outputs: [output(0, 'bc1qdup'), output(1, 'bc1qdup')],
    });
    const signals = detectAddressReuse(t);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].evidence.inOutputs, 2);
  });

  it('flags historical reuse from address stats even when distinct within the tx', () => {
    const t = tx({
      inputs: [input('bc1qin')],
      outputs: [output(0, 'bc1qreused'), output(1, 'bc1qfresh')],
    });
    const stats = new Map<string, AddressStats>([
      ['bc1qreused', { address: 'bc1qreused', fundedCount: 5, spentCount: 3, txCount: 5, fundedSum: 0, spentSum: 0 }],
      ['bc1qfresh', { address: 'bc1qfresh', fundedCount: 1, spentCount: 0, txCount: 1, fundedSum: 0, spentSum: 0 }],
    ]);
    const signals = detectAddressReuse(t, stats);
    assert.equal(signals.length, 1);
    assert.deepEqual(signals[0].subjects, ['bc1qreused']);
    assert.equal(signals[0].evidence.historical, true);
    assert.equal(signals[0].evidence.fundedCount, 5);
  });

  it('does not flag a fresh address received exactly once', () => {
    const t = tx({ inputs: [input('bc1qin')], outputs: [output(0, 'bc1qfresh')] });
    const stats = new Map<string, AddressStats>([
      ['bc1qfresh', { address: 'bc1qfresh', fundedCount: 1, spentCount: 0, txCount: 1, fundedSum: 0, spentSum: 0 }],
      ['bc1qin', { address: 'bc1qin', fundedCount: 1, spentCount: 1, txCount: 2, fundedSum: 0, spentSum: 0 }],
    ]);
    assert.deepEqual(detectAddressReuse(t, stats), []);
  });

  it('ignores address-less scripts (P2PK, OP_RETURN)', () => {
    const t = tx({
      inputs: [input(undefined)],
      outputs: [output(0, undefined), output(1, undefined)],
    });
    assert.deepEqual(detectAddressReuse(t), []);
  });
});

describe('detectAddressReuseForAddress', () => {
  it('flags an address funded more than once, on the historical ground only', () => {
    const signals = detectAddressReuseForAddress({
      address: 'bc1qreused', fundedCount: 5, spentCount: 3, txCount: 5, fundedSum: 0, spentSum: 0,
    });
    assert.equal(signals.length, 1);
    assert.equal(signals[0].ruleId, 'ADDRESS_REUSE');
    assert.deepEqual(signals[0].subjects, ['bc1qreused']);
    assert.equal(signals[0].evidence.historical, true);
    assert.equal(signals[0].evidence.intraTransaction, false);
    assert.equal(signals[0].evidence.txCount, 5);
  });

  it('does not flag an address funded exactly once', () => {
    assert.deepEqual(detectAddressReuseForAddress({
      address: 'bc1qfresh', fundedCount: 1, spentCount: 0, txCount: 1, fundedSum: 0, spentSum: 0,
    }), []);
  });
});

describe('page context signals', () => {
  it('builds a transaction context with counts and total, never identifiers in shape', () => {
    const t = tx({ inputs: [input('bc1qa'), input('bc1qb')], outputs: [output(0, 'bc1qc'), output(1, 'bc1qa')] });
    const s = buildTxContext(t);
    assert.equal(s.ruleId, 'TX_CONTEXT');
    assert.equal(s.severity, 'info');
    assert.equal(s.evidence.inputCount, 2);
    assert.equal(s.evidence.outputCount, 2);
    assert.equal(s.evidence.addressCount, 3);
    const a = toAbstractSignal(s);
    assert.ok(a);
    assert.equal(a.shape.inputCount, 2);
    assert.equal(a.shape.outputCount, 2);
    assert.equal(a.shape.addresses, 3);
    assert.ok(Array.isArray(a.magnitudes) && a.magnitudes.length === 1);
    assert.ok(!JSON.stringify({ ...a, abstractId: '' }).includes('bc1q'));
  });

  it('builds an address context with tx count and balance bucket', () => {
    const s = buildAddressContext({ address: 'bc1qx', fundedCount: 9, spentCount: 4, txCount: 12, fundedSum: 250_000, spentSum: 100_000 });
    assert.equal(s.ruleId, 'ADDRESS_CONTEXT');
    assert.equal(s.evidence.txCount, 12);
    assert.equal(s.evidence.balanceSats, 150_000);
    const a = toAbstractSignal(s);
    assert.ok(a);
    assert.equal(a.shape.txs, 12);
    assert.deepEqual(a.magnitudes, ['e5']);
  });

  it('builds a block context with tx count and an age bucket', () => {
    const s = buildBlockContext({ id: 'f'.repeat(64), txCount: 4200, timestamp: 1_000_000 }, 1_000_000 + 3600);
    assert.equal(s.ruleId, 'BLOCK_CONTEXT');
    const a = toAbstractSignal(s);
    assert.ok(a);
    assert.equal(a.shape.txs, 4200);
    assert.deepEqual(a.ages, ['<1d']);
  });
});
