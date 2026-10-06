import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from './llm.ts';
import { MAX_REWRITTEN_QUERY_CHARS, rewriteRetrievalQuery } from './rag-query-rewrite.ts';
import { planAliceTurn } from './turn-planner.ts';

const BITCOIN_EXCHANGE: Message[] = [
  { role: 'user', content: 'Explain what is Bitcoin?' },
  { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
];

/** The chat appends the current message to the history it hands over. */
function rewrite(previous: Message[], userMessage: string): string | null {
  return rewriteRetrievalQuery({
    history: [...previous, { role: 'user', content: userMessage }],
    userMessage,
    plan: planAliceTurn(userMessage),
  });
}

test('autonomous questions, greetings, personal statements and memory questions keep their plan', () => {
  assert.equal(rewrite(BITCOIN_EXCHANGE, 'How does Lightning routing work?'), 'How does Lightning routing work?');
  assert.equal(rewrite(BITCOIN_EXCHANGE, 'What is proof of work?'), 'What is proof of work?');
  assert.equal(rewrite(BITCOIN_EXCHANGE, 'Hello!'), null);
  assert.equal(rewrite(BITCOIN_EXCHANGE, 'I prefer concise answers.'), null);
  assert.equal(rewrite(BITCOIN_EXCHANGE, 'Je débute avec les UTXO.'), null);
  assert.equal(rewrite(BITCOIN_EXCHANGE, 'Que sais-tu de moi ?'), null);
});

test('generic FR/EN follow-ups search the subject of the previous question', () => {
  for (const followUp of [
    'Pourquoi ?',
    'Et pourquoi ?',
    'Comment ?',
    'Can you explain that more?',
    'Tell me more',
    'Développe',
    'Approfondis',
    'Dis-m’en plus',
  ]) {
    assert.equal(rewrite(BITCOIN_EXCHANGE, followUp), 'Explain what is Bitcoin?', followUp);
  }
});

test('an acknowledgement refers to the previous answer without ever searching', () => {
  for (const message of [
    'That makes sense.',
    'Thanks, that helps.',
    'Merci !',
    'Ok, je vois.',
  ]) {
    assert.equal(rewrite(BITCOIN_EXCHANGE, message), null, message);
  }
});

// Before this module, any follow-up inherited the previous raw user message, so
// "What about Lightning?" searched Bitcoin *and* Lightning and answered neither
// topic well. A follow-up that names its own subject is a topic change.
test('a short named topic change is retrieved on its own terms', () => {
  for (const [topicChange, subject] of [
    ['What about Lightning?', 'lightning'],
    ['Et les CoinJoin alors ?', 'coinjoin'],
    ['Qu’en est-il des frais ?', 'frais'],
  ]) {
    assert.equal(rewrite(BITCOIN_EXCHANGE, topicChange), subject, topicChange);
  }
});

test('a reference to the previous answer keeps the subject and adds what the follow-up names', () => {
  assert.equal(
    rewrite(BITCOIN_EXCHANGE, 'Et ça marche avec Ark ?'),
    'Explain what is Bitcoin?\nFollow-up topic: marche ark',
  );
  assert.equal(
    rewrite(BITCOIN_EXCHANGE, 'Is it compatible with Ark?'),
    'Explain what is Bitcoin?\nFollow-up topic: compatible ark',
  );
});

test('a mixed follow-up reads its question clause, never the personal sentence beside it', () => {
  const namedTopic = rewrite(BITCOIN_EXCHANGE, "I'm new to this. What about Lightning?");
  assert.equal(namedTopic, 'lightning');

  const inherited = rewrite(BITCOIN_EXCHANGE, "I'm new to this. Can you explain more?");
  assert.equal(inherited, 'Explain what is Bitcoin?');
  assert.doesNotMatch(inherited ?? '', /new to/i);
});

test('a generic follow-up after a topic change uses the latest subject', () => {
  const afterTopicChange: Message[] = [
    ...BITCOIN_EXCHANGE,
    { role: 'user', content: 'What about Lightning?' },
    { role: 'assistant', content: 'Lightning is a payment network on top of Bitcoin.' },
  ];

  assert.equal(rewrite(afterTopicChange, 'Pourquoi ?'), 'lightning');
  assert.equal(rewrite(afterTopicChange, 'Tell me more'), 'lightning');
});

test('an unrelated standalone question breaks the chain', () => {
  const afterStandalone: Message[] = [
    ...BITCOIN_EXCHANGE,
    { role: 'user', content: 'How does Lightning routing work?' },
    { role: 'assistant', content: 'Payments are forwarded along a path of channels.' },
  ];

  assert.equal(rewrite(afterStandalone, 'Tell me more'), 'How does Lightning routing work?');
});

test('repeated follow-ups keep reaching the subject instead of quoting each other', () => {
  const repeated: Message[] = [
    ...BITCOIN_EXCHANGE,
    { role: 'user', content: 'Can you explain that more?' },
    { role: 'assistant', content: 'More detail about Bitcoin.' },
    { role: 'user', content: 'Tell me more' },
    { role: 'assistant', content: 'Even more detail about Bitcoin.' },
  ];

  const query = rewrite(repeated, 'Et pourquoi ?');
  assert.equal(query, 'Explain what is Bitcoin?');
  assert.doesNotMatch(query ?? '', /Follow-up topic/);
});

test('a personal declaration or a memory question is never inherited', () => {
  const personalHistory: Message[] = [
    { role: 'user', content: 'I am building Alice Wallet. I prefer concise answers.' },
    { role: 'assistant', content: 'Got it.' },
    { role: 'user', content: 'Que sais-tu de moi ?' },
    { role: 'assistant', content: 'You are building Alice Wallet and prefer concise answers.' },
  ];

  const query = rewrite(personalHistory, 'Pourquoi ?');
  assert.equal(query, 'Pourquoi ?');
  assert.doesNotMatch(query ?? '', /Alice Wallet|concise|sais/i);
  // Nothing safe is left to continue, so the turn does not search at all.
  assert.equal(rewrite(personalHistory, 'Développe'), null);
});

test('a mixed turn contributes only its question clause', () => {
  const mixedHistory: Message[] = [
    { role: 'user', content: "I'm new to UTXOs. What is a change output?" },
    { role: 'assistant', content: 'A change output returns the remainder to you.' },
  ];

  const query = rewrite(mixedHistory, 'Pourquoi ?');
  assert.equal(query, 'What is a change output?');
  assert.doesNotMatch(query ?? '', /I'm new/);
});

test('assistant answers are never a retrieval source', () => {
  const history: Message[] = [
    { role: 'user', content: 'Explain what is Bitcoin?' },
    { role: 'assistant', content: 'Bitcoin settles on-chain, and CoinJoin can improve privacy.' },
  ];

  const query = rewrite(history, 'Tell me more');
  assert.equal(query, 'Explain what is Bitcoin?');
  assert.doesNotMatch(query ?? '', /CoinJoin|on-chain/);
});

test('the rewrite reads the history without mutating it', () => {
  const history: Message[] = [
    ...BITCOIN_EXCHANGE,
    { role: 'user', content: 'Pourquoi ?' },
  ];
  const snapshot = JSON.stringify(history);

  rewriteRetrievalQuery({ history, userMessage: 'Pourquoi ?', plan: planAliceTurn('Pourquoi ?') });

  assert.equal(JSON.stringify(history), snapshot);
});

test('a caller that has not appended the current message yet gets the same query', () => {
  assert.equal(
    rewriteRetrievalQuery({
      history: BITCOIN_EXCHANGE,
      userMessage: 'Pourquoi ?',
      plan: planAliceTurn('Pourquoi ?'),
    }),
    'Explain what is Bitcoin?',
  );
});

test('the inherited subject and the added topic are both bounded', () => {
  const longSubject = `Explain how ${'Lightning routing liquidity '.repeat(20)}?`;
  const longHistory: Message[] = [
    { role: 'user', content: longSubject },
    { role: 'assistant', content: 'A long answer.' },
  ];

  const inherited = rewrite(longHistory, 'Pourquoi ?') ?? '';
  assert.ok(inherited.length <= MAX_REWRITTEN_QUERY_CHARS, `${inherited.length}`);
  assert.ok(inherited.length < longSubject.length);
  assert.match(inherited, /^Explain how Lightning routing liquidity/);

  const longFollowUp = `Et ça marche avec ${'Ark Arkade vTXO mining privacy covenants '.repeat(5)}?`;
  const combined = rewrite(BITCOIN_EXCHANGE, longFollowUp) ?? '';
  const [anchor, topic] = combined.split('\n');
  assert.equal(anchor, 'Explain what is Bitcoin?');
  assert.ok(combined.length <= MAX_REWRITTEN_QUERY_CHARS, `${combined.length}`);
  assert.ok((topic ?? '').replace('Follow-up topic: ', '').split(' ').length <= 6);
});

test('the history walk stops instead of scanning an unbounded conversation', () => {
  const longChain: Message[] = [...BITCOIN_EXCHANGE];
  for (let turn = 0; turn < 6; turn++) {
    longChain.push({ role: 'user', content: 'Tell me more' });
    longChain.push({ role: 'assistant', content: `Detail ${turn}.` });
  }

  // The subject now sits further back than the scanned window: the rewrite
  // gives up rather than walking the whole conversation.
  assert.equal(rewrite(longChain, 'Pourquoi ?'), 'Pourquoi ?');
});

test('a follow-up with no earlier turn to inherit falls back to its own clause', () => {
  assert.equal(rewrite([], 'Pourquoi ?'), 'Pourquoi ?');
  assert.equal(rewrite([], 'Développe'), null);
});

test('a French "ça" refers back only as the subject of a short question', () => {
  const standalone = "Quand j'envoie des bitcoins est-ce que ça passe par une banque ?";
  assert.equal(rewrite(BITCOIN_EXCHANGE, standalone), standalone);
  assert.match(rewrite(BITCOIN_EXCHANGE, 'Comment ça fonctionne avec le multisig ?') ?? '', /^Explain what is Bitcoin\?\nFollow-up topic: .*multisig/);
});

test('an adverbial follow-up keeps the previous subject instead of becoming a topic change', () => {
  for (const message of ['Et concrètement ?', 'Et en pratique ?', 'And in practice?']) {
    const query = rewrite(BITCOIN_EXCHANGE, message) ?? '';
    assert.match(query, /^Explain what is Bitcoin\?/, message);
    assert.doesNotMatch(query, /concretement|pratique|practice/, message);
  }
});
