import assert from 'node:assert/strict';
import test from 'node:test';
import { healthCheckFailureDetail } from './network-health.ts';

test('network health turns aborted requests into a readable timeout', () => {
  const error = new Error('signal is aborted without reason');
  error.name = 'AbortError';
  assert.equal(healthCheckFailureDetail(error), 'TIMED OUT');
});

test('network health normalizes browser fetch failures', () => {
  assert.equal(
    healthCheckFailureDetail(new TypeError('Failed to fetch')),
    'NETWORK ERROR',
  );
});

test('network health preserves specific HTTP-adjacent errors', () => {
  assert.equal(
    healthCheckFailureDetail(new Error('TLS certificate rejected')),
    'TLS certificate rejected',
  );
});
