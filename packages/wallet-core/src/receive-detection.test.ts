import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNewIncomingTransaction,
  findNewReceivedVtxo,
} from './receive-detection.ts';
import type { Transaction, VtxoInfo } from './wallet-backend.ts';

function transaction(
  id: string,
  type: Transaction['type'],
  createdAt: number,
): Transaction {
  return {
    id,
    type,
    layer: 'ark',
    amount: 500,
    settled: false,
    status: 'preconfirmed',
    createdAt,
    arkTxid: id,
    commitmentTxid: '',
    boardingTxid: '',
  };
}

test('receive detection selects the newest incoming transaction absent from the baseline', () => {
  const result = findNewIncomingTransaction(
    [
      transaction('old', 'incoming', 10),
      transaction('outgoing', 'outgoing', 30),
      transaction('new', 'incoming', 20),
    ],
    new Set(['old']),
  );

  assert.equal(result?.id, 'new');
});

test('receive detection ignores incoming transactions already present in the baseline', () => {
  const result = findNewIncomingTransaction(
    [transaction('old', 'incoming', 10)],
    new Set(['old']),
    20,
  );

  assert.equal(result, null);
});

test('receive detection keeps a payment that arrived while the baseline was loading', () => {
  const result = findNewIncomingTransaction(
    [transaction('race', 'incoming', 30)],
    new Set(['race']),
    20,
  );

  assert.equal(result?.id, 'race');
});

test('receive detection finds a new active VTXO without waiting for full history', () => {
  const vtxos: VtxoInfo[] = [
    {
      id: 'old:0',
      txid: 'old',
      vout: 0,
      value: 1_000,
      state: 'settled',
      createdAt: 10,
      spendable: true,
      recoverable: false,
      expired: false,
      unrolled: false,
      needsRenewal: false,
      collaborativeEligible: true,
      frozen: false,
      excluded: false,
    },
    {
      id: 'new:0',
      txid: 'new',
      vout: 0,
      value: 500,
      state: 'preconfirmed',
      createdAt: 20,
      spendable: true,
      recoverable: false,
      expired: false,
      unrolled: false,
      needsRenewal: false,
      collaborativeEligible: true,
      frozen: false,
      excluded: false,
    },
  ];

  assert.equal(findNewReceivedVtxo(vtxos, new Set(['old:0']))?.id, 'new:0');
});
