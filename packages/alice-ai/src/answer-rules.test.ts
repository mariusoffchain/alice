import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANSWER_RULES,
  ANSWER_RULES_MAX_CHARS,
  NEVER_CLAIM_CHECKS,
  answerRuleCorrectionsIn,
  answerRuleNoteIdsIn,
  answerRuleNoteIdsInMessages,
  answerRulesBlock,
  withAnswerRuleCorrections,
} from './answer-rules.ts';
import { knowledgeContextCharLimit } from './knowledge-context-budget.ts';
import { LOCAL_CONTEXT_TOKENS, LOCAL_MIN_RESPONSE_TOKENS, fitMessagesToEstimatedLocalContext } from './local-context-budget.ts';
import type { Message } from './llm.ts';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

const ARK = ['asp-operator', 'ark-rounds-exits'];
const RBF = ['replace-by-fee', 'transaction-finality'];
const MULTISIG = ['multisig'];
const COMBINATIONS = [
  ['ark-rounds-exits'], ['asp-operator'], ['asp-operator', 'ark-rounds-exits'], ['ark-rounds-exits', 'asp-operator'],
  ['multisig'], ['replace-by-fee'], ['transaction-finality'], ['replace-by-fee', 'transaction-finality'],
];

const retrievedText = (...titles: string[]) => titles.map(title => `Topic: ${title}\nLevel: advanced\nNotes: text`).join('\n\n');

test('the instruction block states the mandatory points of the notes in context, once, in the turn language', () => {
  const en = answerRulesBlock(['asp-operator', 'ark-rounds-exits'], 'en');
  assert.ok(en.startsWith('[Answer rules]\n'));
  assert.match(en, /^State:$/m);
  assert.match(en, /^Never claim:$/m);
  assert.match(en, /unilateral exit without the operator/);
  assert.match(en, /refreshed or exited before its expiry/);
  // Shared sentences of the two Ark notes appear a single time.
  assert.equal(en.split('from the exit data the wallet keeps').length, 2);
  const fr = answerRulesBlock(['replace-by-fee', 'transaction-finality'], 'fr');
  assert.match(fr, /^À dire :$/m);
  assert.match(fr, /full-RBF, comportement par défaut de Bitcoin Core depuis la version 28\.0/);
  assert.match(fr, /N'envoie jamais un second paiement indépendant/);
  assert.equal(fr, answerRulesBlock(['replace-by-fee'], 'fr'), 'the finality note adds no line to the RBF note');
  const multisig = answerRulesBlock(['multisig'], 'en');
  assert.match(multisig, /a 2-of-3 wallet spends with any two of its three keys/);
  assert.match(multisig, /that a 2-of-3 wallet needs three signatures or the third seed/);
  assert.equal(answerRulesBlock([], 'en'), '');
  assert.equal(answerRulesBlock(['bitcoin-basics', 'lightning-introduction'], 'fr'), '');
});

test('every block fits its budget and a worst-case local prompt still leaves room for the answer', () => {
  for (const ids of COMBINATIONS) {
    for (const language of ['en', 'fr'] as const) {
      const block = answerRulesBlock(ids, language);
      assert.ok(block.length > 0 && block.length <= ANSWER_RULES_MAX_CHARS, `${ids.join('+')} ${language}: ${block.length}`);
    }
  }
  // Under a tighter budget the never-claim lines give way first; the block never comes back empty while a point fits.
  const tight = answerRulesBlock(['asp-operator', 'ark-rounds-exits'], 'fr', 700);
  assert.ok(tight.length > 0 && tight.length <= 700);
  assert.match(tight, /^À dire :$/m);
  assert.doesNotMatch(tight, /^À ne jamais affirmer :$/m);
  assert.equal(answerRulesBlock(['multisig'], 'en', 50), '');
  // Leading policy, a context message at the local knowledge cap plus the largest block, reminder and question.
  const largest = Math.max(...COMBINATIONS.flatMap(ids => (['en', 'fr'] as const).map(language => answerRulesBlock(ids, language).length)));
  const messages: Message[] = [
    { role: 'system', content: 'p'.repeat(4800) },
    { role: 'system', content: `[Retrieved knowledge]\n${'n'.repeat(knowledgeContextCharLimit(true))}\n\n[Pedagogical context]\n${'c'.repeat(300)}\n\n${'r'.repeat(largest)}` },
    { role: 'system', content: 'o'.repeat(420) },
    { role: 'user', content: 'q'.repeat(200) },
  ];
  const fitted = fitMessagesToEstimatedLocalContext(messages, 1024, LOCAL_CONTEXT_TOKENS);
  assert.equal(fitted.messages.length, messages.length, 'no application context is dropped');
  assert.ok(fitted.responseTokens >= LOCAL_MIN_RESPONSE_TOKENS);
});

test('user-facing rule text carries no em dash and no digit that could read as a live value', () => {
  for (const rule of ANSWER_RULES) {
    for (const language of ['en', 'fr'] as const) {
      for (const line of [...rule.mustState[language], ...rule.neverClaim[language]]) assert.doesNotMatch(line, /[—–]/, line);
    }
  }
  for (const check of NEVER_CLAIM_CHECKS) {
    for (const language of ['en', 'fr'] as const) {
      assert.doesNotMatch(check.correction[language], /[—–]/, check.id);
      assert.doesNotMatch(check.correction[language], /\bsat\/vb\b|\d+ sats?\b/i, check.id);
    }
  }
  for (const language of ['en', 'fr'] as const) assert.doesNotMatch(answerRulesBlock(['multisig'], language), /[—–]/);
});

test('the rule notes are read from the retrieved text, in retrieval order, and from the system turns of a history', () => {
  assert.deepEqual(answerRuleNoteIdsIn(retrievedText('Ark operator / ASP', 'Ark introduction')), ['asp-operator']);
  assert.deepEqual(answerRuleNoteIdsIn(retrievedText('Bitcoin finality', 'Replace-by-fee')), ['transaction-finality', 'replace-by-fee']);
  assert.deepEqual(answerRuleNoteIdsIn('Topic: Bitcoin multisig\nLevel: intermediate\nNotes: x'), ['multisig']);
  assert.deepEqual(answerRuleNoteIdsIn('Notes: the Ark operator / ASP coordinates rounds'), [], 'a mention inside a note body is not the note');
  assert.deepEqual(answerRuleNoteIdsIn(''), []);
  assert.deepEqual(answerRuleNoteIdsInMessages([
    { role: 'system', content: 'policy' },
    { role: 'user', content: 'Topic: Bitcoin multisig' },
    { role: 'system', content: `[Retrieved knowledge]\n${retrievedText('Ark rounds and exits')}` },
    { role: 'user', content: 'question' },
  ]), ['ark-rounds-exits'], 'a user turn cannot activate a rule');
});

// Verbatim sentences from the 2026-10-06 reviews (Qwen3.5 9B and Private Cloud).
const WRONG_CLAIMS: [string, string, string[], string][] = [
  ['en', 'If the operator stops cooperating, it may refuse to process new transactions or validate existing ones, effectively locking your ability to exit the off-chain network until the situation resolves.', ARK, 'ark-operator-blocks-exit'],
  ['en', 'If the operator disappears, your funds are gone.', ARK, 'ark-funds-lost'],
  ['en', 'Once the vTXO expires, it becomes recoverable on-chain even without the operator.', ARK, 'ark-expiry-inverted'],
  ['en', 'No, having two seed phrases is not enough to recover your coins if your setup requires a "2-of-3" multisig threshold.', MULTISIG, 'multisig-quorum-inflated'],
  ['en', 'If you only have two seeds and the wallet requires three signatures, the transaction cannot be signed, and the funds remain locked.', MULTISIG, 'multisig-quorum-inflated'],
  ['en', 'Would you like help with restoring the wallet in Alice, learning how to locate or recreate the descriptor, or tips on backing up the remaining seed securely?', MULTISIG, 'multisig-alice-capability'],
  ['en', 'Replacement works only if RBF was enabled when you sent the transaction.', RBF, 'rbf-opt-in-precondition'],
  ['en', 'If you need a faster confirmation, check whether your wallet offers a fee‑bump or “accelerate” option; otherwise you may need to wait for the original transaction to confirm or create a new transaction with fresh inputs.', RBF, 'rbf-second-payment'],
  ['fr', 'Si vous tentez de vous retirer de son système hors chaîne, il peut refuser de traiter votre demande de sortie.', ARK, 'ark-operator-blocks-exit'],
  ['fr', "Si l'opérateur ferme ses portes ou décide de ne plus traiter les virements, vous restez coincé jusqu'à ce que la solution soit trouvée ou que le cycle expire.", ARK, 'ark-operator-blocks-exit'],
  ['fr', 'Retenir indéfiniment un vTXO : à l’expiration, le vTXO devient récupérable sur la chaîne principale, même sans l’opérateur.', ARK, 'ark-expiry-inverted'],
  ['fr', 'Non, avoir 2 de vos 3 seeds ne suffit généralement pas pour récupérer vos bitcoins dans une configuration multisig 3 de 3.', MULTISIG, 'multisig-quorum-inflated'],
  ['fr', "Pour qu'une wallet multisig fonctionne, il faut atteindre un seuil de validation précis : dans votre cas, il faut 3 signatures valides sur 3 clés autorisées.", MULTISIG, 'multisig-quorum-inflated'],
  ['fr', 'Importer vos deux seeds dans Alice Wallet pour créer le portefeuille 2‑sur‑3 et préparer une transaction de récupération.', MULTISIG, 'multisig-alice-capability'],
  ['fr', "Cette méthode ne fonctionne que si le réseau accepte le remplacement de votre transaction spécifique (selon sa politique de relais) et que vous avez signalé l'option RBF.", RBF, 'rbf-opt-in-precondition'],
  ['fr', "Si le paiement était déjà très rapide ou si l'option n'était pas activée, le remplacement peut être impossible.", RBF, 'rbf-opt-in-precondition'],
  ['fr', 'Si RBF n’est pas activé : vous ne pouvez pas remplacer la transaction.', RBF, 'rbf-opt-in-precondition'],
];

const RIGHT_CLAIMS: [string, string, string[]][] = [
  ['en', 'However, it cannot move your funds without your explicit signature, nor can it prevent you from exiting the system unilaterally.', ARK],
  ['en', 'Your ability to exit remains available even if the operator decides to withdraw support, though the cost or delay of that exit may increase.', ARK],
  ['en', 'Your funds are not gone if an Ark operator disappears.', ARK],
  ['en', 'A vTXO that approaches its expiry must be refreshed or exited before that deadline or its value returns to the operator.', ARK],
  ['en', 'Also, attempting to send a new payment to the same address as a substitute is not a valid replacement and could result in losing funds.', RBF],
  ['en', 'Nodes that follow the opt‑in rule will only consider replacements for transactions that carry this flag.', RBF],
  ['en', 'Use a small test transaction when sending to a new address for the first time.', RBF],
  ['en', 'In a 2‑of‑3 setup you need any two of the three keys; in a 3‑of‑3 you need all three.', MULTISIG],
  ['en', 'If the wallet is a 3‑of‑3 scheme, two seeds are not enough—you’d need the third seed (or the missing private key) to meet the required threshold.', MULTISIG],
  ['en', 'Two seeds alone are not enough in a 2-of-3 without the descriptor that holds the third public key.', MULTISIG],
  ['fr', "Ce que l'opérateur **ne peut pas faire** est d'accéder à votre argent sans votre accord, de bloquer votre sortie unilatéralement ou d'annuler une transaction validée.", ARK],
  ['fr', 'Non, vos fonds ne sont pas perdus.', ARK],
  ['fr', "Un vTXO doit être rafraîchi ou sorti avant son expiration, sinon sa valeur revient à l'opérateur.", ARK],
  ['fr', "Il ne faut pas envoyer un second paiement à la même adresse pour tenter de compenser l'erreur.", RBF],
  ['fr', 'Le signalage améliore la prévisibilité, mais n’est pas une condition indispensable partout.', RBF],
  ['fr', 'Je vous recommande de vérifier si votre wallet utilise un seuil différent, par exemple 2 de 3, ou si vous avez une clé de secours spécifique pour cette troisième signature.', MULTISIG],
  ['fr', 'Vous ne devez jamais envoyer vos seeds ou fragments de clés par chat ou à un agent de support.', MULTISIG],
];

test('the never-claim checks catch the recorded wrong sentences, in French and in English', () => {
  for (const [language, sentence, notes, expected] of WRONG_CLAIMS) {
    const result = withAnswerRuleCorrections(sentence, language as 'en' | 'fr', notes);
    assert.deepEqual(result.applied, [expected], sentence);
    const correction = NEVER_CLAIM_CHECKS.find(check => check.id === expected)!.correction[language as 'en' | 'fr'];
    assert.ok(result.text.endsWith(correction), sentence);
    assert.ok(result.text.startsWith(sentence));
  }
});

test('the checks leave the recorded correct sentences and the deterministic replies alone', () => {
  for (const [language, sentence, notes] of RIGHT_CLAIMS) {
    const result = withAnswerRuleCorrections(sentence, language as 'en' | 'fr', notes);
    assert.deepEqual(result.applied, [], sentence);
    assert.equal(result.text, sentence);
  }
  // The correction sentences themselves never trigger a check.
  for (const check of NEVER_CLAIM_CHECKS) {
    for (const language of ['en', 'fr'] as const) {
      assert.deepEqual(withAnswerRuleCorrections(`Answer. ${check.correction[language]}`, language, [...ARK, ...RBF, ...MULTISIG]).applied, []);
    }
  }
});

test('a check runs only for the notes in context and defers to a threshold the user stated', () => {
  const inflated = 'If you only have two seeds and the wallet requires three signatures, the transaction cannot be signed.';
  assert.deepEqual(withAnswerRuleCorrections(inflated, 'en', RBF).applied, []);
  assert.deepEqual(withAnswerRuleCorrections(inflated, 'en', []).applied, []);
  assert.deepEqual(withAnswerRuleCorrections(inflated, 'en', MULTISIG, 'I have 2 of my 3 multisig seeds. Is that enough?').applied, ['multisig-quorum-inflated']);
  assert.deepEqual(withAnswerRuleCorrections(inflated, 'en', MULTISIG, 'My wallet is a 3-of-3 and I hold two seeds.').applied, []);
  assert.deepEqual(withAnswerRuleCorrections('Dans votre cas, il faut 3 signatures sur 3.', 'fr', MULTISIG, "J'ai un multisig 3 de 3.").applied, []);
});

test('corrections are appended once, in the answer language, and survive a second pass', () => {
  const answer = "Si l'option n'était pas activée, le remplacement est impossible.\n\nIl ne faut pas envoyer un second paiement.";
  const once = withAnswerRuleCorrections(answer, 'fr', RBF);
  assert.deepEqual(once.applied, ['rbf-opt-in-precondition']);
  assert.match(once.text, /\n\nCorrection : le remplacement n'exige pas/);
  const twice = withAnswerRuleCorrections(once.text, 'fr', RBF);
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.applied, []);
  assert.deepEqual(answerRuleCorrectionsIn(once.text), [NEVER_CLAIM_CHECKS.find(check => check.id === 'rbf-opt-in-precondition')!.correction.fr]);
  // Two different claims get two corrections; two checks sharing a correction add it once.
  const two = withAnswerRuleCorrections('Replacement works only if RBF was enabled. Otherwise create a new transaction with fresh inputs.', 'en', RBF);
  assert.deepEqual(two.applied, ['rbf-opt-in-precondition', 'rbf-second-payment']);
  const shared = withAnswerRuleCorrections('If the operator disappears, your funds are gone, and the operator can block your exit.', 'en', ARK);
  assert.deepEqual(shared.applied, ['ark-operator-blocks-exit']);
  assert.equal(shared.text.split('Correction:').length, 2);
  assert.equal(withAnswerRuleCorrections('', 'en', ARK).text, '');
});

test('every rule names a note of the shipped corpus by its exact title, and a real retrieval activates it', async () => {
  const runtime = await loadRagEvaluationRuntime(`
    export { loadRagCorpus, retrieveContext } from './packages/alice-ai/src/rag.ts';
    export { getAllChunks } from './packages/alice-ai/src/knowledge-packs.ts';
  `);
  await runtime.loadRagCorpus();
  const chunks: { id: string; title: string }[] = runtime.getAllChunks();
  for (const rule of ANSWER_RULES) {
    const chunk = chunks.find(candidate => candidate.id === rule.noteId);
    assert.ok(chunk, rule.noteId);
    assert.equal(chunk.title, rule.title, rule.noteId);
  }
  const context: string | null = runtime.retrieveContext('Que peut faire un opérateur Ark avec mon argent, et que ne peut-il pas faire ?', { targetLanguage: 'fr', maxChunks: 2 });
  assert.ok(context);
  assert.ok(answerRuleNoteIdsIn(context).includes('asp-operator'));
  const multisig: string | null = runtime.retrieveContext('I have 2 of my 3 multisig seeds. Is that enough to recover my coins?', { targetLanguage: 'en', maxChunks: 2 });
  assert.ok(multisig);
  assert.deepEqual(answerRuleNoteIdsIn(multisig), ['multisig']);
});

test('review probes: another quorum, refutations, questions, quotes and wallet limitations do not fire', () => {
  // 1. A quorum of three or more names another wallet than the user's 2-of-3.
  const probeQuestion = 'I have a 3-of-5 multisig and hold two seeds. Is that enough?';
  assert.deepEqual(withAnswerRuleCorrections('Your 3-of-5 wallet needs three signatures, so two seeds are not enough.', 'en', MULTISIG, probeQuestion).applied, []);
  assert.deepEqual(withAnswerRuleCorrections('Votre portefeuille 3 sur 5 exige trois signatures, donc deux seeds ne suffisent pas.', 'fr', MULTISIG, "J'ai un multisig 3 sur 5 et deux seeds.").applied, []);
  // The sentence guard alone, without the question: a 3-of-5 example inside a 2-of-3 answer.
  assert.deepEqual(withAnswerRuleCorrections('By contrast, a 3-of-5 wallet requires three signatures from its five keys.', 'en', MULTISIG, 'I have 2 of my 3 multisig seeds. Is that enough to recover my coins?').applied, []);
  assert.deepEqual(withAnswerRuleCorrections('Un 4 de 7, lui, il faut quatre signatures.', 'fr', MULTISIG, "J'ai 2 de mes 3 seeds multisig.").applied, []);
  // A 3-of-3 asserted for a user who said 2-of-3 is still the claim.
  assert.deepEqual(withAnswerRuleCorrections('Dans votre cas, il faut 3 signatures valides sur 3 clés autorisées.', 'fr', MULTISIG, "J'ai 2 de mes 3 seeds multisig.").applied, ['multisig-quorum-inflated']);
  // 2. Questions, quoted claims and refutations repeat the claim without making it.
  for (const [language, sentence] of [
    ['en', 'Is it true that the operator can block my exit? No, it cannot.'],
    ['fr', "On entend souvent dire que l'opérateur peut bloquer la sortie, ce qui est faux."],
    ['en', '"The operator can block your exit" is a common myth.'],
    ['en', 'Many people fear that their funds are lost when the operator disappears, but that is not the case.'],
    ['fr', "« Après l'expiration, le vTXO devient récupérable » est une idée reçue."],
  ] as const) assert.deepEqual(withAnswerRuleCorrections(sentence, language, ARK).applied, [], sentence);
  // 3. A wallet that only shows its fee bump under opt-in is a wallet limitation, and adding inputs to a replacement is not a second payment.
  assert.deepEqual(withAnswerRuleCorrections('Some wallets only show the fee bump option if RBF was enabled when the transaction was sent.', 'en', RBF).applied, []);
  assert.deepEqual(withAnswerRuleCorrections('Your wallet may create a new transaction that adds other inputs while keeping the original ones.', 'en', RBF).applied, []);
  // The morning's claims still fire next to these probes.
  assert.deepEqual(withAnswerRuleCorrections('Replacement works only if the RBF option was enabled when you sent it.', 'en', RBF).applied, ['rbf-opt-in-precondition']);
  assert.deepEqual(withAnswerRuleCorrections('If the operator stops cooperating, it may refuse to process new transactions, effectively locking your ability to exit the network.', 'en', ARK).applied, ['ark-operator-blocks-exit']);
});
