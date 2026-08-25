import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playgroundBridgeFor, playgroundSuggestionFor } from './playground-suggest.ts';

describe('playgroundBridgeFor', () => {
  it('maps practical chapters to the matching Playground view', () => {
    assert.equal(playgroundBridgeFor('btc101', 'Backing up your wallet'), 'backup');
    assert.equal(playgroundBridgeFor('btc101', 'Receiving your first bitcoins'), 'receive');
    assert.equal(playgroundBridgeFor('btc101', 'Sending a transaction'), 'send');
    assert.equal(playgroundBridgeFor('btc101', 'Understanding fees'), 'send');
    assert.equal(playgroundBridgeFor('BTC101', 'Choosing a wallet'), 'home');
  });

  it('prefers the specific practice over the broad send net', () => {
    // "recovery phrase transaction" mentions both: backup is the point.
    assert.equal(playgroundBridgeFor('btc101', 'Recovery phrase and transactions'), 'backup');
  });

  it('maps French titles the same way', () => {
    assert.equal(playgroundBridgeFor('btc101', 'Sauvegarder son portefeuille'), 'backup');
    assert.equal(playgroundBridgeFor('btc101', 'Envoyer un paiement'), 'send');
  });

  it('leaves theory chapters and other courses unmapped', () => {
    assert.equal(playgroundBridgeFor('btc101', 'A brief history of money'), null);
    assert.equal(playgroundBridgeFor('eco201', 'Sending a transaction'), null);
  });
});

describe('playgroundSuggestionFor', () => {
  it('matches practical chat questions', () => {
    assert.equal(playgroundSuggestionFor('How do I send bitcoin to a friend?'), 'send');
    assert.equal(playgroundSuggestionFor('Comment sauvegarder ma seed ?'), 'backup');
  });

  it('stays silent on theory questions', () => {
    assert.equal(playgroundSuggestionFor('Why is there a 21 million cap?'), null);
    assert.equal(playgroundSuggestionFor('Who was Satoshi Nakamoto?'), null);
  });
});
