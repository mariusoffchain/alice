import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getUnsafeResetPayments, pendingResetWarning } from './reset-wallet-safety.ts';
import type { PaymentRecord, PaymentStatus } from './payment-types.ts';

function payment(id: string, status: PaymentStatus): PaymentRecord {
  return {
    id,
    provider: 'test',
    layer: 'lightning',
    direction: 'outgoing',
    amountSats: 100,
    feeSats: 1,
    status,
    createdAt: 1,
    expiresAt: null,
    refundable: status === 'refundable',
  };
}

test('reset safety flags only pending and refundable payment swaps', () => {
  const unsafe = getUnsafeResetPayments([
    payment('created', 'created'),
    payment('quoted', 'quoted'),
    payment('pending', 'pending'),
    payment('settled', 'settled'),
    payment('failed', 'failed'),
    payment('expired', 'expired'),
    payment('refundable', 'refundable'),
    payment('refunded', 'refunded'),
  ]);

  assert.deepEqual(unsafe.map(item => item.id), ['pending', 'refundable']);
});

test('reset safety warning names the number of pending or refundable swaps', () => {
  assert.equal(
    pendingResetWarning(1),
    'Wallet reset blocked: 1 payment swap is still pending or refundable. Settle or refund it first.',
  );
  assert.equal(
    pendingResetWarning(2),
    'Wallet reset blocked: 2 payment swaps are still pending or refundable. Settle or refund them first.',
  );
});

test('wallet reset exposes no unsafe pending-swap bypass', () => {
  const storageSource = readFileSync(decodeURIComponent(new URL('./storage.ts', import.meta.url).pathname), 'utf8');
  const arkSource = readFileSync(decodeURIComponent(new URL('./ark.ts', import.meta.url).pathname), 'utf8');

  assert.doesNotMatch(storageSource, /allowUnsafePendingSwaps/);
  assert.doesNotMatch(arkSource, /allowUnsafePendingSwaps/);
});
