import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageBucket,
  magnitudeBucket,
  renderAbstractSignal,
  toAbstractSignal,
  toAbstractSignals,
  type AbstractSignal,
} from './audit-core.ts';
import type { PrivacySignal, RuleId } from './signals.ts';

function reuseSignal(address: string, over: Partial<PrivacySignal> = {}): PrivacySignal {
  return {
    id: `ADDRESS_REUSE:${address}`,
    ruleId: 'ADDRESS_REUSE',
    severity: 'medium',
    confidence: 'certain',
    title: 'Address reuse',
    detail: 'reused',
    subjects: [address],
    evidence: { address, inInputs: 2, inOutputs: 1, intraTransaction: true, historical: true, txCount: 12, fundedCount: 5 },
    ...over,
  };
}

describe('magnitudeBucket', () => {
  it('buckets by order of magnitude, never the value', () => {
    assert.equal(magnitudeBucket(0), 'dust');
    assert.equal(magnitudeBucket(999), 'dust');
    assert.equal(magnitudeBucket(1_000), 'e3');
    assert.equal(magnitudeBucket(50_000), 'e4');
    assert.equal(magnitudeBucket(500_000), 'e5');
    assert.equal(magnitudeBucket(5_000_000), 'e6');
    assert.equal(magnitudeBucket(50_000_000), 'e7');
    assert.equal(magnitudeBucket(100_000_000), 'e8+');
    assert.equal(magnitudeBucket(21e14), 'e8+');
  });
});

describe('ageBucket', () => {
  it('buckets elapsed seconds into relative ages', () => {
    const d = 86_400;
    assert.equal(ageBucket(0), '<1d');
    assert.equal(ageBucket(d - 1), '<1d');
    assert.equal(ageBucket(3 * d), '1-7d');
    assert.equal(ageBucket(20 * d), '1-4w');
    assert.equal(ageBucket(90 * d), '1-6m');
    assert.equal(ageBucket(365 * d), '6m-2y');
    assert.equal(ageBucket(1000 * d), '2y+');
  });
});

describe('toAbstractSignal (ADDRESS_REUSE)', () => {
  it('projects the declared shape and flags', () => {
    const a = toAbstractSignal(reuseSignal('bc1qexampleaddressxxxxxxxxxxxxxxxxxxxxxx'));
    assert.ok(a);
    assert.equal(a.ruleId, 'ADDRESS_REUSE');
    assert.equal(a.ruleVersion, 1);
    assert.equal(a.severity, 'medium');
    assert.equal(a.confidence, 'certain');
    assert.deepEqual(a.shape, { addresses: 1, txs: 12, utxos: 0 });
    assert.deepEqual(a.flags, { intraTransaction: true, historical: true });
    assert.equal(a.redactionProfile, 'v1');
    assert.ok(a.abstractId.startsWith('as_'));
  });

  it('never leaks the raw address, txid, or exact counts beyond shape', () => {
    const addr = 'bc1qsecretaddress000111222333444555666777';
    const a = toAbstractSignal(reuseSignal(addr));
    const serialized = JSON.stringify(a);
    assert.ok(!serialized.includes(addr), 'address must not appear');
    // fundedCount is raw evidence, it must not cross into the projection.
    assert.ok(!serialized.includes('"fundedCount"'), 'fundedCount must not appear');
    assert.ok(!/"address"/.test(serialized), 'no address field');
  });
});

describe('fail-closed default', () => {
  it('returns null for a rule that declares no projection', () => {
    const orphan = reuseSignal('bc1qx', { ruleId: 'SOME_FUTURE_RULE' as RuleId });
    assert.equal(toAbstractSignal(orphan), null);
  });
});

describe('toAbstractSignals linkage', () => {
  it('links signals that share a subject, by abstractId only', () => {
    const shared = 'bc1qshared';
    const abstracts = toAbstractSignals([
      reuseSignal(shared),
      reuseSignal(shared, { id: 'ADDRESS_REUSE:other' }),
      reuseSignal('bc1qalone'),
    ]);
    assert.equal(abstracts.length, 3);
    const [first, second, alone] = abstracts;
    assert.deepEqual(first.relatedTo, [second.abstractId]);
    assert.deepEqual(second.relatedTo, [first.abstractId]);
    assert.deepEqual(alone.relatedTo, []);
    // The link carries no subject, only a session-local id.
    assert.ok(!JSON.stringify(abstracts).includes('bc1qshared'));
  });

  it('drops signals whose rule has no projection', () => {
    const abstracts = toAbstractSignals([
      reuseSignal('bc1qkept'),
      reuseSignal('bc1qdropped', { ruleId: 'NOPE' as RuleId }),
    ]);
    assert.equal(abstracts.length, 1);
  });
});

describe('renderAbstractSignal', () => {
  it('renders plain text with no identifier', () => {
    const a = toAbstractSignal(reuseSignal('bc1qrenderme999')) as AbstractSignal;
    const text = renderAbstractSignal(a);
    assert.match(text, /address reuse/);
    assert.match(text, /severity medium/);
    assert.match(text, /confidence certain/);
    assert.match(text, /1 address/);
    assert.match(text, /12 transactions/);
    assert.match(text, /intraTransaction/);
    assert.ok(!text.includes('bc1qrenderme999'));
  });
});
