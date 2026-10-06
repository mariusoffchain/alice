import assert from 'node:assert/strict';
import test from 'node:test';
import { assertsLiveNetworkValue, liveValueCaveat, withLiveValueCaveat } from './live-value-caveat.ts';

test('answers that present a current network figure or state are flagged', () => {
  // Verbatim patterns from the 2026-10-05 paired generations.
  for (const answer of [
    'As of my last update, the current Bitcoin on-chain fee rate in satoshi per vbyte (sat/vB) is around 20-40 sat/vB.',
    'As of my last update, the current fee rate in sat/vB is approximately 0 sat/vB, meaning you can send transactions for free.',
    'Currently, the fee rate is typically around 1 satoshi per virtual byte.',
    'Le taux de frais actuel en sat/vB est estimé à environ 15 sat/vB.',
    'Oui, le mempool est saturé en ce moment. Cela crée des risques.',
    'En ce moment, le réseau Bitcoin est relativement calme, donc les frais sont faibles.',
    'Currently, the mempool is relatively congested, but fees vary.',
    'In terms of the mempool\'s current size, it is currently around 1.2 million transactions waiting.',
    "Le mempool n'est pas saturé en ce moment, mais il peut être chargé.",
  ]) assert.equal(assertsLiveNetworkValue(answer), true, answer);
});

test('explanations, hypothetical examples and the deterministic replies are not flagged', () => {
  for (const answer of [
    'The total fee equals the fee rate in sat/vB multiplied by the virtual size.',
    'For example, if you choose a fee rate of 50 sat/vB and your transaction is 300 vbytes, the total fee would be 15,000 satoshis.',
    'Si tu choisis 20 sat/vB pour 200 vbytes, cela fait 4 000 satoshis, par exemple.',
    'Your wallet shows the current estimate; review it before confirming.',
    'This chat has no live data about the Bitcoin network or the mempool and cannot see your wallet, so it cannot give you a current fee rate.',
    'Chaque nœud garde son propre mempool et sa charge change en permanence.',
    'The mempool can become congested when many transactions compete for block space.',
    'Le mempool est l’ensemble des transactions non confirmées.',
    '',
  ]) assert.equal(assertsLiveNetworkValue(answer), false, answer);
});

test('the caveat is appended once, in the conversation language, and only when needed', () => {
  const flagged = 'As of my last update, the current fee rate is around 20-40 sat/vB.';
  const once = withLiveValueCaveat(flagged, 'en');
  assert.ok(once.endsWith(liveValueCaveat('en')));
  assert.equal(withLiveValueCaveat(once, 'en'), once);
  assert.ok(withLiveValueCaveat('Le mempool est saturé en ce moment.', 'fr').endsWith(liveValueCaveat('fr')));
  const clean = 'Your wallet shows the current estimate; review it before confirming.';
  assert.equal(withLiveValueCaveat(clean, 'en'), clean);
  for (const language of ['en', 'fr'] as const) assert.doesNotMatch(liveValueCaveat(language), /\d/);
});

