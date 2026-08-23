import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pendingOpenFromUrl, searchWithoutOpenRequest } from './tab-storage.ts';

const TXID = 'a'.repeat(64);

describe('pendingOpenFromUrl', () => {
  it('opens a transaction linked by Alice Wallet on a known network', () => {
    const pending = pendingOpenFromUrl(`?tx=${TXID}&network=mainnet`);
    assert.equal(pending?.kind, 'tx');
    assert.equal(pending?.query, TXID);
    assert.equal(pending?.networkId, 'mainnet');
    assert.equal(pending?.note?.origin, 'Alice Wallet');
  });

  it('falls back to the default network when the network is unknown', () => {
    assert.equal(pendingOpenFromUrl(`?tx=${TXID}&network=nope`)?.networkId, undefined);
  });

  it('accepts a block by height or by hash', () => {
    assert.equal(pendingOpenFromUrl('?block=840000')?.query, '840000');
    assert.equal(pendingOpenFromUrl(`?block=${'0'.repeat(64)}`)?.kind, 'block');
  });

  it('rejects values that do not look like their subject', () => {
    assert.equal(pendingOpenFromUrl('?tx=../../etc'), null);
    assert.equal(pendingOpenFromUrl('?block=latest/../x'), null);
    assert.equal(pendingOpenFromUrl(`?address=${'%20'.repeat(3)}`), null);
    assert.equal(pendingOpenFromUrl('?xpub=short'), null);
  });

  it('ignores the URL when no subject is present', () => {
    assert.equal(pendingOpenFromUrl('?utm_source=x'), null);
  });
});

describe('searchWithoutOpenRequest', () => {
  it('removes only the consumed keys', () => {
    assert.equal(searchWithoutOpenRequest(`?tx=${TXID}&network=mainnet&utm_source=x`), '?utm_source=x');
    assert.equal(searchWithoutOpenRequest(`?tx=${TXID}`), '');
  });
});
