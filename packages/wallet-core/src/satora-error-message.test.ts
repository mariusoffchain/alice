import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSatoraRefusal, extractSatoraReason, friendlySatoraLimitError, friendlySatoraReason, genericSatoraRefusal } from './satora-error-message.ts';

test('formats grouped Bitcoin limits returned by Satora as sats', () => {
  assert.equal(
    friendlySatoraLimitError('Failed to create swap: {"error":"Min amount is ₿ 0.00 000 335"}'),
    'AMOUNT TOO SMALL. SATORA MINIMUM: 335 SATS.',
  );
  assert.equal(
    friendlySatoraLimitError('Failed to create swap: {"error":"Max amount is ₿ 0.02 000 000"}'),
    'AMOUNT TOO HIGH. SATORA MAXIMUM: 2,000,000 SATS.',
  );
});

test('formats explicit Satora limits already expressed in sats', () => {
  assert.equal(
    friendlySatoraLimitError('Minimum amount: 1,000 sats'),
    'AMOUNT TOO SMALL. SATORA MINIMUM: 1,000 SATS.',
  );
  assert.equal(
    friendlySatoraLimitError('Maximum amount: 2,000,000 sats'),
    'AMOUNT TOO HIGH. SATORA MAXIMUM: 2,000,000 SATS.',
  );
});

test('never presents an HTTP status or zero as a Satora limit', () => {
  assert.equal(friendlySatoraLimitError('Satora API error 400'), null);
  assert.equal(friendlySatoraLimitError('Minimum amount: 0 sats'), null);
});

test('known Satora reasons become our own sentences', () => {
  assert.match(friendlySatoraReason('invoice timeout too long') ?? '', /WITHIN 24 HOURS/);
  assert.match(friendlySatoraReason('payment hash exists') ?? '', /ALREADY HAS A SATORA SWAP/);
  assert.match(friendlySatoraReason('Min amount is ₿ 0.00 000 335') ?? '', /AMOUNT TOO SMALL/);
});

test('unknown Satora reasons are withheld from the screen', () => {
  assert.equal(friendlySatoraReason('panic at /srv/satora/pay.go:42 http://10.0.0.7/x'), null);
  assert.equal(genericSatoraRefusal(400), 'SATORA REFUSED THIS PAYMENT (HTTP 400). NO FUNDS WERE SENT.');
  const secret = 'token=sk_live_abc123 user@example.com {"payload":1}';
  const line = describeSatoraRefusal(502, secret);
  assert.equal(line, `class=unknown status=502 length=${secret.length}`);
  assert.equal(describeSatoraRefusal(400, 'invoice timeout too long'), 'class=invoice_lifetime status=400 length=24');
});

test('the SDK-wrapped JSON body yields the reason', () => {
  assert.equal(extractSatoraReason('Failed to create swap: {"error":"payment hash exists"}'), 'payment hash exists');
  assert.equal(extractSatoraReason('Failed to create swap: HTTP 500'), null);
});
