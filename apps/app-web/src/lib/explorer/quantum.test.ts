import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressType, analyzeQuantumExposure, detectQuantumExposure } from './quantum.ts';
import { toAbstractSignal } from './audit-core.ts';
import type { AddressStats } from './signals.ts';

function stats(over: Partial<AddressStats>): AddressStats {
  return { address: 'x', fundedCount: 1, spentCount: 0, txCount: 1, fundedSum: 100000, spentSum: 0, ...over };
}

describe('addressType', () => {
  it('recognises the common types by prefix', () => {
    assert.equal(addressType('bc1p...'), 'p2tr');
    assert.equal(addressType('bc1qxyz'), 'p2wpkh');
    assert.equal(addressType('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), 'p2pkh');
    assert.equal(addressType('3ABC'), 'p2sh');
  });
});

describe('analyzeQuantumExposure', () => {
  it('a never-spent P2WPKH address keeps its key hidden', () => {
    const q = analyzeQuantumExposure('bc1qhidden', stats({ spentCount: 0 }));
    assert.equal(q.exposed, false);
    assert.equal(q.taproot, false);
  });

  it('spending from an address exposes its key', () => {
    const q = analyzeQuantumExposure('bc1qspent', stats({ spentCount: 2, fundedSum: 200000, spentSum: 50000 }));
    assert.equal(q.exposed, true);
    assert.equal(q.exposedBySpend, true);
    assert.equal(q.balanceSats, 150000);
  });

  it('a Taproot address exposes its key even if never spent', () => {
    const q = analyzeQuantumExposure('bc1phidden', stats({ spentCount: 0 }));
    assert.equal(q.exposed, true);
    assert.equal(q.taproot, true);
  });
});

describe('detectQuantumExposure', () => {
  it('fires only when funds sit on a key-exposed address', () => {
    assert.equal(detectQuantumExposure('bc1qhidden', stats({ spentCount: 0 })).length, 0, 'hidden key, no finding');
    assert.equal(detectQuantumExposure('bc1qspent', stats({ spentCount: 1, fundedSum: 100000, spentSum: 100000 })).length, 0, 'exposed but empty');
    const sigs = detectQuantumExposure('bc1qspent', stats({ spentCount: 1, fundedSum: 100000, spentSum: 40000 }));
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0].ruleId, 'QUANTUM_EXPOSURE');
    assert.equal(sigs[0].severity, 'low');
  });

  it('projects to buckets and booleans, never the exact balance or address', () => {
    const [sig] = detectQuantumExposure('bc1qspentaddr000111', stats({ spentCount: 1, fundedSum: 5_000_000, spentSum: 0 }));
    const a = toAbstractSignal(sig);
    assert.ok(a);
    assert.deepEqual(a.flags, { exposedBySpend: true, taproot: false });
    assert.deepEqual(a.magnitudes, ['e6']);
    assert.ok(!JSON.stringify(a).includes('5000000'), 'no exact value');
    assert.ok(!JSON.stringify(a).includes('bc1qspentaddr'), 'no address');
  });
});
