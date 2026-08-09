import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHistoryEntries,
  buildHomeRecentHistoryEntries,
} from './history-entries.ts';
import type { PaymentRecord, PaymentStatus } from './payment-types.ts';
import type { Transaction, TransactionStatus } from './wallet-backend.ts';

function transaction(id: string, status: TransactionStatus, createdAt: number): Transaction {
  return {
    id,
    type: 'incoming',
    layer: 'ark',
    amount: 100,
    settled: status === 'settled',
    status,
    createdAt,
    arkTxid: status === 'preconfirmed' || status === 'settled' ? `${id}-ark` : '',
    commitmentTxid: '',
    boardingTxid: '',
  };
}

function payment(
  id: string,
  status: PaymentStatus,
  createdAt: number,
  providerData?: PaymentRecord['providerData'],
): PaymentRecord {
  return {
    id,
    provider: 'test',
    layer: 'lightning',
    direction: 'outgoing',
    amountSats: 100,
    feeSats: 1,
    status,
    createdAt,
    expiresAt: null,
    refundable: status === 'refundable',
    providerData,
  };
}

test('home recent history hides pending and failed transactions without losing older visible entries', () => {
  const entries = buildHomeRecentHistoryEntries([
    transaction('pending-newest', 'pending', 50),
    transaction('failed-newer', 'failed', 40),
    transaction('preconfirmed', 'preconfirmed', 30),
    transaction('settled', 'settled', 20),
    transaction('old-settled', 'settled', 10),
  ], [], 2);

  assert.deepEqual(entries.map(entry => entry.id), ['preconfirmed', 'settled']);
});

test('home recent history shows pending payments only after network evidence exists', () => {
  const entries = buildHomeRecentHistoryEntries([], [
    payment('pending-no-evidence', 'pending', 50),
    payment('pending-funded', 'pending', 40, { fundingTxid: 'tx-123' }),
    payment('settled', 'settled', 30),
    payment('failed', 'failed', 20),
  ], 2);

  assert.deepEqual(entries.map(entry => entry.id), ['pending-funded', 'settled']);
});

test('Bitcoin to Arkade payment hides its duplicate Arkade claim transaction', () => {
  const claim = transaction('claim', 'settled', 30);
  const incomingSwap: PaymentRecord = {
    ...payment('satora-btc', 'settled', 20, {
      fundingTxid: 'bitcoin-funding-txid',
      completionTxid: claim.arkTxid,
    }),
    provider: 'satora',
    layer: 'onchain',
    direction: 'incoming',
  };

  const entries = buildHistoryEntries([claim], [incomingSwap]);

  assert.deepEqual(entries.map(entry => entry.id), ['satora-btc']);
});
