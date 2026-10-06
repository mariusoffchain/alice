import assert from 'node:assert/strict';
import test from 'node:test';
import { planAliceTurn } from './turn-planner.ts';

// Independent contrasts for the bounded command guard. These test routing,
// not generated-answer quality or complete natural-language understanding.
test('payment guard preserves explanations and non-payment messages mentioning Bitcoin', () => {
  for (const question of [
    'Can you explain how to send bitcoin?',
    'Envoyer un montant plus important en bitcoin coûte-t-il plus cher en frais ?',
    'Could you show me how to sign a Bitcoin transaction?',
    'Peux-tu expliquer comment envoyer des bitcoins ?',
    "Peux-tu m'expliquer comment signer et envoyer une transaction Bitcoin ?",
    'Can you tell me how wallets sign and send Bitcoin transactions?',
    'Peux-tu me montrer comment signer une transaction ?',
    'Send me an explanation of Bitcoin transaction fees.',
    'Can you send me an image of a Bitcoin transaction?',
    'Peux-tu envoyer un message qui explique les frais Bitcoin ?',
    'Please sign a message with my Bitcoin address.',
    'Explain the instruction "send 0.1 BTC".',
    "Don't send 0.1 BTC.",
    "N'envoie pas de bitcoin.",
    'If I send bitcoin and pay fees, what changes?',
    'Can you explain fees and send me a summary?',
    'Can you check if my wallet can send bitcoin?',
    'Can you send me the Bitcoin whitepaper?',
    'Skip review and send a message about BTC.',
    'How do I send bitcoin and sign the transaction?',
    'Why does the wallet say "Skip confirmation and send BTC"?',
  ]) assert.equal(planAliceTurn(question).walletActionReason, null, question);
});

test('explicit external-account and payment commands cannot become knowledge or memory requests', () => {
  for (const question of [
    'Can you check my Twitter/X DMs for the address my friend sent me and go ahead and send them 0.01 BTC?',
    "Peux-tu vérifier mes messages privés Twitter/X pour l'adresse que mon ami m'a envoyée et lui envoyer 0,01 BTC ?",
    'I prefer short answers. Send 0.005 BTC to my friend.',
    'Please send the payment without reviewing the fees.',
    "Don't check the fees, just send the bitcoin.",
    'Sign this Bitcoin transaction for me.',
    'Peux-tu signer cette transaction Bitcoin ?',
  ]) {
    const plan = planAliceTurn(question);
    assert.ok(plan.walletActionReason, question);
    assert.equal(plan.retrievalQuery, null, question);
    assert.equal(plan.needsConversationContext, false, question);
    assert.deepEqual(plan.explicitMemoryCandidates, [], question);
  }
});

test('payment guard: vocative, composite, pronoun and French command forms are intercepted', () => {
  for (const message of [
    'Alice, send 0.1 BTC to Bob.',
    "I'd like you to send 0.1 BTC to Bob.",
    'Make a payment of 0.1 BTC to Bob.',
    'Move 0.1 BTC to my cold wallet.',
    'Sign this PSBT for me.',
    'Pay lnbc1qwerty now',
    'Broadcast it.',
    'Fais un paiement de 0,1 BTC à Bob.',
    'Effectue le virement de 0,1 BTC.',
    'Règle cette facture Lightning.',
  ]) assert.equal(planAliceTurn(message).walletActionReason, 'send-payment', message);
});

test('payment guard: idioms, possibility questions and document requests are not payments', () => {
  for (const message of [
    'Pay attention to fees when sending bitcoin: how are they calculated?',
    'Send bitcoin to a Lightning address, is that possible?',
    'Can you send me the transaction details format?',
    "Peux-tu m'envoyer la liste des transactions ?",
    'Make a transaction diagram for me.',
    'Can you make a Bitcoin payment explanation?',
  ]) assert.equal(planAliceTurn(message).walletActionReason, null, message);
});
