import assert from 'node:assert/strict';
import test from 'node:test';
import { liveNetworkValueReason, liveNetworkValueResponse } from './live-network-request.ts';
import { planAliceTurn, turnResponseDirective } from './turn-planner.ts';

test('requests for present fee, mempool or Lightning route values are recognized in FR/EN', () => {
  const cases: [string, ReturnType<typeof liveNetworkValueReason>][] = [
    ['What fee should I set right now to get confirmed in the next block?', 'onchain-fee'],
    ['Quels frais dois-je fixer maintenant pour être confirmé dans le prochain bloc ?', 'onchain-fee'],
    ['What is the current fee rate in sat/vB?', 'onchain-fee'],
    ["Combien de frais faut-il mettre aujourd'hui ?", 'onchain-fee'],
    ['Which fee gets me into the next block?', 'onchain-fee'],
    ['Current fee rate?', 'onchain-fee'],
    ['How full is the mempool right now?', 'mempool'],
    ['Le mempool est-il saturé en ce moment ?', 'mempool'],
    ['Can you tell me the exact routing fee and liquidity available right now for a Lightning payment I want to make?', 'lightning-route'],
    ['Peux-tu me dire les frais de routage exacts et la liquidité disponible en ce moment pour un paiement Lightning ?', 'lightning-route'],
    ['Quelle liquidité entrante ai-je actuellement sur Lightning ?', 'lightning-inbound'],
    ['How much inbound capacity do I have right now?', 'lightning-inbound'],
    ['Combien de frais pour le prochain bloc ?', 'onchain-fee'],
    ['How much fee for the next block?', 'onchain-fee'],
  ];
  for (const [message, reason] of cases) assert.equal(liveNetworkValueReason(message), reason, message);
});

test('educational, documentation and present-tense non-value questions are not live requests', () => {
  for (const message of [
    'Does sending a larger amount of bitcoin cost more in fees?',
    'Envoyer un montant plus important en bitcoin coûte-t-il plus cher en frais ?',
    'How are Bitcoin transaction fees calculated?',
    'Comment sont calculés les frais de transaction ?',
    'What is the mempool?',
    "Qu'est-ce que la liquidité entrante sur Lightning ?",
    'What is the current RBF policy for replacing a fee?',
    'Quelles sont les règles actuelles de relais des frais ?',
    'What does the current UTXO set contain?',
    'Why are miners paid transaction fees?',
    'What happens when the next halving reduces the subsidy?',
    // A time cue next to a fee word is not a value request when the sentence
    // asks for an explanation, a judgement or describes a past payment.
    'How does the mempool work today compared to 2017?',
    "Comment fonctionnent les frais aujourd'hui avec SegWit ?",
    'I paid a fee today, was it too high?',
    "J'ai payé des frais aujourd'hui, est-ce normal ?",
    "En ce moment j'apprends les frais, tu peux m'expliquer ?",
    'Right now I am learning about fees, can you explain them?',
    // "Next block" without a time cue is a conceptual question unless the
    // sentence asks which fee or how much to pay.
    'If I pay a higher fee, will my transaction be in the next block?',
    'Will a higher fee put me in the next block?',
    "Est-ce qu'un frais plus élevé me met dans le prochain bloc ?",
  ]) assert.equal(liveNetworkValueReason(message), null, message);
});

test('a present-value request becomes a direct turn after the wallet guards', () => {
  const plan = planAliceTurn('What fee should I set right now to get confirmed in the next block?');
  assert.equal(plan.liveNetworkReason, 'onchain-fee');
  assert.equal(plan.kind, 'conversation');
  assert.equal(plan.retrievalQuery, null);
  assert.deepEqual(plan.explicitMemoryCandidates, []);
  assert.equal(plan.needsConversationContext, false);
  assert.equal(turnResponseDirective(plan, 'en'), '');

  // A personal clause does not turn the guarded request into a model turn.
  const mixed = planAliceTurn('Peux-tu me dire les frais de routage exacts et la liquidité disponible en ce moment pour un paiement Lightning que je veux faire ?');
  assert.equal(mixed.liveNetworkReason, 'lightning-route');
  assert.equal(mixed.kind, 'conversation');
  assert.equal(mixed.retrievalQuery, null);
  assert.equal(turnResponseDirective(mixed, 'fr'), '');

  assert.equal(planAliceTurn('Hi Alice, thanks for your help!').liveNetworkReason, null);
  const action = planAliceTurn('Send 0.01 BTC right now with the lowest fee.');
  assert.equal(action.walletActionReason, 'send-payment');
  assert.equal(action.retrievalQuery, null);
  assert.equal(action.liveNetworkReason, null);

  // Every other question keeps its retrieval query and an empty directive.
  const ordinary = planAliceTurn('Does sending a larger amount of bitcoin cost more in fees?');
  assert.equal(ordinary.liveNetworkReason, null);
  assert.ok(ordinary.retrievalQuery);
  assert.equal(turnResponseDirective(ordinary, 'en'), '');
  assert.equal(turnResponseDirective(planAliceTurn('If I pay a higher fee, will my transaction be in the next block?'), 'en'), '');
});

test('the deterministic reply states the boundary, the mechanism and the wallet referral without any figure', () => {
  for (const reason of ['onchain-fee', 'lightning-route', 'lightning-inbound', 'mempool'] as const) {
    for (const language of ['en', 'fr'] as const) {
      const reply = liveNetworkValueResponse(reason, language);
      assert.doesNotMatch(reply, /\d/, `${reason} ${language}`);
      assert.match(reply, language === 'fr' ? /en direct/ : /no live/, `${reason} ${language}`);
      assert.match(reply, language === 'fr' ? /portefeuille/ : /wallet/, `${reason} ${language}`);
      assert.doesNotMatch(reply, /this turn|ce tour|retrieved notes|notes récupérées/i);
    }
  }
  assert.match(liveNetworkValueResponse('onchain-fee', 'en'), /no fee level guarantees inclusion in the next block/i);
  assert.match(liveNetworkValueResponse('onchain-fee', 'fr'), /aucun niveau de frais ne garantit/i);
  assert.match(liveNetworkValueResponse('mempool', 'fr'), /chaque nœud garde son propre mempool/i);
  assert.match(liveNetworkValueResponse('lightning-route', 'en'), /base plus a share proportional/i);
  assert.match(liveNetworkValueResponse('lightning-inbound', 'fr'), /limite le montant que tu peux recevoir/i);
  assert.match(liveNetworkValueResponse('lightning-inbound', 'en'), /Lightning screen/);
});

test('imperative present-value requests are guarded and conceptual questions next to a time cue are not', () => {
  for (const [message, reason] of [
    ['Tell me the current fee rate', 'onchain-fee'],
    ['Dis-moi les frais actuels', 'onchain-fee'],
    ['Show me the current mempool', 'mempool'],
    ['What is the fee right now?', 'onchain-fee'],
    ['What are the fees right now?', 'onchain-fee'],
  ] as const) {
    assert.equal(liveNetworkValueReason(message), reason, message);
    assert.equal(planAliceTurn(message).liveNetworkReason, reason, message);
  }
  for (const message of [
    'Is there a fee for receiving bitcoin today?',
    'What are the current fee estimation methods wallets use?',
    'Quelle est la différence entre frais actuels et frais estimés ?',
    'Now, what is a fee rate?',
    'Now what are fees?',
    "Maintenant, c'est quoi les frais ?",
    'Can you tell me how the current fee estimation in Bitcoin Core works?',
    "What does 'live' mean when people talk about the mempool?",
    'What is the current state of research on Lightning liquidity?',
  ]) {
    assert.equal(liveNetworkValueReason(message), null, message);
    const plan = planAliceTurn(message);
    assert.equal(plan.liveNetworkReason, null, message);
    assert.ok(plan.retrievalQuery, message);
  }
});
