import assert from 'node:assert/strict';
import test from 'node:test';
import { explorerUnavailableError } from './network-labels.ts';

test('explorer errors name the configured Bitcoin network', () => {
  assert.equal(
    explorerUnavailableError('bitcoin'),
    'BITCOIN MAINNET EXPLORER UNREACHABLE. PAYMENT STATUS MAY BE DELAYED.',
  );
  assert.equal(
    explorerUnavailableError('mutinynet'),
    'MUTINYNET EXPLORER UNREACHABLE. PAYMENT STATUS MAY BE DELAYED.',
  );
});
