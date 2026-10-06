import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteRetrievalQuery } from './rag-query-rewrite.ts';
import { planAliceTurn } from './turn-planner.ts';

function query(current: string, previous: string[] = ['What is PayJoin?']): string | null {
  const history = previous.flatMap(content => [
    { role: 'user' as const, content },
    { role: 'assistant' as const, content: 'Previous answer.' },
  ]);
  return rewriteRetrievalQuery({
    history: [...history, { role: 'user', content: current }],
    userMessage: current, plan: planAliceTurn(current),
  });
}

test('mixed current follow-ups never put the personal clause in the retrieval query', () => {
  const value = query('I am building a confidential project. Can you explain that more?');
  assert.equal(value, 'What is PayJoin?');
});

test('a personal exchange is a context boundary for a later ambiguous why', () => {
  assert.doesNotMatch(query('Why?', ['What is PayJoin?', 'I prefer detailed answers.']) ?? '', /PayJoin/);
  assert.doesNotMatch(query('Pourquoi ?', ['What is PayJoin?', 'Que sais-tu de moi ?']) ?? '', /PayJoin/);
});

test('French accent and apostrophe variants keep a contextual reference', () => {
  for (const question of ['Comment ça marche ?', 'Comment cela fonctionne ?', 'Dis-m’en plus', 'Peux-tu expliquer davantage ?']) {
    assert.match(query(question) ?? '', /PayJoin/, question);
  }
});

test('enumerated cases and implicit comparisons refer back to the previous answer', () => {
  for (const question of ['Et pour le second cas ?', 'What about the second case?', 'Et par rapport à Ark ?', 'Quelle différence avec Ark ?']) {
    assert.match(query(question) ?? '', /PayJoin/, question);
  }
});

test('a short named subject is searched without conversational filler', () => {
  for (const question of ['Et Ark alors ?', 'And Ark?', 'What about Ark?']) {
    assert.equal(query(question)?.toLowerCase(), 'ark');
  }
});

test('short learning declarations remain outside retrieval', () => {
  for (const question of ['Je débute avec Bitcoin.', 'Je connais les UTXO.']) {
    assert.equal(query(question), null, question);
  }
});

test('explicit requests for an example and an explanation preserve the subject', () => {
  for (const question of ['Donne un exemple', 'Give me an example', 'Show me how', 'Montre-moi comment', 'Explique encore']) {
    assert.match(query(question) ?? '', /PayJoin/, question);
  }
});


test('a new subject owns its local pronoun while an anaphoric relation keeps both subjects', () => {
  const current = 'Et sur Ark, les frais ça fonctionne comment ?';
  assert.equal(query(current, ['How do Lightning fees work?']), current);
  assert.match(query('Et ça marche avec Ark ?', ['What is Lightning?']) ?? '', /Lightning[\s\S]*ark/i);
  const autonomous = 'How does RBF work when it replaces a transaction?';
  assert.equal(query(autonomous, ['What is Lightning?']), autonomous);
  assert.match(query('Pourquoi ?', ['What is Lightning?', current]) ?? '', /Ark/);
  assert.doesNotMatch(query('Pourquoi ?', ['What is Lightning?', current]) ?? '', /Lightning/);
});

test('social and memory turns remain outside retrieval after a technical exchange', () => {
  for (const current of ["Au fait, comment vas-tu aujourd'hui ?", 'Can you remember my name for next time?']) assert.equal(query(current), null);
  assert.equal(query('Hi, how are you? Explain RBF.'), 'Explain RBF.');
});
