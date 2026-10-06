import assert from 'node:assert/strict';
import test from 'node:test';
import { directWalletActionResponse, directWalletStateResponse, isContextualFollowUp, isExplicitContinuationRequest, planAliceTurn, turnResponseDirective } from './turn-planner.ts';

test('a response preference is remembered without invoking the RAG', () => {
  const plan = planAliceTurn('I prefer concise answers.');
  assert.equal(plan.kind, 'personal-statement');
  assert.equal(plan.retrievalQuery, null);
  assert.deepEqual(plan.explicitMemoryCandidates, [
    { category: 'preference', text: 'Prefers concise answers' },
  ]);
});

test('separates multiple explicit memories instead of merging the rest of the message', () => {
  const plan = planAliceTurn('I am building Alice Wallet. I prefer concise answers.');
  assert.deepEqual(plan.explicitMemoryCandidates, [
    { category: 'preference', text: 'Prefers concise answers' },
    { category: 'project', text: 'Working on Alice Wallet' },
  ]);
});

test('a learning declaration updates the profile without becoming a knowledge query', () => {
  const plan = planAliceTurn('I am beginning with UTXOs.');
  assert.equal(plan.kind, 'personal-statement');
  assert.equal(plan.retrievalQuery, null);
  assert.equal(plan.hasExplicitLearningDeclaration, true);
});

test('a mixed statement retrieves only the actual question', () => {
  const plan = planAliceTurn("I'm new to UTXOs. What is a change output?");
  assert.equal(plan.kind, 'mixed');
  assert.equal(plan.retrievalQuery, 'What is a change output?');
});

test('a statement that sets up the question travels with it to retrieval', () => {
  // The second sentence alone says nothing about dust, replaceability or
  // multisig: the first one carries the subject.
  assert.equal(
    planAliceTurn('Someone sent me 300 sats. Why does my wallet say it may be uneconomic to spend?').retrievalQuery,
    'Someone sent me 300 sats. Why does my wallet say it may be uneconomic to spend?',
  );
  assert.equal(
    planAliceTurn('My wallet did not mark the transaction as replaceable. Does that mean nobody can replace it?').retrievalQuery,
    'My wallet did not mark the transaction as replaceable. Does that mean nobody can replace it?',
  );
  assert.equal(
    planAliceTurn("J'ai 2 de mes 3 seeds multisig. Est-ce suffisant pour récupérer mes bitcoins ?").retrievalQuery,
    "J'ai 2 de mes 3 seeds multisig. Est-ce suffisant pour récupérer mes bitcoins ?",
  );
  // What the user says about themself as a learner still stays out.
  assert.equal(planAliceTurn("I'm a beginner. How do fees work?").retrievalQuery, 'How do fees work?');
  assert.equal(planAliceTurn('I prefer short answers. How do fees work?').retrievalQuery, 'How do fees work?');
});

test('a French or English modal opener keeps the whole question', () => {
  assert.equal(
    planAliceTurn("Je n'ai qu'un portable avec 100 Go de libre. Puis-je quand même vérifier Bitcoin moi-même ?").retrievalQuery,
    "Je n'ai qu'un portable avec 100 Go de libre. Puis-je quand même vérifier Bitcoin moi-même ?",
  );
  assert.equal(planAliceTurn('Can I cancel a Bitcoin payment I sent by mistake?').retrievalQuery, 'Can I cancel a Bitcoin payment I sent by mistake?');
  assert.equal(planAliceTurn('Dois-je attendre six confirmations ?').retrievalQuery, 'Dois-je attendre six confirmations ?');
});

test('ordinary questions and short topic prompts remain retrievable', () => {
  const standalone = planAliceTurn('How does Lightning routing work?');
  assert.equal(standalone.retrievalQuery, 'How does Lightning routing work?');
  assert.equal(standalone.needsConversationContext, false);
  assert.equal(planAliceTurn('Ark').retrievalQuery, 'Ark');
});

test('distinguishes real follow-ups from autonomous questions', () => {
  for (const message of [
    'Can you explain that further?',
    'Pourquoi ?',
    'Et Lightning ?',
    'Qu’en est-il des frais ?',
  ]) {
    assert.equal(planAliceTurn(message).needsConversationContext, true, message);
  }

  for (const message of [
    'Explain what is Bitcoin?',
    'Why is Bitcoin scarce?',
    'How does Lightning routing work?',
  ]) {
    assert.equal(planAliceTurn(message).needsConversationContext, false, message);
  }
});

// An imperative with no question mark asks for more as explicitly as a
// question does. Retrieval needs to tell it from an acknowledgement, which also
// speaks about the previous answer but asks for nothing (rag-query-rewrite.ts).
test('explicit continuation requests are recognized without a question mark', () => {
  for (const message of ['Développe', 'Approfondis', 'Tell me more', 'Dis-m’en plus', 'Explain further']) {
    assert.equal(isExplicitContinuationRequest(message), true, message);
    assert.equal(planAliceTurn(message).needsConversationContext, true, message);
  }

  for (const message of [
    'That makes sense.',
    'Hello!',
    'Explain what is Bitcoin?',
    'How does Lightning routing work?',
  ]) {
    assert.equal(isExplicitContinuationRequest(message), false, message);
  }
});

test('greetings and unrelated conversation do not search the knowledge base', () => {
  assert.equal(planAliceTurn('Hello!').retrievalQuery, null);
  assert.equal(planAliceTurn('That makes sense.').retrievalQuery, null);
});

test('questions about Alice Memory never search the Bitcoin knowledge base', () => {
  for (const message of [
    'What do you know about me?',
    'What am I working on and how should you answer me?',
    'Que sais-tu de moi ?',
    'Sur quoi est-ce que je travaille ?',
  ]) {
    const plan = planAliceTurn(message);
    assert.equal(plan.asksAboutUserMemory, true, message);
    assert.equal(plan.retrievalQuery, null, message);
  }
});

test('future visual requests are classified without adding a second model call', () => {
  const diagram = planAliceTurn('Create a diagram explaining a UTXO transaction');
  assert.equal(diagram.requestedCapability, 'diagram-generation');
  assert.equal(diagram.retrievalQuery, 'Create a diagram explaining a UTXO transaction');

  const image = planAliceTurn('Generate an image about Bitcoin mining');
  assert.equal(image.requestedCapability, 'image-generation');
});


test('social wellbeing clauses bypass retrieval without swallowing a technical question', () => {
  for (const message of ["Au fait, comment vas-tu aujourd'hui ?", 'Hi, how are you?', 'Ça va bien ?', 'How are you feeling today?']) {
    assert.equal(planAliceTurn(message).retrievalQuery, null, message);
  }
  for (const [message, expected] of [
    ['Hi, how are you? Explain RBF.', 'Explain RBF.'],
    ['Comment vas-tu ? Comment fonctionne Bitcoin ?', 'Comment fonctionne Bitcoin ?'],
    ['Hello, how are Bitcoin transactions validated?', 'how are Bitcoin transactions validated?'],
  ]) assert.equal(planAliceTurn(message).retrievalQuery, expected);
});

test('personal-memory requests never search or claim an unsupported save', () => {
  for (const message of ['Can you remember my name for next time?', 'Do you remember my name?', 'Peux-tu retenir mon prénom pour la prochaine fois ?', 'Te souviens-tu de mon prénom ?', 'Comment devrais-tu me répondre ?', 'Quels sont mes centres d’intérêt ?']) {
    const plan = planAliceTurn(message);
    assert.equal(plan.retrievalQuery, null, message);
    assert.equal(plan.asksAboutUserMemory, true, message);
    assert.deepEqual(plan.explicitMemoryCandidates, []);
    assert.match(turnResponseDirective(plan, 'en'), /Do not claim to have stored/);
  }
  for (const message of ['Can you remember my name? What is Lightning?', 'Que sais-tu de moi ? Explique Bitcoin.']) {
    const plan = planAliceTurn(message);
    assert.equal(plan.asksAboutUserMemory, false);
    assert.match(plan.retrievalQuery ?? '', /Lightning|Bitcoin/);
    assert.doesNotMatch(plan.retrievalQuery ?? '', /my name|de moi/);
  }
  assert.ok(planAliceTurn('How do Bitcoin nodes use memory?').retrievalQuery);
  assert.ok(planAliceTurn('Why is Bitcoin named Bitcoin?').retrievalQuery);
  assert.deepEqual(planAliceTurn('I prefer concise answers. What do you know about me?').explicitMemoryCandidates, [{ category: 'preference', text: 'Prefers concise answers' }]);
});

test('a topical prefix before an interrogative survives clause extraction', () => {
  for (const message of ['Et sur Ark, les frais ça fonctionne comment ?', 'On Lightning, how are fees determined?', "Et le RBF, c'est risqué à utiliser ?"]) {
    assert.equal(planAliceTurn(message).retrievalQuery, message);
  }
  assert.equal(planAliceTurn("I'm learning Bitcoin, how does Lightning work?").retrievalQuery, 'how does Lightning work?');
  assert.equal(planAliceTurn("My name is Alex, how does Lightning work?").retrievalQuery, 'how does Lightning work?');
});


test('discourse introductions do not pollute technical queries', () => {
  for (const [message, query] of [
    ["Switching topics, what's a PayJoin exactly?", "what's a PayJoin exactly?"],
    ['Anyway, quick question — what actually happens during a halving?', 'what actually happens during a halving?'],
    ["Au fait, pourquoi l'ajustement de la difficulté est périodique ?", "pourquoi l'ajustement de la difficulté est périodique ?"],
  ]) assert.equal(planAliceTurn(message).retrievalQuery, query);
});

test('a conditional premise naming the user stays inside the retrieval query', () => {
  const enMessage = "If I run a full node instead of relying on a wallet connected to someone else's remote node, what do I actually gain?";
  assert.equal(planAliceTurn(enMessage).retrievalQuery, enMessage);

  const enWhen = 'When I validate a block myself instead of trusting an explorer, what exactly changes?';
  assert.equal(planAliceTurn(enWhen).retrievalQuery, enWhen);

  const frSi = "Si je lance un nœud complet plutôt que d'utiliser un portefeuille connecté à quelqu'un d'autre, qu'est-ce que je gagne vraiment ?";
  assert.equal(planAliceTurn(frSi).retrievalQuery, frSi);

  const frLorsque = 'Lorsque je valide un bloc moi-même plutôt que de faire confiance à un explorateur, qu\'est-ce qui change réellement ?';
  assert.equal(planAliceTurn(frLorsque).retrievalQuery, frLorsque);

  // True personal/learning declarations before the question are still stripped.
  assert.equal(planAliceTurn("I'm learning Bitcoin, how does Lightning work?").retrievalQuery, 'how does Lightning work?');
  assert.equal(planAliceTurn('My name is Alex, how does Lightning work?').retrievalQuery, 'how does Lightning work?');
});

test('a conditional clause never seeds a memory candidate from a simple hypothesis', () => {
  for (const message of [
    'If I want to switch to self-custody, what do I lose?',
    'If I am building a Lightning wallet, what fees should I expect?',
    "Si je construis un nœud complet, quels sont les risques ?",
  ]) {
    assert.deepEqual(planAliceTurn(message).explicitMemoryCandidates, [], message);
  }

  // Outside a conditional, the same declarations still produce a candidate.
  assert.deepEqual(planAliceTurn('I am building Alice Wallet.').explicitMemoryCandidates, [
    { category: 'project', text: 'Working on Alice Wallet' },
  ]);
});

test('personal recollections stay out of RAG while technical memory questions remain searchable', () => {
  for (const message of [
    "Coucou, comment s'est passée ta journée ?",
    'Tu te souviens que je préfère toujours des réponses courtes et directes ?',
    'Do you remember I told you I prefer short, direct answers?',
    'Tu te souviens de ce que je viens de te dire il y a cinq minutes ?',
    "What's my favorite coffee order again?",
  ]) assert.equal(planAliceTurn(message).retrievalQuery, null, message);
  for (const message of ['Do you remember how Bitcoin nodes validate blocks?', 'What is my transaction status?', 'Comment les nœuds utilisent-ils la mémoire ?']) {
    assert.ok(planAliceTurn(message).retrievalQuery, message);
  }
});


test('conditional personal or learning wording preserves its premise without asserting a fact', () => {
  for (const message of [
    'If I am building a Lightning wallet, what fees should I expect?',
    'If I prefer short confirmation times, how are fees affected?',
    'Si je suis débutant, comment vérifier une sauvegarde ?',
    'Lorsque je construis un portefeuille, comment vérifier les adresses ?',
  ]) {
    const plan = planAliceTurn(message);
    assert.equal(plan.retrievalQuery, message);
    assert.equal(plan.kind, 'question');
    assert.equal(plan.hasExplicitLearningDeclaration, false);
    assert.deepEqual(plan.explicitMemoryCandidates, []);
  }
  const mixed = planAliceTurn('I prefer concise answers. If I run a full node, what do I gain?');
  assert.equal(mixed.retrievalQuery, 'If I run a full node, what do I gain?');
  assert.deepEqual(mixed.explicitMemoryCandidates, [{ category: 'preference', text: 'Prefers concise answers' }]);
});

test('explicit live wallet-state requests are flagged in both languages', () => {
  for (const message of [
    "What's my balance?",
    'What is my bitcoin balance?',
    'How much bitcoin do I have?',
    'How much bitcoin do I currently hold?',
    'Can you tell me how much bitcoin I currently hold?',
    'Check my wallet balance.',
    'Based on what you remember about me, what is my balance?',
  ]) {
    assert.equal(planAliceTurn(message).walletStateReason, 'balance', message);
  }
  for (const message of [
    'Quel est mon solde ?',
    "Combien de bitcoin j'ai ?",
    'Montre-moi mon solde.',
    'Quels sont mes avoirs ?',
    'Combien de bitcoins je possède actuellement ?',
    'Peux-tu vérifier mon solde ?',
  ]) {
    assert.equal(planAliceTurn(message).walletStateReason, 'balance', message);
  }

  for (const message of [
    'What was my last transaction?',
    'Show me my transaction history.',
    "What's my transaction history?",
  ]) {
    assert.equal(planAliceTurn(message).walletStateReason, 'transaction-history', message);
  }
  for (const message of [
    'Quelle est ma dernière transaction ?',
    "Montre-moi l'historique de mes transactions.",
  ]) {
    assert.equal(planAliceTurn(message).walletStateReason, 'transaction-history', message);
  }

  assert.match(directWalletStateResponse('en'), /wallet/i);
  assert.match(directWalletStateResponse('fr'), /portefeuille/i);
  assert.doesNotMatch(directWalletStateResponse('en').toLowerCase(), /seed phrase from you|send your seed/);
});

test('live wallet-state detection ignores definitions, how-tos, hypotheticals and unrelated recall', () => {
  for (const message of [
    'What is a wallet balance?',
    'How do I check my balance in the app?',
    'Comment vérifier mon solde dans l’application ?',
    'If my balance is 2 BTC and I send 0.5 BTC, how much is left?',
    'Comment exporter l’historique de mes transactions ?',
    'Explain the phrase “what is my balance”.',
    'My balance is 2 BTC. After spending 0.5 BTC, how much would remain?',
    'Suppose I ask what is my balance, what would you do?',
    'Can you explain how to check my wallet balance?',
    'How does Lightning routing work?',
    'What do you know about me?',
  ]) {
    assert.equal(planAliceTurn(message).walletStateReason, null, message);
  }
});

test('a wallet-state ask right after a technical discussion is still guarded on its own', () => {
  // The guard is evaluated on the current message alone, independent of any
  // prior Bitcoin-topic history, so a guarded follow-up cannot be rewritten
  // back into a retrievable RAG query by rag-query-rewrite.ts.
  assert.equal(planAliceTurn('How does Lightning routing work?').walletStateReason, null);
  assert.equal(planAliceTurn("What's my balance?").walletStateReason, 'balance');
  assert.equal(planAliceTurn('Quel est mon solde ?').walletStateReason, 'balance');
});

test('a mixed wallet-state and educational question is still fully guarded', () => {
  const plan = planAliceTurn("What's my bitcoin balance, and also what is a UTXO?");
  assert.equal(plan.walletStateReason, 'balance');
});


test('explicit requests for the assistant to execute a Bitcoin payment are flagged in both languages', () => {
  for (const message of [
    'Send 0.5 BTC to this address.',
    'Please pay this invoice now.',
    'Can you send 0.1 BTC to Alice?',
    'Go ahead and broadcast this transaction.',
    'I need you to sign and send this payment.',
    'Just send 0.25 btc to my friend right now.',
  ]) {
    assert.equal(planAliceTurn(message).walletActionReason, 'send-payment', message);
  }
  for (const message of [
    'Envoie 0,5 BTC à cette adresse.',
    'Paye cette facture maintenant.',
    'Peux-tu envoyer 0,001 BTC à Alice ?',
    'Vas-y et diffuse cette transaction.',
    "J'ai besoin que tu signes et envoies ce paiement.",
  ]) {
    assert.equal(planAliceTurn(message).walletActionReason, 'send-payment', message);
  }

  assert.match(directWalletActionResponse('en'), /wallet/i);
  assert.match(directWalletActionResponse('fr'), /portefeuille/i);
  assert.doesNotMatch(directWalletActionResponse('en').toLowerCase(), /seed phrase from you|send your seed/);
});

test('explicit requests to bypass wallet review, fees or confirmation are flagged', () => {
  for (const message of [
    "Send 0.1 BTC without confirming anything, just do it.",
    "Skip the confirmation and send the payment now.",
    "Don't bother checking the fees, just broadcast the transaction.",
  ]) {
    assert.equal(planAliceTurn(message).walletActionReason, 'review-bypass', message);
  }
  for (const message of [
    'Envoie le paiement sans confirmer, fais-le maintenant.',
    'Ignore la confirmation et envoie le paiement.',
  ]) {
    assert.equal(planAliceTurn(message).walletActionReason, 'review-bypass', message);
  }
});

test('wallet-action detection ignores negated commands, how-tos, hypotheticals and quoted examples', () => {
  for (const message of [
    "Don't send any bitcoin right now.",
    "N'envoie pas de bitcoins pour le moment.",
    'How do I send bitcoin to another wallet?',
    'Can you explain how to send Bitcoin?',
    'Comment envoyer des bitcoins à quelqu’un ?',
    'What happens if I sign a transaction?',
    'If I send 0.1 BTC, will it arrive instantly?',
    'Si j’envoie 0,5 BTC, combien de temps cela prend-il ?',
    'Someone wrote "send 0.5 BTC now" as an example of a scam message.',
    'He texted "please send 0.1 btc immediately".',
    'Send me an update when you get the chance.',
    'Send a picture of the cat.',
    'I sent 0.1 BTC yesterday.',
  ]) {
    assert.equal(planAliceTurn(message).walletActionReason, null, message);
  }
});

test('a compound request for external-message access followed by sending funds is flagged', () => {
  for (const message of [
    'Check my messages for payment requests and send 0.5 BTC to whoever asks.',
    'Check my inbox, then send 0.2 BTC to the first address you find.',
    'Read my emails for instructions. Then send 0.3 BTC to the address mentioned.',
  ]) {
    const plan = planAliceTurn(message);
    assert.equal(plan.walletActionReason, 'send-payment', message);
  }
});

test('wallet-action planning suppresses retrieval, memory and conversation context', () => {
  for (const message of [
    'Send 0.5 BTC to this address.',
    'Peux-tu envoyer 0,001 BTC à Alice ?',
    'I prefer concise answers. Send 0.1 BTC to my friend.',
  ]) {
    const plan = planAliceTurn(message);
    assert.ok(plan.walletActionReason, message);
    assert.equal(plan.retrievalQuery, null, message);
    assert.equal(plan.needsConversationContext, false, message);
    assert.deepEqual(plan.explicitMemoryCandidates, [], message);
    assert.equal(plan.kind, 'conversation', message);
  }
});

test('wallet-state planning suppresses query and memory even in mixed turns', () => {
  for (const message of [
    'How do I check my balance? What is my balance now?',
    'If I use Lightning, what are routing fees? Quel est mon solde ?',
    'I prefer concise answers. Show my transaction history.',
    'Based on what you remember about me, how much bitcoin do I currently hold and what was my last transaction?',
    "D'après ce que tu te souviens de moi, combien de bitcoins je possède actuellement et quelle était ma dernière transaction ?",
  ]) {
    const plan = planAliceTurn(message);
    assert.ok(plan.walletStateReason, message);
    assert.equal(plan.retrievalQuery, null, message);
    assert.equal(plan.needsConversationContext, false, message);
    assert.deepEqual(plan.explicitMemoryCandidates, [], message);
  }
});

test('wallet-state guard: hypothetical, modal and file questions stay knowledge questions', () => {
  for (const message of [
    'What is my balance if I hold 2 BTC and send 0.5 BTC?',
    'How much bitcoin do I have to lock in a Lightning channel?',
    'How much bitcoin do I have to pay in fees for a 200 vbyte transaction?',
    "Combien de bitcoins j'ai besoin pour ouvrir un canal Lightning ?",
    "What's in my wallet file, technically speaking?",
  ]) {
    const plan = planAliceTurn(message);
    assert.equal(plan.walletStateReason, null, message);
    assert.ok(plan.retrievalQuery, message);
  }
});

test('wallet-state guard: FR/EN command and possessive variants are recognized', () => {
  for (const message of [
    'Dis-moi mon solde.',
    'Affiche mon solde.',
    "C'est quoi mon solde ?",
    'Mon solde ?',
    "J'ai combien de bitcoins ?",
    'Quel est le solde de mon portefeuille ?',
    "What's my wallet's balance?",
  ]) assert.equal(planAliceTurn(message).walletStateReason, 'balance', message);
  for (const message of [
    'Quelles sont mes dernières transactions ?',
    'What are my last transactions?',
    'List my transactions.',
  ]) assert.equal(planAliceTurn(message).walletStateReason, 'transaction-history', message);
});

test('a French "ça" alone does not turn a question into a follow-up', () => {
  const plan = planAliceTurn("Quand j'envoie des bitcoins est-ce que ça passe par une banque ?");
  assert.equal(plan.needsConversationContext, false);
  assert.equal(plan.retrievalQuery, "Quand j'envoie des bitcoins est-ce que ça passe par une banque ?");
  assert.equal(isContextualFollowUp('Et ça marche avec Ark ?'), true);
});

test('an acknowledged connector or a bare request for an example is a follow-up', () => {
  for (const message of ['Oui, mais pourquoi ?', 'Yes, but why?', 'Ok, but how?', "D'accord, mais comment ?", 'Par exemple ?', 'In practice?', 'Et concrètement ?', 'For instance?']) {
    assert.equal(isContextualFollowUp(message), true, message);
    assert.equal(planAliceTurn(message).needsConversationContext, true, message);
  }
  for (const message of ['Oui, les frais dépendent de la taille de la transaction.', 'Yes, I understand Lightning now.', 'What is a UTXO, for example in a wallet?']) {
    assert.equal(isContextualFollowUp(message), false, message);
  }
});

// --- Explicit remember requests (session 1 of the user-memory plan) ---

import { directRequestedNoteResponse, requestedNoteInMessage } from './turn-planner.ts';
import { createAliceMemory } from './alice-memory-core.ts';

test('an explicit remember request in French or English becomes a requested note', () => {
  const cases: Array<[string, string]> = [
    ['Retiens que je fais tourner un nœud élagué.', 'je fais tourner un nœud élagué'],
    ["Souviens-toi que j'utilise un portefeuille matériel.", "j'utilise un portefeuille matériel"],
    ['Peux-tu retenir ceci : je réponds mieux aux exemples concrets.', 'je réponds mieux aux exemples concrets'],
    ['Rappelle-toi que je préfère les schémas aux listes.', 'je préfère les schémas aux listes'],
    ['Peux-tu retenir que je débute avec Lightning ?', 'je débute avec Lightning'],
    ['Retiens ceci : « mes réponses doivent rester courtes »', 'mes réponses doivent rester courtes'],
    ['Remember that I run a pruned node at home.', 'I run a pruned node at home'],
    ['Please remember I use a hardware wallet.', 'I use a hardware wallet'],
    ['Can you remember this: I learn best with diagrams.', 'I learn best with diagrams'],
    ['Could you please remember that I explain Bitcoin to beginners?', 'I explain Bitcoin to beginners'],
    ['Alice, remember that I only have a phone, no computer.', 'I only have a phone, no computer'],
  ];
  for (const [message, text] of cases) {
    const plan = planAliceTurn(message);
    assert.equal(plan.requestedNote?.text, text, message);
    assert.equal(plan.requestedNote?.refusal, null, message);
    assert.equal(plan.requestedNote?.standalone, true, message);
    assert.deepEqual(plan.explicitMemoryCandidates, [{ category: 'requested-note', text }], message);
    assert.equal(plan.kind, 'personal-statement', message);
    assert.equal(plan.retrievalQuery, null, message);
    assert.equal(plan.asksAboutUserMemory, false, message);
  }
});

test('a sentence sent alone, a recall question or a plain statement is never a requested note', () => {
  for (const message of [
    'Je fais tourner un nœud élagué.',
    'I run a pruned node at home.',
    'Tu te souviens que je préfère toujours des réponses courtes et directes ?',
    'Do you remember I told you I prefer short, direct answers?',
    'Do you remember that I use a hardware wallet?',
    'Can you remember my name for next time?',
    'Peux-tu retenir mon prénom pour la prochaine fois ?',
    'I remember that the halving happens every four years.',
    'Je me souviens que les frais étaient élevés en 2021.',
    'What do you remember about me?',
    'Remember to check the fee rate before sending?',
  ]) {
    const plan = planAliceTurn(message);
    assert.equal(plan.requestedNote ?? null, null, message);
    assert.ok(!plan.explicitMemoryCandidates.some(candidate => candidate.category === 'requested-note'), message);
  }
});

test('a requested note still goes through the filters and the refusal names why', () => {
  const cases: Array<[string, string]> = [
    ['Retiens que je garde 0.5 BTC sur ma Ledger.', 'amount'],
    ['Remember that my budget is $300 a month.', 'amount'],
    [`Souviens-toi que mon adresse est bc1q${'q'.repeat(38)}.`, 'address'],
    ['Please remember that my recovery phrase is in the safe.', 'secret'],
    ["Retiens que je m'appelle Marius.", 'identity'],
    ['Remember that I have a Kraken account.', 'exchange'],
    ['Retiens que ma dernière transaction a mis deux heures.', 'activity'],
  ];
  for (const [message, reason] of cases) {
    const plan = planAliceTurn(message);
    assert.equal(plan.requestedNote?.refusal, reason, message);
    assert.deepEqual(plan.explicitMemoryCandidates, [], message);
    assert.equal(plan.retrievalQuery, null, message);
  }
});

test('the note ends with its sentence and keeps its accents', () => {
  assert.equal(requestedNoteInMessage('Retiens que je préfère les réponses détaillées. Merci !')?.text, 'je préfère les réponses détaillées');
  assert.equal(requestedNoteInMessage('Remember that "I like diagrams".')?.text, 'I like diagrams');
  assert.equal(requestedNoteInMessage('Retiens que'), null);
});

test('a remember request followed by a question keeps the note and still answers the question', () => {
  const plan = planAliceTurn('Retiens que je préfère les réponses détaillées. Qu\'est-ce qu\'un UTXO ?');
  assert.equal(plan.requestedNote?.text, 'je préfère les réponses détaillées');
  assert.equal(plan.requestedNote?.standalone, false);
  assert.equal(plan.retrievalQuery, "Qu'est-ce qu'un UTXO ?");
  assert.notEqual(plan.kind, 'personal-statement');
  assert.ok(plan.explicitMemoryCandidates.some(candidate => candidate.category === 'requested-note' && candidate.text === 'je préfère les réponses détaillées'));
});

test('"note que", "note that" and "keep in mind that" are not triggers, so mixed turns keep their question and declaration', () => {
  const french = planAliceTurn('Note que je ne suis pas expert, mais comment fonctionne un UTXO ?');
  assert.equal(french.requestedNote ?? null, null);
  assert.deepEqual(french.explicitMemoryCandidates, []);
  assert.match(french.retrievalQuery ?? '', /comment fonctionne un UTXO/);

  const english = planAliceTurn('Keep in mind that I am a beginner. How do UTXOs work?');
  assert.equal(english.requestedNote ?? null, null);
  assert.deepEqual(english.explicitMemoryCandidates, []);
  assert.equal(english.hasExplicitLearningDeclaration, true);
  assert.equal(english.retrievalQuery, 'How do UTXOs work?');
  assert.equal(english.kind, 'mixed');
});

test('a question inside the requested sentence is asked, not kept', () => {
  const plan = planAliceTurn('Retiens que je débute, mais comment fonctionne un UTXO ?');
  assert.equal(plan.requestedNote ?? null, null);
  assert.ok(!plan.explicitMemoryCandidates.some(candidate => candidate.category === 'requested-note'));
  assert.match(plan.retrievalQuery ?? '', /comment fonctionne un UTXO/);
});

test('a remember request that carries a learning declaration still flags it', () => {
  const plan = planAliceTurn('Souviens-toi que je débute avec Lightning.');
  assert.equal(plan.requestedNote?.text, 'je débute avec Lightning');
  assert.equal(plan.requestedNote?.standalone, true);
  assert.equal(plan.hasExplicitLearningDeclaration, true);
  assert.equal(plan.kind, 'personal-statement');
});

test('a remember request about the world, not the user, is an ordinary turn', () => {
  const plan = planAliceTurn('Remember that the halving happens every four years.');
  assert.equal(plan.requestedNote ?? null, null);
  assert.deepEqual(plan.explicitMemoryCandidates, []);
  assert.notEqual(plan.kind, 'personal-statement');
});

test('the confirmation reflects what the store holds afterwards', () => {
  const memory = { ...createAliceMemory(), items: [{ id: 'memory-note', category: 'requested-note' as const, text: 'I like diagrams', createdDay: '2026-10-06', updatedDay: '2026-10-06' }] };
  const kept = { memory, saved: true };
  assert.equal(directRequestedNoteResponse(kept, 'I like diagrams', 'en'), 'Noted: I like diagrams');
  assert.equal(directRequestedNoteResponse(kept, 'I like diagrams', 'fr'), 'Retenu : I like diagrams');
  assert.match(directRequestedNoteResponse({ memory: { ...memory, enabled: false }, saved: true }, 'I like diagrams', 'fr'), /désactivée/);
  assert.match(directRequestedNoteResponse({ memory: { ...memory, enabled: false }, saved: true }, 'I like diagrams', 'en'), /turned off/);
  assert.match(directRequestedNoteResponse({ memory: { ...memory, pausedCategories: ['requested-note'] }, saved: true }, 'I like diagrams', 'fr'), /en pause/);
  assert.match(directRequestedNoteResponse({ memory: { ...memory, pausedCategories: ['requested-note'] }, saved: true }, 'I like diagrams', 'en'), /paused/);
  assert.match(directRequestedNoteResponse({ memory, saved: false }, 'I like diagrams', 'fr'), /n'a pas pu enregistrer/);
  assert.match(directRequestedNoteResponse({ memory, saved: false }, 'I like diagrams', 'en'), /could not save/);
  assert.match(directRequestedNoteResponse({ memory: createAliceMemory(), saved: true }, 'I like diagrams', 'en'), /could not save/);
});
