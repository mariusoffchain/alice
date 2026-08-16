import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyRefundError } from './refund-errors.ts';

test('refund errors distinguish retryable failures from a broadcast refund', () => {
  assert.equal(
    friendlyRefundError(new Error('This Satora payment is not refundable yet.')),
    'REFUND IS NOT AVAILABLE YET. ALICE WILL KEEP CHECKING THE SWAP STATUS.',
  );
  assert.match(
    friendlyRefundError(new Error('Failed to fetch'), 'Satora'),
    /FUNDS REMAIN RECOVERABLE/,
  );
  assert.match(
    friendlyRefundError(new Error('The refund was broadcast. Do not retry.')),
    /DO NOT RETRY/,
  );
});
