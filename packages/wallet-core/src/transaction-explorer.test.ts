import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTransactionExplorer } from './transaction-explorer.ts';

test('uses the configured Bitcoin explorer for a settlement transaction', () => {
  const explorer = resolveTransactionExplorer({
    id: 'settlement', type: 'outgoing', layer: 'onchain', amount: 1, settled: true,
    status: 'settled', createdAt: 0, arkTxid: '', commitmentTxid: 'commitment-id', boardingTxid: '',
  });
  assert.equal(explorer?.direct, true);
  assert.match(explorer?.url ?? '', /\/tx\/commitment-id$/);
});
