import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFailure,
  failureDetail,
  hintFor,
  hostOf,
  statusFromError,
} from './venice-failure.ts';

test('a fetch that never completed is unreachable, not unavailable', () => {
  const err = new TypeError('Failed to fetch');
  assert.equal(classifyFailure(err), 'unreachable');
  assert.equal(hintFor(err), 'blocked-or-offline');
});

test('a server error is unavailable, a client error is refused', () => {
  assert.equal(classifyFailure(new Error('Failed to fetch TCB info: 503')), 'unavailable');
  assert.equal(classifyFailure(new Error('Failed to fetch TCB info: 404')), 'refused');
  assert.equal(statusFromError(new Error('Failed to fetch QE identity: 500')), 500);
});

test('a header the browser could not read is refused, and says so', () => {
  const err = new Error('Missing SGX-PCK-CRL-Issuer-Chain');
  assert.equal(classifyFailure(err), 'refused');
  assert.equal(hintFor(err), 'headers');
});

test('the detail line carries only a closed vocabulary', () => {
  const detail = failureDetail({
    stage: 'collateral',
    url: 'https://proxy.alicebtc.com/pccs?token=secret-value',
    error: new TypeError('Failed to fetch'),
  });
  assert.equal(
    detail,
    'stage=collateral host=proxy.alicebtc.com kind=unreachable error=TypeError hint=blocked-or-offline',
  );
  assert.ok(!detail.includes('secret-value'), 'a query string must never reach the line');
});

test('an HTTP status is reported whether it was passed or thrown', () => {
  assert.equal(
    failureDetail({ stage: 'attestation', status: 503 }),
    'stage=attestation status=503',
  );
  assert.equal(
    failureDetail({ stage: 'collateral', error: new Error('Failed to fetch PCK CRL: 502') }),
    'stage=collateral status=502 kind=unavailable error=Error',
  );
});

test('a bad url contributes nothing rather than breaking the line', () => {
  assert.equal(hostOf('not a url'), undefined);
  assert.equal(failureDetail({ stage: 'verify' }), 'stage=verify');
});
