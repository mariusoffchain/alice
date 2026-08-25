import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatAnchorSuggestion } from '@alice-wallet/alice-content/src/learn-anchors.ts';
import { matchChatAnchors } from './explorer-suggest.ts';

// Fixtures mirroring the real table's shape (the real identifiers are
// verified by scripts/verify-learn-anchors.mjs, not here).
const SUGGESTIONS: ChatAnchorSuggestion[] = [
  {
    anchor: { type: 'block', id: '840000', label: { fr: 'Le halving de 2024', en: 'The 2024 halving' } },
    keywords: ['halving'],
  },
  {
    anchor: { type: 'tx', id: 'a1075db5', label: { fr: 'Les 2 pizzas', en: 'The pizzas' } },
    keywords: ['pizza'],
  },
  {
    anchor: { type: 'block', id: '0', label: { fr: 'Le bloc Genesis', en: 'The Genesis block' } },
    keywords: ['genesis'],
  },
];

describe('matchChatAnchors', () => {
  it('maps a halving question to its block', () => {
    const anchors = matchChatAnchors("C'est quoi le halving de Bitcoin ?", SUGGESTIONS);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].id, '840000');
  });

  it('matches plurals through the shared tokenizer', () => {
    assert.equal(matchChatAnchors('Parle-moi des halvings', SUGGESTIONS)[0]?.id, '840000');
  });

  it('matches in English too', () => {
    assert.equal(matchChatAnchors('Tell me about bitcoin pizza day', SUGGESTIONS)[0]?.id, 'a1075db5');
  });

  it('never fires on generic vocabulary', () => {
    assert.deepEqual(matchChatAnchors('Comment fonctionne une transaction Bitcoin ?', SUGGESTIONS), []);
    assert.deepEqual(matchChatAnchors('what is a block', SUGGESTIONS), []);
  });

  it('caps at two anchors', () => {
    assert.equal(matchChatAnchors('genesis, pizza et halving', SUGGESTIONS).length, 2);
  });
});
