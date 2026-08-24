import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSatoraRefusal, extractSatoraReason, friendlySatoraLimitError, friendlySatoraReason, fromSatoraSdkError, genericSatoraRefusal, SatoraRefusalError, satoraCall } from './satora-error-message.ts';

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

test('an SDK error wrapping a plain-text server body never reaches the screen', () => {
  const wrapped = fromSatoraSdkError(new Error('Failed to create swap: "internal: node http://10.0.0.7:9735 down, token=abc"'), 'send');
  assert.equal(wrapped.message, 'SATORA REFUSED THIS PAYMENT. NO FUNDS WERE SENT.');
  assert.ok(!wrapped.message.includes('10.0.0.7'));
  assert.equal(wrapped.refusalClass, 'unknown');
  assert.match(wrapped.diagnostic, /^class=unknown status=none length=\d+$/);
});

test('an SDK error wrapping a JSON body is still classified', () => {
  const wrapped = fromSatoraSdkError(new Error('Failed to create swap: {"error":"payment hash exists"}'), 'send');
  assert.equal(wrapped.refusalClass, 'duplicate_swap');
  assert.match(wrapped.message, /ALREADY HAS A SATORA SWAP/);
});

test('a network failure keeps its own message per context', () => {
  assert.match(fromSatoraSdkError(new TypeError('Failed to fetch'), 'send').message, /UNREACHABLE.*NO FUNDS WERE SENT/);
  assert.match(fromSatoraSdkError(new TypeError('Failed to fetch'), 'refund').message, /COULD NOT BROADCAST THE REFUND/);
});

test('refund and status contexts fall back to their generic sentence', () => {
  const refund = fromSatoraSdkError(new Error('Broadcast failed: 500 - <html>stack trace</html>'), 'refund');
  assert.equal(refund.message, 'SATORA COULD NOT PROCESS THE REFUND. YOUR FUNDS REMAIN RECOVERABLE. TRY AGAIN LATER.');
  const status = fromSatoraSdkError(new Error('Failed to get status: {"detail":"secret"}'), 'status');
  assert.equal(status.message, 'SATORA COULD NOT REFRESH THIS SWAP. ALICE WILL KEEP CHECKING IT.');
  assert.ok(!status.message.includes('secret'));
});

test('our own errors pass through satoraCall untouched', async () => {
  const own = new SatoraRefusalError('invoice timeout too long', 400, 'send');
  await assert.rejects(satoraCall('send', async () => { throw own; }), (error: unknown) => error === own);
});
