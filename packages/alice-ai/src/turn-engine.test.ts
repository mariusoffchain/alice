import assert from 'node:assert/strict';
import test from 'node:test';
import { createAliceMemory } from './alice-memory-core.ts';
import type { Message } from './llm.ts';
import { createPedagogicalProfile } from './pedagogical-profile-core.ts';
import { MAX_REWRITTEN_QUERY_CHARS } from './rag-query-rewrite.ts';
import { prepareAliceTurn, type TurnPreparationServices } from './turn-engine.ts';

function services(): TurnPreparationServices & { queries: string[]; remembered: string[] } {
  const queries: string[] = [];
  const remembered: string[] = [];
  return {
    queries,
    remembered,
    recordPedagogicalSignal: async () => createPedagogicalProfile(),
    retrieveKnowledge: async query => {
      queries.push(query);
      return {
        ragContext: `Knowledge for ${query}`,
        localContext: null,
        learnContext: null,
        diagnostics: [{ id: 'test-chunk' }],
      };
    },
    getMemory: async () => createAliceMemory(),
    rememberMemoryCandidates: async candidates => {
      remembered.push(...candidates.map(candidate => candidate.text));
      return { memory: createAliceMemory(), saved: true };
    },
    pedagogicalContext: () => 'teach the detected concept',
    memoryContext: () => '',
    memoryCaptureInstruction: 'capture',
  };
}

test('preference statements bypass retrieval and are remembered deterministically', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'I prefer concise answers.' }],
    userMessage: 'I prefer concise answers.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, ['Prefers concise answers']);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.equal(prepared.directResponse, "Got it. I'll take that into account.");
  assert.match(prepared.history.at(-2)?.content ?? '', /brief acknowledgement/);
  assert.doesNotMatch(prepared.history.at(-2)?.content ?? '', /teach the detected concept/);
});

test('a personal declaration never becomes a project introduction', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'I am building Alice Wallet. I prefer concise answers.' }],
    userMessage: 'I am building Alice Wallet. I prefer concise answers.',
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, fixture);

  const internal = prepared.history.at(-2)?.content ?? '';
  assert.match(internal, /brief acknowledgement/);
  assert.doesNotMatch(internal, /Knowledge for/);
  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.directResponse, "Got it. I'll take that into account.");
});

test('mixed turns retrieve only the question clause and keep raw user history', async () => {
  const fixture = services();
  const message = "I'm new to UTXOs. What is a change output?";
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: message }],
    userMessage: message,
    backendType: 'local',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, ['What is a change output?']);
  assert.equal(prepared.history.at(-1)?.content, message);
  assert.deepEqual(prepared.diagnostics.retrievedChunkIds, ['test-chunk']);
  assert.equal(prepared.directResponse, null);
});

test('personal acknowledgements are localized without a model call', async () => {
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Je débute avec les UTXO.' }],
    userMessage: 'Je débute avec les UTXO.',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, services());

  assert.equal(prepared.directResponse, "Compris. J'en tiendrai compte.");
});

test('stored personal memory is injected into every backend', async () => {
  const memory = {
    ...createAliceMemory(),
    items: [{
      id: 'memory-test',
      category: 'preference' as const,
      text: 'Prefers concise answers',
      createdDay: '2026-08-10',
      updatedDay: '2026-08-10',
    }],
  };
  const prepare = async (backendType: 'local' | 'cloud' | 'custom') => {
    const fixture = services();
    fixture.getMemory = async () => memory;
    fixture.memoryContext = value => `LOCAL MEMORY: ${value.items.map(item => item.text).join(', ')}`;
    return prepareAliceTurn({
      history: [{ role: 'user', content: 'What is proof of work?' }],
      userMessage: 'What is proof of work?',
      backendType,
      targetLanguage: 'en',
    }, fixture);
  };

  const local = await prepare('local');
  const cloud = await prepare('cloud');
  const custom = await prepare('custom');
  const localContext = local.history.map(message => message.content).join('\n');
  const cloudContext = cloud.history.map(message => message.content).join('\n');
  const customContext = custom.history.map(message => message.content).join('\n');

  // Both backends now. Memory used to ride on the local model only while the
  // capture instruction still went to the cloud: collected there, never
  // reused there. The cloud path is end-to-end encrypted to the enclave, so
  // showing the memory back adds nothing a cloud conversation had not
  // already accepted.
  assert.match(localContext, /LOCAL MEMORY: Prefers concise answers/);
  assert.match(cloudContext, /LOCAL MEMORY: Prefers concise answers/);
  assert.match(customContext, /LOCAL MEMORY: Prefers concise answers/);
});

test('a question about the user uses local memory without RAG or pedagogical context', async () => {
  const fixture = services();
  fixture.getMemory = async () => ({
    ...createAliceMemory(),
    items: [
      {
        id: 'memory-project',
        category: 'project',
        text: 'Working on Alice Wallet',
        createdDay: '2026-08-10',
        updatedDay: '2026-08-10',
      },
      {
        id: 'memory-preference',
        category: 'preference',
        text: 'Prefers concise answers',
        createdDay: '2026-08-10',
        updatedDay: '2026-08-10',
      },
    ],
  });
  fixture.memoryContext = memory => `LOCAL MEMORY: ${memory.items.map(item => item.text).join(', ')}`;
  fixture.pedagogicalContext = () => 'Proof of work profile context';

  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'What am I working on and how should you answer me?' }],
    userMessage: 'What am I working on and how should you answer me?',
    backendType: 'local',
    targetLanguage: 'en',
  }, fixture);
  const context = prepared.history.map(message => message.content).join('\n');

  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.match(context, /LOCAL MEMORY: Working on Alice Wallet, Prefers concise answers/);
  assert.doesNotMatch(context, /Proof of work profile context/);
  assert.match(context, /Do not add a Bitcoin topic/);
});

test('Private Cloud sends an autonomous question without completed earlier turns', async () => {
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Hi, how are you?' },
      { role: 'assistant', content: "I'm doing well, thanks for asking!" },
      { role: 'user', content: 'Explain what is Bitcoin?' },
    ],
    userMessage: 'Explain what is Bitcoin?',
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, services());

  assert.equal(prepared.plan.needsConversationContext, false);
  assert.equal(prepared.history.some(message => message.content.includes('how are you')), false);
  assert.equal(prepared.history.some(message => message.content.includes('doing well')), false);
  assert.equal(prepared.history.at(-1)?.content, 'Explain what is Bitcoin?');
});

test('a contextual follow-up searches with the previous user subject', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: 'Can you explain that more?' },
    ],
    userMessage: 'Can you explain that more?',
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, fixture);

  assert.deepEqual(fixture.queries, [
    'Explain what is Bitcoin?',
  ]);
  assert.equal(prepared.plan.needsConversationContext, true);
  assert.match(prepared.history[0]?.content ?? '', /Bitcoin is a decentralized monetary network/);
});

// This used to search "Explain what is Bitcoin?\nFollow-up topic: Lightning":
// the named topic change inherited the former subject, so the retrieved notes
// described Bitcoin while the user was asking about Lightning. A follow-up that
// names its own subject is now retrieved on its own terms; only a follow-up
// that points back at the previous answer still inherits it (rag-query-rewrite.ts).
test('a named topic change is retrieved without inheriting the former subject', async () => {
  const fixture = services();
  await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: 'What about Lightning?' },
    ],
    userMessage: 'What about Lightning?',
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, fixture);

  assert.deepEqual(fixture.queries, ['lightning']);
});

test('a follow-up referring to the previous answer keeps the subject and adds its topic', async () => {
  const fixture = services();
  await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: 'Et ça marche avec Ark ?' },
    ],
    userMessage: 'Et ça marche avec Ark ?',
    backendType: 'cloud',
    targetLanguage: 'fr',
    assistantHistoryDropped: true,
  }, fixture);

  assert.deepEqual(fixture.queries, ['Explain what is Bitcoin?\nFollow-up topic: marche ark']);
});

test('an explicit continuation without a question mark retrieves the previous subject', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: 'Développe' },
    ],
    userMessage: 'Développe',
    backendType: 'local',
    targetLanguage: 'fr',
  }, fixture);

  assert.deepEqual(fixture.queries, ['Explain what is Bitcoin?']);
  assert.equal(prepared.diagnostics.retrieval, 'lexical-or-semantic');
  assert.equal(prepared.plan.needsConversationContext, true);
  // The model still reads the message the user actually typed.
  assert.equal(prepared.history.at(-1)?.content, 'Développe');
  assert.equal(prepared.directResponse, null);
});

test('an acknowledgement stays a conversation turn and never searches', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: 'That makes sense.' },
    ],
    userMessage: 'That makes sense.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.doesNotMatch(prepared.history.map(message => message.content).join('\n'), /Knowledge for/);
});

test('the rewritten query does not depend on the backend', async () => {
  const queriesPerBackend: string[][] = [];
  for (const backendType of ['local', 'cloud', 'custom'] as const) {
    const fixture = services();
    await prepareAliceTurn({
      history: [
        { role: 'user', content: 'Explain what is Bitcoin?' },
        { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
        { role: 'user', content: 'Pourquoi ?' },
      ],
      userMessage: 'Pourquoi ?',
      backendType,
      targetLanguage: 'fr',
      assistantHistoryDropped: backendType === 'cloud',
    }, fixture);
    queriesPerBackend.push(fixture.queries);
  }

  assert.deepEqual(queriesPerBackend, [
    ['Explain what is Bitcoin?'],
    ['Explain what is Bitcoin?'],
    ['Explain what is Bitcoin?'],
  ]);
});

test('repeated follow-ups keep the subject without growing the query', async () => {
  const fixture = services();
  const history: Message[] = [
    { role: 'user', content: 'Explain what is Bitcoin?' },
    { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
  ];

  for (const followUp of ['Can you explain that more?', 'Tell me more', 'Et pourquoi ?', 'Développe']) {
    history.push({ role: 'user', content: followUp });
    await prepareAliceTurn({
      history: [...history],
      userMessage: followUp,
      backendType: 'cloud',
      targetLanguage: 'en',
      assistantHistoryDropped: true,
    }, fixture);
    history.push({ role: 'assistant', content: 'Another paragraph about Bitcoin.' });
  }

  assert.deepEqual(fixture.queries, [
    'Explain what is Bitcoin?',
    'Explain what is Bitcoin?',
    'Explain what is Bitcoin?',
    'Explain what is Bitcoin?',
  ]);
  for (const query of fixture.queries) {
    assert.ok(query.length <= MAX_REWRITTEN_QUERY_CHARS, query);
  }
});

test('an unrelated question breaks the chain and the earlier subject is dropped', async () => {
  const fixture = services();
  await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: 'How does Lightning routing work?' },
      { role: 'assistant', content: 'Payments are forwarded along a path of channels.' },
      { role: 'user', content: 'Tell me more' },
    ],
    userMessage: 'Tell me more',
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, fixture);

  assert.deepEqual(fixture.queries, ['How does Lightning routing work?']);
});

test('a follow-up never searches with a personal declaration or a memory question', async () => {
  const fixture = services();
  const history: Message[] = [
    { role: 'user', content: 'I am building Alice Wallet. I prefer concise answers.' },
    { role: 'assistant', content: 'Got it.' },
    { role: 'user', content: 'What do you know about me?' },
    { role: 'assistant', content: 'You are building Alice Wallet.' },
    { role: 'user', content: 'Pourquoi ?' },
  ];

  await prepareAliceTurn({
    history,
    userMessage: 'Pourquoi ?',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);

  assert.deepEqual(fixture.queries, ['Pourquoi ?']);
  assert.doesNotMatch(fixture.queries.join('\n'), /Alice Wallet|know about me/i);
});

test('the turn does not mutate the history it was given and keeps the query out of diagnostics', async () => {
  const fixture = services();
  const history: Message[] = [
    { role: 'user', content: 'Explain what is Bitcoin?' },
    { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
    { role: 'user', content: 'Pourquoi ?' },
  ];
  const snapshot = JSON.stringify(history);

  const prepared = await prepareAliceTurn({
    history,
    userMessage: 'Pourquoi ?',
    backendType: 'cloud',
    targetLanguage: 'fr',
    assistantHistoryDropped: true,
  }, fixture);

  assert.equal(JSON.stringify(history), snapshot);
  // Diagnostics are observable outside the enclave: they carry no user text.
  assert.doesNotMatch(JSON.stringify(prepared.diagnostics), /Pourquoi|Bitcoin/i);
});

// The rewrite must stay invisible to a turn that does not need it: same
// retrieval query, same internal context, same raw user message.
test('an autonomous question composes exactly the same prompt as before', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'What is proof of work?' }],
    userMessage: 'What is proof of work?',
    backendType: 'local',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, ['What is proof of work?']);
  assert.deepEqual(prepared.history, [
    {
      role: 'system',
      content: [
        '[Retrieved knowledge]',
        'Knowledge for What is proof of work?',
        '',
        '[Pedagogical context]',
        'teach the detected concept',
        '',
        '[Private memory protocol]',
        'capture',
      ].join('\n'),
    },
    { role: 'user', content: 'What is proof of work?' },
  ]);
});

test('an explicit live wallet-state request is answered deterministically without retrieval, pedagogy or memory', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: "What's my balance?" }],
    userMessage: "What's my balance?",
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.deepEqual(prepared.diagnostics.retrievedChunkIds, []);
  assert.equal(prepared.plan.walletStateReason, 'balance');
  assert.match(prepared.directResponse ?? '', /wallet/i);
  assert.doesNotMatch(prepared.directResponse ?? '', /send (?:me )?(?:your )?seed/i);
});

test('the French live wallet-state guard answers in French without retrieval', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Quel est mon solde ?' }],
    userMessage: 'Quel est mon solde ?',
    backendType: 'local',
    targetLanguage: 'fr',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.match(prepared.directResponse ?? '', /portefeuille/i);
});

test('a live wallet-state ask right after a technical history is still guarded, never reintroducing RAG', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: "What's my transaction history?" },
    ],
    userMessage: "What's my transaction history?",
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.plan.walletStateReason, 'transaction-history');
  assert.equal(prepared.diagnostics.retrieval, 'none');
});

test('mixed social and memory messages retrieve their technical clause and preserve raw generation input', async () => {
  for (const [message, expectedQuery] of [
    ['Hi, how are you? Explain RBF.', 'Explain RBF.'],
    ['Can you remember my name? What is Lightning?', 'What is Lightning?'],
    ['Can you remember my name for next time?', null],
    ['Do you remember I told you I prefer short, direct answers?', null],
  ] as const) {
    const fixture = services();
    const prepared = await prepareAliceTurn({
      history: [{ role: 'user', content: message }], userMessage: message,
      backendType: 'local', targetLanguage: 'en',
    }, fixture);
    assert.deepEqual(fixture.queries, expectedQuery ? [expectedQuery] : []);
    assert.deepEqual(fixture.remembered, []);
    assert.equal(prepared.directResponse, null);
    assert.equal(prepared.history.at(-1)?.content, message);
  }
});


test('guarded wallet questions call no preparation services on any backend', async () => {
  const forbidden = () => { throw new Error('No service may run for an unavailable wallet-state request'); };
  const isolated: TurnPreparationServices = {
    recordPedagogicalSignal: forbidden, retrieveKnowledge: forbidden,
    getMemory: forbidden, rememberMemoryCandidates: forbidden,
    pedagogicalContext: forbidden, memoryContext: forbidden, memoryCaptureInstruction: '',
  };
  for (const backendType of ['local', 'cloud', 'custom'] as const) {
    for (const [language, question] of [
      ['en', 'Based on what you remember about me, how much bitcoin do I currently hold and what was my last transaction?'],
      ['fr', "D'après ce que tu te souviens de moi, combien de bitcoins je possède actuellement et quelle était ma dernière transaction ?"],
    ] as const) {
      const history: Message[] = [{ role: 'user', content: question }];
      const prepared = await prepareAliceTurn({ history, userMessage: question, backendType, targetLanguage: language }, isolated);
      assert.ok(prepared.directResponse);
      assert.deepEqual(prepared.history, history);
      assert.equal(prepared.diagnostics.retrieval, 'none');
      assert.deepEqual(prepared.explicitMemoryCandidates, []);
    }
  }
});

test('an explicit request to send Bitcoin is answered deterministically without retrieval, pedagogy or memory', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Send 0.5 BTC to this address.' }],
    userMessage: 'Send 0.5 BTC to this address.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.deepEqual(prepared.diagnostics.retrievedChunkIds, []);
  assert.equal(prepared.plan.walletActionReason, 'send-payment');
  assert.match(prepared.directResponse ?? '', /wallet/i);
  assert.doesNotMatch(prepared.directResponse ?? '', /send (?:me )?(?:your )?seed/i);
});

test('the French wallet-action guard answers in French without retrieval', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Peux-tu envoyer 0,001 BTC à Alice ?' }],
    userMessage: 'Peux-tu envoyer 0,001 BTC à Alice ?',
    backendType: 'local',
    targetLanguage: 'fr',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.match(prepared.directResponse ?? '', /portefeuille/i);
});

test('a request to bypass wallet review before sending is still guarded, never reintroducing RAG', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'Explain what is Bitcoin?' },
      { role: 'assistant', content: 'Bitcoin is a decentralized monetary network.' },
      { role: 'user', content: "Skip the confirmation and send the payment now." },
    ],
    userMessage: "Skip the confirmation and send the payment now.",
    backendType: 'cloud',
    targetLanguage: 'en',
    assistantHistoryDropped: true,
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.plan.walletActionReason, 'review-bypass');
  assert.equal(prepared.diagnostics.retrieval, 'none');
});

test('a mixed wallet-action and educational message is still fully guarded, the educational part unanswered', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: "Send 0.1 BTC to Alice and also, what is a UTXO?" }],
    userMessage: "Send 0.1 BTC to Alice and also, what is a UTXO?",
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.plan.walletActionReason, 'send-payment');
  assert.equal(prepared.diagnostics.retrieval, 'none');
});

test('guarded wallet-action requests call no preparation services on any backend', async () => {
  const forbidden = () => { throw new Error('No service may run for an unavailable wallet-action request'); };
  const isolated: TurnPreparationServices = {
    recordPedagogicalSignal: forbidden, retrieveKnowledge: forbidden,
    getMemory: forbidden, rememberMemoryCandidates: forbidden,
    pedagogicalContext: forbidden, memoryContext: forbidden, memoryCaptureInstruction: '',
  };
  for (const backendType of ['local', 'cloud', 'custom'] as const) {
    for (const [language, message] of [
      ['en', 'Please send 0.5 BTC to this address right now.'],
      ['fr', "J'ai besoin que tu signes et envoies ce paiement."],
    ] as const) {
      const history: Message[] = [{ role: 'user', content: message }];
      const prepared = await prepareAliceTurn({ history, userMessage: message, backendType, targetLanguage: language }, isolated);
      assert.ok(prepared.directResponse);
      assert.deepEqual(prepared.history, history);
      assert.equal(prepared.diagnostics.retrieval, 'none');
      assert.deepEqual(prepared.explicitMemoryCandidates, []);
    }
  }
});

test('a wallet-action turn cannot become a topic anchor for a later continuation', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'What is Bitcoin?' },
      { role: 'assistant', content: 'An educational explanation.' },
      { role: 'user', content: 'Send 0.1 BTC to this address.' },
      { role: 'assistant', content: 'This chat cannot send funds on your behalf.' },
      { role: 'user', content: 'Tell me more' },
    ], userMessage: 'Tell me more', backendType: 'local', targetLanguage: 'en',
  }, fixture);
  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
});

test('a wallet-state turn cannot become a topic anchor for a later continuation', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [
      { role: 'user', content: 'What is Bitcoin?' },
      { role: 'assistant', content: 'An educational explanation.' },
      { role: 'user', content: 'What is my balance?' },
      { role: 'assistant', content: 'This chat cannot access your wallet balance.' },
      { role: 'user', content: 'Tell me more' },
    ], userMessage: 'Tell me more', backendType: 'local', targetLanguage: 'en',
  }, fixture);
  assert.deepEqual(fixture.queries, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
});

test('a present network value request is answered deterministically, without retrieval or memory', async () => {
  const { liveNetworkValueResponse } = await import('./live-network-request.ts');
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'What fee should I set right now to get confirmed in the next block?' }],
    userMessage: 'What fee should I set right now to get confirmed in the next block?',
    backendType: 'local',
    targetLanguage: 'en',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.equal(prepared.plan.liveNetworkReason, 'onchain-fee');
  assert.equal(prepared.directResponse, liveNetworkValueResponse('onchain-fee', 'en'));

  const french = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Quelle liquidité entrante ai-je actuellement sur Lightning ?' }],
    userMessage: 'Quelle liquidité entrante ai-je actuellement sur Lightning ?',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);
  assert.equal(french.directResponse, liveNetworkValueResponse('lightning-inbound', 'fr'));
  assert.deepEqual(fixture.queries, []);
});

// --- Explicit remember requests (session 1 of the user-memory plan) ---

test('an accepted remember request is written and confirmed without retrieval or a model call', async () => {
  const fixture = services();
  fixture.rememberMemoryCandidates = async candidates => {
    fixture.remembered.push(...candidates.map(candidate => candidate.text));
    return {
      saved: true,
      memory: {
        ...createAliceMemory(),
        items: candidates.map(candidate => ({ ...candidate, id: 'memory-note', createdDay: '2026-10-06', updatedDay: '2026-10-06' })),
      },
    };
  };
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Retiens que je fais tourner un nœud élagué.' }],
    userMessage: 'Retiens que je fais tourner un nœud élagué.',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);

  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.remembered, ['je fais tourner un nœud élagué']);
  assert.equal(prepared.directResponse, 'Retenu : je fais tourner un nœud élagué');
  assert.equal(prepared.diagnostics.retrieval, 'none');
  assert.deepEqual(prepared.explicitMemoryCandidates, [{ category: 'requested-note', text: 'je fais tourner un nœud élagué' }]);

  const english = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Please remember I use a hardware wallet.' }],
    userMessage: 'Please remember I use a hardware wallet.',
    backendType: 'local',
    targetLanguage: 'en',
  }, fixture);
  assert.equal(english.directResponse, 'Noted: I use a hardware wallet');
});

test('a refused remember request is never written and says why in the user language', async () => {
  const fixture = services();
  const french = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Retiens que je garde 0.5 BTC sur ma Ledger.' }],
    userMessage: 'Retiens que je garde 0.5 BTC sur ma Ledger.',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);
  assert.deepEqual(fixture.remembered, []);
  assert.deepEqual(fixture.queries, []);
  assert.match(french.directResponse ?? '', /ne peut pas retenir cette phrase : elle contient un montant/);
  assert.doesNotMatch(french.directResponse ?? '', /0\.5 BTC/);

  const english = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Remember that my recovery phrase is in the safe.' }],
    userMessage: 'Remember that my recovery phrase is in the safe.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);
  assert.deepEqual(fixture.remembered, []);
  assert.match(english.directResponse ?? '', /cannot keep this sentence: it contains a recovery phrase or a key/);
});

test('a remember request with memory switched off or the category paused is not claimed as saved', async () => {
  const fixture = services();
  fixture.rememberMemoryCandidates = async () => ({ memory: { ...createAliceMemory(), enabled: false }, saved: true });
  const off = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Remember that I like diagrams.' }],
    userMessage: 'Remember that I like diagrams.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);
  assert.match(off.directResponse ?? '', /turned off/);
  assert.doesNotMatch(off.directResponse ?? '', /^Noted/);

  fixture.rememberMemoryCandidates = async () => ({ memory: { ...createAliceMemory(), pausedCategories: ['requested-note'] }, saved: true });
  const paused = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Retiens que je préfère les schémas.' }],
    userMessage: 'Retiens que je préfère les schémas.',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);
  assert.match(paused.directResponse ?? '', /en pause/);
});

test('a plain statement without a remember request takes the usual path', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'I run a pruned node at home.' }],
    userMessage: 'I run a pruned node at home.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);
  assert.ok(!fixture.remembered.includes('I run a pruned node at home'));
  assert.notEqual(prepared.directResponse, 'Noted: I run a pruned node at home');
});

test('a remember request followed by a question answers the question and keeps the note as a candidate', async () => {
  const fixture = services();
  const message = 'Retiens que je préfère les réponses détaillées. Qu\'est-ce qu\'un UTXO ?';
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: message }],
    userMessage: message,
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);
  assert.equal(prepared.directResponse, null);
  assert.deepEqual(fixture.queries, ["Qu'est-ce qu'un UTXO ?"]);
  assert.ok(fixture.remembered.includes('je préfère les réponses détaillées'));
});

test('"note que" and "keep in mind that" turns are answered as usual, declaration recorded, nothing kept verbatim', async () => {
  const fixture = services();
  const signals: string[] = [];
  fixture.recordPedagogicalSignal = async message => { signals.push(message); return createPedagogicalProfile(); };

  const french = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Note que je ne suis pas expert, mais comment fonctionne un UTXO ?' }],
    userMessage: 'Note que je ne suis pas expert, mais comment fonctionne un UTXO ?',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);
  assert.equal(french.directResponse, null);
  assert.equal(fixture.queries.length, 1);
  assert.match(fixture.queries[0], /comment fonctionne un UTXO/);
  assert.deepEqual(fixture.remembered, []);

  const english = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Keep in mind that I am a beginner. How do UTXOs work?' }],
    userMessage: 'Keep in mind that I am a beginner. How do UTXOs work?',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);
  assert.equal(english.directResponse, null);
  assert.equal(fixture.queries.at(-1), 'How do UTXOs work?');
  assert.deepEqual(fixture.remembered, []);
  assert.equal(signals.at(-1), 'Keep in mind that I am a beginner. How do UTXOs work?');
});

test('a standalone remember request still records the learning declaration it carries', async () => {
  const fixture = services();
  const signals: string[] = [];
  fixture.recordPedagogicalSignal = async message => { signals.push(message); return createPedagogicalProfile(); };
  fixture.rememberMemoryCandidates = async candidates => ({
    saved: true,
    memory: { ...createAliceMemory(), items: candidates.map(candidate => ({ ...candidate, id: 'memory-note', createdDay: '2026-10-06', updatedDay: '2026-10-06' })) },
  });
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Souviens-toi que je débute avec Lightning.' }],
    userMessage: 'Souviens-toi que je débute avec Lightning.',
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, fixture);
  assert.deepEqual(signals, ['Souviens-toi que je débute avec Lightning.']);
  assert.equal(prepared.plan.hasExplicitLearningDeclaration, true);
  assert.equal(prepared.directResponse, 'Retenu : je débute avec Lightning');
  assert.equal(prepared.diagnostics.retrieval, 'none');
});

test('a remember request about the world is not kept and not confirmed', async () => {
  const fixture = services();
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Remember that the halving happens every four years.' }],
    userMessage: 'Remember that the halving happens every four years.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);
  assert.deepEqual(fixture.remembered, []);
  assert.notEqual(prepared.directResponse, 'Noted: the halving happens every four years');
  assert.doesNotMatch(prepared.directResponse ?? '', /^Noted/);
});

test('a note whose write failed is reported as not saved, never as noted', async () => {
  const fixture = services();
  fixture.rememberMemoryCandidates = async () => ({ memory: createAliceMemory(), saved: false });
  const prepared = await prepareAliceTurn({
    history: [{ role: 'user', content: 'Remember that I like diagrams.' }],
    userMessage: 'Remember that I like diagrams.',
    backendType: 'cloud',
    targetLanguage: 'en',
  }, fixture);
  assert.match(prepared.directResponse ?? '', /could not save this note/);
  assert.doesNotMatch(prepared.directResponse ?? '', /^Noted/);
});

test('a retrieved rule note adds the answer-rules block to the system turn and to the diagnostics', async () => {
  const withArkNote = {
    ...services(),
    retrieveKnowledge: async () => ({
      ragContext: 'Use the following retrieved notes as private background.\n\nTopic: Ark operator / ASP\nLevel: advanced\nNotes: An Ark operator coordinates rounds.\n\nTopic: Ark introduction\nLevel: beginner\nNotes: Ark is a family of technologies.',
      localContext: null,
      learnContext: null,
      diagnostics: [{ id: 'asp-operator' }, { id: 'ark-introduction' }],
    }),
  };
  const english = await prepareAliceTurn({
    history: [{ role: 'user', content: 'If the Ark operator disappears tomorrow, are my funds gone?' }],
    userMessage: 'If the Ark operator disappears tomorrow, are my funds gone?',
    backendType: 'local',
    targetLanguage: 'en',
  }, withArkNote);
  assert.deepEqual(english.diagnostics.answerRuleNoteIds, ['asp-operator']);
  const system = english.history.at(-2)?.content ?? '';
  assert.match(system, /\[Retrieved knowledge\][\s\S]*\[Answer rules\]\nThe retrieved notes make the points below mandatory/);
  assert.match(system, /unilateral exit without the operator/);
  assert.ok(system.indexOf('[Answer rules]') > system.indexOf('[Retrieved knowledge]'));
  assert.equal(english.history.at(-1)?.content, 'If the Ark operator disappears tomorrow, are my funds gone?');

  const french = await prepareAliceTurn({
    history: [{ role: 'user', content: "Si l'opérateur Ark disparaît demain, mes fonds sont-ils perdus ?" }],
    userMessage: "Si l'opérateur Ark disparaît demain, mes fonds sont-ils perdus ?",
    backendType: 'cloud',
    targetLanguage: 'fr',
  }, withArkNote);
  assert.match(french.history.at(-2)?.content ?? '', /\[Answer rules\]\nLes notes récupérées rendent obligatoires/);
  assert.match(french.history.at(-2)?.content ?? '', /^À ne jamais affirmer :$/m);

  // A note without rules adds nothing.
  const plain = await prepareAliceTurn({
    history: [{ role: 'user', content: 'What is a block?' }],
    userMessage: 'What is a block?',
    backendType: 'local',
    targetLanguage: 'en',
  }, services());
  assert.deepEqual(plain.diagnostics.answerRuleNoteIds, []);
  assert.doesNotMatch(plain.history.at(-2)?.content ?? '', /\[Answer rules\]/);
});
