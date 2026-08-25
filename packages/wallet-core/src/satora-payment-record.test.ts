import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displaySatoraStatus,
  mapSatoraPaymentStatus,
  toSatoraPaymentRecord,
  toSatoraSwapRecord,
} from './satora-payment-record.ts';
import { getUnsafeResetPayments } from './reset-wallet-safety.ts';
import type { SatoraStoredSwap } from './satora-storage.ts';

function stored(
  status: string,
  fields: Record<string, unknown> = {},
): SatoraStoredSwap {
  return {
    version: 2,
    swapId: 'swap-1',
    keyIndex: 0,
    response: {
      id: 'swap-1',
      direction: 'arkade_to_lightning',
      status,
      source_amount: '10001',
      target_amount: '10000',
      client_lightning_invoice: 'lntb-invoice',
      arkade_vhtlc_address: 'tark1funding',
      created_at: '2026-07-26T10:00:00.000Z',
      ...fields,
    },
    publicKey: 'public',
    preimage: 'preimage',
    preimageHash: 'hash',
    secretKey: 'secret',
    storedAt: 100,
    updatedAt: 100,
  } as SatoraStoredSwap;
}

test('Satora status mapping settles only on the terminal server redemption', () => {
  assert.equal(mapSatoraPaymentStatus('serverfunded', true), 'pending');
  assert.equal(mapSatoraPaymentStatus('clientredeeming', true), 'pending');
  assert.equal(mapSatoraPaymentStatus('serverredeemed', true), 'settled');
  assert.equal(mapSatoraPaymentStatus('unknown-future-status', true), 'pending');
});

test('Satora failed states become refundable only when funds may be locked', () => {
  assert.equal(mapSatoraPaymentStatus('serverwontfund', false), 'failed');
  assert.equal(mapSatoraPaymentStatus('serverwontfund', true), 'refundable');
  assert.equal(mapSatoraPaymentStatus('clientrefunded', true), 'refunded');
});

test('unfunded Satora intents stay out of payment history and reset warnings', () => {
  assert.equal(toSatoraPaymentRecord(stored('pending')), null);
});

test('a funding attempt creates a pending record without claiming success', () => {
  const record = toSatoraPaymentRecord(
    stored('pending', { alice_funding_attempted: true }),
  );
  assert.equal(record?.status, 'pending');
  assert.equal(record?.txid, undefined);
  assert.equal(record?.refundable, false);
});

test('network funding evidence is preserved in the payment record', () => {
  const record = toSatoraPaymentRecord(
    stored('clientfundingseen', { arkade_fund_txid: 'ark-funding-txid' }),
  );
  assert.equal(record?.status, 'pending');
  assert.equal(record?.txid, 'ark-funding-txid');
  assert.equal(record?.feeSats, 1);
  assert.equal(
    (record?.providerData as { providerStatus?: string }).providerStatus,
    'clientfundingseen',
  );
});

test('a broadcast refund remains pending until Satora confirms it', () => {
  const record = toSatoraPaymentRecord(stored('serverwontfund', {
    arkade_fund_txid: 'ark-funding-txid',
    alice_refund_txid: 'ark-refund-txid',
  }));

  assert.equal(record?.status, 'pending');
  assert.equal(record?.refundable, false);
  assert.equal(
    (record?.providerData as { refundTxid?: string }).refundTxid,
    'ark-refund-txid',
  );
});

test('reset safety sees pending and refundable Satora swaps after mapping', () => {
  const pending = toSatoraPaymentRecord(stored('clientfundingseen', {
    arkade_fund_txid: 'ark-funding-txid',
  }));
  const refundable = toSatoraPaymentRecord(stored('serverwontfund', {
    arkade_fund_txid: 'ark-funding-txid',
  }));
  const settled = toSatoraPaymentRecord(stored('serverredeemed', {
    arkade_fund_txid: 'ark-funding-txid',
  }));

  const unsafe = getUnsafeResetPayments(
    [pending, refundable, settled].filter(
      (payment): payment is NonNullable<typeof payment> => payment !== null,
    ),
  );
  assert.deepEqual(unsafe.map(payment => payment.status), [
    'pending',
    'refundable',
  ]);
});

test('an unpaid Satora receive invoice stays out of payment history', () => {
  assert.equal(toSatoraPaymentRecord(stored('pending', {
    direction: 'lightning_to_arkade',
    bolt11_invoice: 'lntb-receive-invoice',
    target_arkade_address: 'tark1receive',
  })), null);
});

test('an unpaid Satora receive invoice remains visible in the swap registry', () => {
  const record = toSatoraSwapRecord(stored('pending', {
    direction: 'lightning_to_arkade',
    bolt11_invoice: 'lntb-receive-invoice',
    target_arkade_address: 'tark1receive',
    alice_invoice_expires_at: Date.now() + 60_000,
  }));

  assert.equal(record.status, 'created');
  assert.equal(record.swapId, 'swap-1');
  assert.equal(record.direction, 'incoming');
  assert.equal(
    (record.providerData as { invoice?: string }).invoice,
    'lntb-receive-invoice',
  );
});

test('an expired unpaid invoice remains visible in the swap registry', () => {
  const record = toSatoraSwapRecord(stored('pending', {
    direction: 'lightning_to_arkade',
    bolt11_invoice: 'lntb-expired-invoice',
    target_arkade_address: 'tark1receive',
    alice_invoice_expires_at: Date.now() - 1,
  }));

  assert.equal(record.status, 'expired');
  assert.equal(record.swapId, 'swap-1');
});

test('Satora receive needs an Arkade claim txid before it is settled', () => {
  const pending = toSatoraPaymentRecord(stored('serverfunded', {
    direction: 'lightning_to_arkade',
    bolt11_invoice: 'lntb-receive-invoice',
    target_arkade_address: 'tark1receive',
    arkade_fund_txid: 'arkade-fund-txid',
  }));
  const settled = toSatoraPaymentRecord(stored('serverfunded', {
    direction: 'lightning_to_arkade',
    bolt11_invoice: 'lntb-receive-invoice',
    target_arkade_address: 'tark1receive',
    arkade_fund_txid: 'arkade-fund-txid',
    alice_claim_txid: 'arkade-claim-txid',
  }));

  assert.equal(pending?.status, 'pending');
  assert.equal(settled?.status, 'settled');
  assert.equal(settled?.txid, 'arkade-claim-txid');
  assert.equal(settled?.direction, 'incoming');
});

test('an unfunded Satora Bitcoin request stays out of payment history', () => {
  assert.equal(toSatoraPaymentRecord(stored('pending', {
    direction: 'btc_to_arkade',
    source_amount: '10210',
    target_amount: '10000',
    btc_htlc_address: 'tb1qswap',
    target_arkade_address: 'tark1receive',
  })), null);
});

test('Satora Bitcoin receive never settles without Arkade claim evidence', () => {
  const pending = toSatoraPaymentRecord(stored('serverredeemed', {
    direction: 'btc_to_arkade',
    source_amount: '10210',
    target_amount: '10000',
    btc_htlc_address: 'tb1qswap',
    target_arkade_address: 'tark1receive',
    btc_fund_txid: 'bitcoin-funding-txid',
    arkade_fund_txid: 'arkade-funding-txid',
  }));
  const settled = toSatoraPaymentRecord(stored('serverfunded', {
    direction: 'btc_to_arkade',
    source_amount: '10210',
    target_amount: '10000',
    btc_htlc_address: 'tb1qswap',
    target_arkade_address: 'tark1receive',
    btc_fund_txid: 'bitcoin-funding-txid',
    arkade_fund_txid: 'arkade-funding-txid',
    alice_claim_txid: 'arkade-claim-txid',
  }));

  assert.equal(pending?.status, 'pending');
  assert.equal(pending?.txid, 'bitcoin-funding-txid');
  assert.equal(settled?.status, 'settled');
  assert.equal(settled?.txid, 'bitcoin-funding-txid');
  assert.equal(
    (settled?.providerData as { completionTxid?: string }).completionTxid,
    'arkade-claim-txid',
  );
});

test('funded failed Satora Bitcoin receive is refundable and blocks unsafe reset', () => {
  const refundable = toSatoraPaymentRecord(stored('serverwontfund', {
    direction: 'btc_to_arkade',
    source_amount: '10210',
    target_amount: '10000',
    btc_htlc_address: 'tb1qswap',
    target_arkade_address: 'tark1receive',
    btc_fund_txid: 'bitcoin-funding-txid',
  }));

  assert.equal(refundable?.status, 'refundable');
  assert.equal(refundable?.refundable, true);
  assert.deepEqual(getUnsafeResetPayments(refundable ? [refundable] : []), [
    refundable,
  ]);
});

test('a provider status outside the protocol is displayed as unknown', () => {
  assert.equal(displaySatoraStatus('serverredeemed'), 'serverredeemed');
  assert.equal(displaySatoraStatus('<script>alert(1)</script>'), 'unknown');
  assert.equal(displaySatoraStatus('internal error: token=abc'), 'unknown');
});
