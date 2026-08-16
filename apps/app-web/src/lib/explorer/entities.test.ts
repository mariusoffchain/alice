import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StaticEntityStore, sortLabels, type EntityRecord } from './entities.ts';

const records: EntityRecord[] = [
  { address: 'bc1qEXAMPLE', name: 'Acme Exchange', category: 'exchange', confidence: 'possible', source: 'https://x', sourceLabel: 'x', date: '2026-01-01' },
  { address: 'bc1qexample', name: 'Acme Exchange (hot)', category: 'exchange', confidence: 'strong', source: 'https://y', sourceLabel: 'y', date: '2026-01-02' },
  { address: '1BASE58ADDRxxxxxxxxxxxxxxxxxxxxxx', name: 'Sanctioned', category: 'mixer', confidence: 'certain', source: 'https://ofac', sourceLabel: 'OFAC', date: '2026-01-03' },
];

describe('StaticEntityStore', () => {
  it('matches bech32 addresses case-insensitively and merges labels', () => {
    const store = new StaticEntityStore(records);
    const labels = store.lookupAddress('BC1QEXAMPLE');
    assert.equal(labels.length, 2, 'both labels for the same bech32 address');
    // Strongest confidence first.
    assert.equal(labels[0].confidence, 'strong');
    assert.equal(labels[1].confidence, 'possible');
  });

  it('treats base58 as case-sensitive and returns nothing for a miss', () => {
    const store = new StaticEntityStore(records);
    assert.equal(store.lookupAddress('1base58addrxxxxxxxxxxxxxxxxxxxxxx').length, 0);
    assert.equal(store.lookupAddress('1BASE58ADDRxxxxxxxxxxxxxxxxxxxxxx').length, 1);
    assert.equal(store.lookupAddress('bc1qnotpresent').length, 0);
  });

  it('reports the number of distinct addresses', () => {
    const store = new StaticEntityStore(records);
    assert.equal(store.size, 2); // the two bech32 rows collapse to one address
  });
});

describe('sortLabels', () => {
  it('orders certain > strong > possible, then by name', () => {
    const sorted = sortLabels([
      { name: 'B', category: 'exchange', confidence: 'possible', source: 's', sourceLabel: 's', date: 'd' },
      { name: 'A', category: 'exchange', confidence: 'certain', source: 's', sourceLabel: 's', date: 'd' },
      { name: 'C', category: 'exchange', confidence: 'certain', source: 's', sourceLabel: 's', date: 'd' },
    ]);
    assert.deepEqual(sorted.map(l => l.name), ['A', 'C', 'B']);
  });
});
