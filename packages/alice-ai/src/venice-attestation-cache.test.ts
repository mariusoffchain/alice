import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CollateralCache,
  MAX_COLLATERAL_TTL_MS,
  collateralExpiry,
} from './venice-attestation-cache.ts';

function collateral(tcbNext?: string, qeNext?: string) {
  return {
    tcb_info: JSON.stringify({ tcbInfo: { nextUpdate: tcbNext } }),
    qe_identity: JSON.stringify({ enclaveIdentity: { nextUpdate: qeNext } }),
  };
}

describe('collateralExpiry', () => {
  it('caps collateral at Alice’s maximum TTL', () => {
    const now = Date.parse('2026-07-24T00:00:00Z');
    assert.equal(
      collateralExpiry(collateral('2026-07-25T00:00:00Z'), now),
      now + MAX_COLLATERAL_TTL_MS,
    );
  });

  it('uses the earliest signed TCB or QE nextUpdate', () => {
    const now = Date.parse('2026-07-24T00:00:00Z');
    assert.equal(
      collateralExpiry(
        collateral('2026-07-24T00:30:00Z', '2026-07-24T00:20:00Z'),
        now,
      ),
      Date.parse('2026-07-24T00:20:00Z'),
    );
  });

  it('falls back to the bounded TTL for malformed metadata', () => {
    const now = 1_000;
    assert.equal(collateralExpiry({ tcb_info: 'not-json' }, now), now + MAX_COLLATERAL_TTL_MS);
  });

  it('marks already-expired collateral as immediately stale', () => {
    const now = Date.parse('2026-07-24T00:00:00Z');
    assert.equal(
      collateralExpiry(collateral('2026-07-23T23:59:00Z'), now),
      Date.parse('2026-07-23T23:59:00Z'),
    );
  });
});

describe('CollateralCache', () => {
  it('returns a fresh entry and drops an expired one', () => {
    const cache = new CollateralCache();
    const value = { public: 'collateral' };
    cache.set('fmspc|processor|tdx', value, 2_000);
    assert.equal(cache.get('fmspc|processor|tdx', 1_999), value);
    assert.equal(cache.get('fmspc|processor|tdx', 2_000), null);
  });

  it('keeps different FMSPC and CA identities separate', () => {
    const cache = new CollateralCache();
    cache.set('a|processor|tdx', { id: 'a' }, 9e15);
    cache.set('a|platform|tdx', { id: 'b' }, 9e15);
    assert.deepEqual(cache.get('a|processor|tdx'), { id: 'a' });
    assert.deepEqual(cache.get('a|platform|tdx'), { id: 'b' });
  });

  it('fetches once and reuses collateral without caching an attestation', async () => {
    const cache = new CollateralCache();
    let calls = 0;
    const fetchCollateral = async () => {
      calls++;
      return collateral('2099-01-01T00:00:00Z');
    };
    await cache.getOrFetch('fmspc|processor|tdx', fetchCollateral);
    await cache.getOrFetch('fmspc|processor|tdx', fetchCollateral);
    assert.equal(calls, 1);
  });

  it('deduplicates concurrent collateral downloads', async () => {
    const cache = new CollateralCache();
    let calls = 0;
    const fetchCollateral = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return collateral('2099-01-01T00:00:00Z');
    };
    await Promise.all([
      cache.getOrFetch('key', fetchCollateral),
      cache.getOrFetch('key', fetchCollateral),
      cache.getOrFetch('key', fetchCollateral),
    ]);
    assert.equal(calls, 1);
  });

  it('never caches a failed collateral download', async () => {
    const cache = new CollateralCache();
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('PCCS unavailable');
    };
    await assert.rejects(() => cache.getOrFetch('key', failing));
    await assert.rejects(() => cache.getOrFetch('key', failing));
    assert.equal(calls, 2);
  });
});
