import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boltzmannEqualOutputs, transactionEntropy } from './boltzmann.ts';

describe('boltzmannEqualOutputs', () => {
  it('matches the known reference interpretation counts', () => {
    assert.equal(boltzmannEqualOutputs(2), 3);
    assert.equal(boltzmannEqualOutputs(3), 16);
    assert.equal(boltzmannEqualOutputs(4), 131);
    assert.equal(boltzmannEqualOutputs(5), 1496);
    assert.equal(boltzmannEqualOutputs(6), 22482);
  });
});

describe('transactionEntropy', () => {
  it('is zero for a 1-in-1-out sweep', () => {
    assert.equal(transactionEntropy([1000], [900]).bits, 0);
  });

  it('is high for an equal-output CoinJoin (5 equal outputs, 5 covering inputs)', () => {
    const e = transactionEntropy([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000], [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000]);
    // log2(1496) ~= 10.5 bits
    assert.ok(e.bits > 10 && e.bits < 11, `bits=${e.bits}`);
  });

  it('is modest for a small mixed 2-in-2-out payment', () => {
    const e = transactionEntropy([600_000, 500_000], [700_000, 380_000]);
    assert.ok(e.bits >= 0 && e.bits < 3, `bits=${e.bits}`);
  });
});
