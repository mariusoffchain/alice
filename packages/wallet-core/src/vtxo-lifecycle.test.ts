import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtendedVirtualCoin } from '@arkade-os/sdk';
import {
  VTXO_RENEWAL_THRESHOLD_MS,
  classifyVtxo,
  parseOutpoint,
} from './vtxo-lifecycle.ts';

function vtxo(
  overrides: Omit<Partial<ExtendedVirtualCoin>, 'virtualStatus'> & {
    virtualStatus?: Partial<ExtendedVirtualCoin['virtualStatus']>;
  } = {},
): ExtendedVirtualCoin {
  const { virtualStatus, ...rest } = overrides;
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    value: 5_000,
    isSpent: false,
    isUnrolled: false,
    createdAt: new Date(1_700_000_000_000),
    virtualStatus: {
      state: 'settled',
      batchExpiry: Date.now() + 10 * 24 * 60 * 60 * 1_000,
      ...virtualStatus,
    },
    ...rest,
  } as ExtendedVirtualCoin;
}

test('classifyVtxo separates active, expiring, recoverable, and excluded inputs', () => {
  const now = 1_800_000_000_000;
  const active = classifyVtxo(vtxo({
    virtualStatus: { batchExpiry: now + VTXO_RENEWAL_THRESHOLD_MS + 1 },
  }), undefined, now);
  assert.equal(active.collaborativeEligible, true);
  assert.equal(active.needsRenewal, false);

  const expiring = classifyVtxo(vtxo({
    virtualStatus: { batchExpiry: now + VTXO_RENEWAL_THRESHOLD_MS },
  }), undefined, now);
  assert.equal(expiring.needsRenewal, true);

  const recoverable = classifyVtxo(vtxo({
    virtualStatus: { state: 'swept', batchExpiry: now - 1 },
  }), undefined, now);
  assert.equal(recoverable.recoverable, true);
  assert.equal(recoverable.collaborativeEligible, false);

  const excluded = classifyVtxo(
    vtxo({ virtualStatus: { batchExpiry: now + VTXO_RENEWAL_THRESHOLD_MS + 1 } }),
    { reason: 'Rejected input', excludedAt: now },
    now,
  );
  assert.equal(excluded.excluded, true);
  assert.equal(excluded.exclusionReason, 'Rejected input');
  assert.equal(excluded.collaborativeEligible, false);
});

test('classifyVtxo never offers spent or unrolled inputs collaboratively', () => {
  const spent = classifyVtxo(vtxo({ isSpent: true }));
  const unrolled = classifyVtxo(vtxo({ isUnrolled: true }));
  assert.equal(spent.spendable, false);
  assert.equal(spent.collaborativeEligible, false);
  assert.equal(unrolled.unrolled, true);
  assert.equal(unrolled.collaborativeEligible, false);
});

test('parseOutpoint accepts canonical outpoints and rejects malformed input', () => {
  assert.deepEqual(parseOutpoint(`${'f'.repeat(64)}:12`), {
    txid: 'f'.repeat(64),
    vout: 12,
  });
  assert.throws(() => parseOutpoint('not-an-outpoint'), /Invalid VTXO outpoint/);
  assert.throws(() => parseOutpoint(`${'a'.repeat(64)}:-1`), /Invalid VTXO outpoint/);
});
