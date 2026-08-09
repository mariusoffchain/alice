import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlySatoraLimitError } from './satora-error-message.ts';

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
