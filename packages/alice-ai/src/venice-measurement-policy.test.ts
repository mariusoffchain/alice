import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_MEASUREMENT_POLICY,
  policyIsAnchored,
  selectMatchingReference,
  type MeasurementPolicy,
} from './venice-measurement-policy.ts';
import { VeniceE2EEError } from './venice-e2ee-crypto.ts';

const MR_TD = 'f0'.repeat(48);
const RT_MR3_OLD = 'aa'.repeat(48);
const RT_MR3_NEW = 'bb'.repeat(48);

const measurements = { mrTd: MR_TD, rtMr0: '', rtMr1: '', rtMr2: '', rtMr3: RT_MR3_NEW, mrConfigId: '' };

describe('policyIsAnchored', () => {
  it('is false for empty / meaningless policies', () => {
    assert.equal(policyIsAnchored(undefined), false);
    assert.equal(policyIsAnchored(EMPTY_MEASUREMENT_POLICY), false);
    assert.equal(policyIsAnchored({ references: [{ id: 'x' }] }), false); // no fields
  });

  it('is true once a reference pins at least one field', () => {
    assert.equal(policyIsAnchored({ references: [{ id: 'x', mrTd: MR_TD }] }), true);
  });
});

describe('selectMatchingReference', () => {
  it('refuses when the policy is unanchored', () => {
    assert.throws(() => selectMatchingReference(measurements, EMPTY_MEASUREMENT_POLICY), /no measurement reference is configured/i);
  });

  it('matches an approved reference', () => {
    const policy: MeasurementPolicy = { references: [{ id: 'v1', mrTd: MR_TD, rtMr3: RT_MR3_NEW }] };
    assert.equal(selectMatchingReference(measurements, policy).id, 'v1');
  });

  it('refuses an unknown measurement (no matching reference)', () => {
    const policy: MeasurementPolicy = { references: [{ id: 'v1', mrTd: MR_TD, rtMr3: RT_MR3_OLD }] };
    assert.throws(() => selectMatchingReference(measurements, policy), /do not match any approved reference/);
  });

  it('supports rotation: old + new references both valid, picks the match', () => {
    const policy: MeasurementPolicy = {
      references: [
        { id: 'old', mrTd: MR_TD, rtMr3: RT_MR3_OLD },
        { id: 'new', mrTd: MR_TD, rtMr3: RT_MR3_NEW },
      ],
    };
    assert.equal(selectMatchingReference(measurements, policy).id, 'new');
    assert.equal(selectMatchingReference({ ...measurements, rtMr3: RT_MR3_OLD }, policy).id, 'old');
  });

  it('never matches a revoked reference', () => {
    const policy: MeasurementPolicy = { references: [{ id: 'v1', mrTd: MR_TD, rtMr3: RT_MR3_NEW, revoked: true }] };
    assert.throws(() => selectMatchingReference(measurements, policy), /do not match/);
  });

  it('respects the validity window', () => {
    const policy: MeasurementPolicy = {
      references: [{ id: 'v1', mrTd: MR_TD, rtMr3: RT_MR3_NEW, notBefore: '2026-01-01', notAfter: '2026-06-01' }],
    };
    // Inside the window (but the whole policy still counts as anchored):
    assert.equal(selectMatchingReference(measurements, policy, new Date('2026-03-01')).id, 'v1');
    // After notAfter → no active reference matches.
    assert.throws(() => selectMatchingReference(measurements, policy, new Date('2026-07-01')), /do not match/);
    // Before notBefore → likewise.
    assert.throws(() => selectMatchingReference(measurements, policy, new Date('2025-12-01')), /do not match/);
  });

  it('is case-insensitive and tolerates 0x prefixes', () => {
    const policy: MeasurementPolicy = { references: [{ id: 'v1', mrTd: '0x' + MR_TD.toUpperCase(), rtMr3: RT_MR3_NEW }] };
    assert.equal(selectMatchingReference(measurements, policy).id, 'v1');
  });
});
