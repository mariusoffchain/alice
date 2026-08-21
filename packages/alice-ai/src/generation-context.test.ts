import assert from 'node:assert/strict';
import test from 'node:test';
import { composeGenerationHistory } from './generation-context.ts';
import { createPedagogicalProfile, pedagogicalContext, updatePedagogicalProfile } from './pedagogical-profile-core.ts';

test('keeps the user message raw and inserts transient RAG as a system turn', () => {
  const rawQuestion = 'What is Ark?';
  const result = composeGenerationHistory(
    [
      { role: 'user', content: 'What is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a monetary network.' },
      { role: 'user', content: rawQuestion },
    ],
    { ragContext: 'Ark est un protocole Bitcoin.', localContext: null, learnContext: null },
    'The user is new to Ark.',
  );

  assert.equal(result.at(-1)?.content, rawQuestion);
  assert.equal(result.at(-1)?.role, 'user');
  assert.equal(result.at(-2)?.role, 'system');
  assert.match(result.at(-2)?.content ?? '', /Ark est un protocole Bitcoin/);
  assert.doesNotMatch(result.at(-1)?.content ?? '', /Retrieved knowledge/);
});

test('does not persist internal context into later raw history', () => {
  const raw = [{ role: 'user' as const, content: 'Pourquoi ?' }];
  composeGenerationHistory(raw, { ragContext: 'private note', localContext: 'summary', learnContext: null }, 'beginner');
  assert.deepEqual(raw, [{ role: 'user', content: 'Pourquoi ?' }]);
});

test('the outbound system turn receives a derived teaching instruction, never the profile document', () => {
  const question = 'How does Lightning routing work?';
  const profile = updatePedagogicalProfile(createPedagogicalProfile(), question, new Date(2026, 7, 7));
  const result = composeGenerationHistory(
    [{ role: 'user', content: question }],
    { ragContext: null, localContext: null, learnContext: null },
    pedagogicalContext(profile, question),
  );

  const system = result.at(-2)?.content ?? '';
  for (const field of ['explorationSignals', 'lastActiveDay', 'updatedDay']) {
    assert.equal(system.includes(field), false, field);
  }
  assert.equal(system.includes(JSON.stringify(profile)), false);
  assert.match(system, /Current concepts: lightning-basics, lightning-routing/);
});

// Under E2EE, assistant turns cannot be sent in their native role because
// Venice would leave them in plaintext. Old user turns must not remain as a
// list of apparently unanswered requests.
const MIXED_SESSION = [
  { role: 'user' as const, content: 'What is Bitcoin?' },
  { role: 'assistant' as const, content: 'Bitcoin is a monetary network.' },
  { role: 'user' as const, content: 'Quelle est la difference entre UTXO et vTXO ?' },
  { role: 'assistant' as const, content: 'Un UTXO et un vTXO...' },
  { role: 'user' as const, content: "why can't I share my seed phrase?" },
];

test('an autonomous E2EE question drops every completed earlier turn', () => {
  const result = composeGenerationHistory(
    MIXED_SESSION,
    { ragContext: null, localContext: null, learnContext: null },
    '',
    true,
  );

  assert.deepEqual(result, [
    { role: 'user', content: "why can't I share my seed phrase?" },
  ]);
});

test('a contextual E2EE follow-up keeps only the last completed exchange in an encrypted role', () => {
  const followUp = [
    ...MIXED_SESSION.slice(0, -1),
    { role: 'user' as const, content: 'Can you explain that further?' },
  ];
  const result = composeGenerationHistory(
    followUp,
    { ragContext: null, localContext: null, learnContext: null },
    '',
    true,
    '',
    '',
    '',
    true,
  );

  assert.deepEqual(result.map(message => message.role), ['user', 'system', 'user']);
  assert.match(result[0]?.content ?? '', /Quelle est la difference entre UTXO et vTXO/);
  assert.match(result[0]?.content ?? '', /Un UTXO et un vTXO/);
  assert.doesNotMatch(result[0]?.content ?? '', /Bitcoin is a monetary network/);
  assert.match(result[1]?.content ?? '', /completed exchange/);
  assert.equal(result.at(-1)?.content, 'Can you explain that further?');
  assert.equal(result.some(message => message.role === 'assistant'), false);
});

test('keeps the ordinary history when the backend can preserve assistant turns', () => {
  const result = composeGenerationHistory(
    MIXED_SESSION,
    { ragContext: 'Une seed phrase controle les fonds.', localContext: null, learnContext: null },
    '',
    false,
  );
  assert.equal(result.some(message => message.role === 'assistant'), true);
  assert.equal(result.filter(message => message.role === 'user').length, 3);
  assert.doesNotMatch(result.at(-2)?.content ?? '', /completed exchange/);
});

test('does not invent private conversation context on the first question', () => {
  const result = composeGenerationHistory(
    [{ role: 'user' as const, content: 'What is Bitcoin?' }],
    { ragContext: 'Bitcoin is a monetary network.', localContext: null, learnContext: null },
    '',
    true,
  );
  assert.doesNotMatch(result.at(-2)?.content ?? '', /completed exchange/);
});
