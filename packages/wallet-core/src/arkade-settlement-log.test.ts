import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRecoverableArkadeSettlementLog,
} from './arkade-settlement-log.ts';

describe('Arkade settlement log classification', () => {
  it('classifies an incomplete periodic intent round as recoverable', () => {
    assert.equal(isRecoverableArkadeSettlementLog([
      'Error during periodic settle:',
      new Error('INTERNAL_ERROR (0): not enough intent confirmations received'),
    ]), true);
  });

  it('classifies cleanup of an intent already removed by the server', () => {
    assert.equal(isRecoverableArkadeSettlementLog([
      'Failed to delete intent after settle failure for inputs [txid:1]',
      new Error(
        'INVALID_INTENT_PROOF (23): no matching intents found for intent proof',
      ),
    ]), true);
  });

  it('classifies periodic settle when its intent was already removed', () => {
    assert.equal(isRecoverableArkadeSettlementLog([
      'Error during periodic settle:',
      new Error(
        'INVALID_INTENT_PROOF (23): no matching intents found for intent proof',
      ),
    ]), true);
  });

  it('does not hide unrelated settlement, intent, or network failures', () => {
    const visibleErrors = [
      ['Error during periodic settle:', new Error('VTXO_ALREADY_SPENT')],
      ['Error during periodic settle:', new Error('invalid signature')],
      [
        'Error during periodic settle:',
        new Error('INVALID_INTENT_PROOF (23): signature mismatch'),
      ],
      [
        'Failed to delete intent after settle failure',
        new Error('permission denied'),
      ],
      [new Error('The network connection was lost.')],
      ['duplicated input'],
    ];

    for (const args of visibleErrors) {
      assert.equal(isRecoverableArkadeSettlementLog(args), false);
    }
  });
});
