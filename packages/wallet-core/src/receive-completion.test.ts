import assert from 'node:assert/strict';
import test from 'node:test';
import { settledIncomingAmount } from './receive-completion.ts';
import type { PaymentRecord } from './payment-types.ts';

function payment(fields: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'receive-1',
    provider: 'satora',
    layer: 'lightning',
    direction: 'incoming',
    amountSats: 9_501,
    feeSats: 1,
    status: 'settled',
    createdAt: 1,
    expiresAt: null,
    refundable: false,
    ...fields,
  };
}

test('settled incoming payment provides a receive confirmation amount', () => {
  assert.equal(settledIncomingAmount(payment()), 9_501);
});

test('receive confirmation rejects non-terminal and outgoing payments', () => {
  assert.equal(settledIncomingAmount(payment({ status: 'pending' })), null);
  assert.equal(settledIncomingAmount(payment({ direction: 'outgoing' })), null);
  assert.equal(settledIncomingAmount(payment({ amountSats: 0 })), null);
  assert.equal(settledIncomingAmount(null), null);
});
