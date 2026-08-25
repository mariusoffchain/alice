import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveArkadeExplorer, resolveTransactionExplorer } from './transaction-explorer.ts';

test('a settlement transaction opens in Alice Explorer on the Bitcoin chain of this build', () => {
  const explorer = resolveTransactionExplorer({
    id: 'settlement', type: 'outgoing', layer: 'onchain', amount: 1, settled: true,
    status: 'settled', createdAt: 0, arkTxid: '', commitmentTxid: 'commitment-id', boardingTxid: '',
  });
  assert.equal(explorer?.direct, true);
  assert.equal(explorer?.kind, 'bitcoin');
  assert.match(explorer?.url ?? '', /^https:\/\/[^/]+\/explorer\?tx=commitment-id&network=(mainnet|mutinynet)$/);
});

test('an Arkade transaction opens in Alice Explorer on the Arkade view', () => {
  const explorer = resolveArkadeExplorer('ark-id');
  assert.equal(explorer.kind, 'arkade');
  assert.match(explorer.url, /\/explorer\?tx=ark-id&network=arkade$/);
});
