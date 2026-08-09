import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectExplicitResponseLanguage,
  detectTextLanguage,
  isResponseLanguageAcceptable,
  resolveResponseLanguage,
} from './language-policy.ts';

test('detects ordinary French and English questions', () => {
  assert.equal(detectTextLanguage("Qu'est-ce que le proof of work et pourquoi est-il utile ?")?.language, 'fr');
  assert.equal(detectTextLanguage('What is proof of work and why does Bitcoin need it?')?.language, 'en');
});

test('detects short acknowledgements early enough for safe streaming', () => {
  assert.equal(detectTextLanguage("Got it, I'll keep my replies concise.")?.language, 'en');
  assert.equal(detectTextLanguage("Compris, je vais garder mes réponses concises.")?.language, 'fr');
});

test('ignores code and URLs while detecting a response language', () => {
  assert.equal(detectTextLanguage('Please explain `const langue = "francais"` from https://example.fr')?.language, 'en');
});

test('explicit language request wins over the language of the question', () => {
  assert.equal(detectExplicitResponseLanguage('What is Ark ? Réponds-moi en français.'), 'fr');
  assert.equal(resolveResponseLanguage({
    message: 'Explique-moi Ark, but answer in English.',
    preference: 'fr',
  }).targetLanguage, 'en');
});

test('pinned preference wins when there is no explicit request', () => {
  const decision = resolveResponseLanguage({
    message: 'What is Bitcoin?',
    preference: 'fr',
  });
  assert.deepEqual(decision, { targetLanguage: 'fr', source: 'preference', confidence: 1 });
});

test('short ambiguous follow-up never reads conversation history', () => {
  const decision = resolveResponseLanguage({
    message: 'Ark?',
    preference: 'auto',
    interfaceLanguage: 'fr-FR',
  });
  assert.equal(decision.targetLanguage, 'fr');
  assert.equal(decision.source, 'interface');
});

test('interface locale is only the final fallback', () => {
  assert.equal(resolveResponseLanguage({ message: 'UTXO?', interfaceLanguage: 'fr-FR' }).targetLanguage, 'fr');
  assert.equal(resolveResponseLanguage({ message: 'UTXO?', interfaceLanguage: 'en-US' }).targetLanguage, 'en');
});

test('rejects a clear wrong-language response but accepts technical fragments', () => {
  assert.equal(isResponseLanguageAcceptable('Bitcoin est un reseau monetaire ouvert qui permet de transferer de la valeur.', 'en'), false);
  assert.equal(isResponseLanguageAcceptable('Bitcoin is an open monetary network that lets people transfer value.', 'en'), true);
  assert.equal(isResponseLanguageAcceptable('UTXO: txid:vout', 'fr'), true);
});

test('quoted source text does not override the language of the answer', () => {
  const answer = 'The source says: « Bitcoin est un reseau monetaire ouvert qui permet de transferer de la valeur. » This explains why users can verify the rules.';
  assert.equal(isResponseLanguageAcceptable(answer, 'en'), true);
});
