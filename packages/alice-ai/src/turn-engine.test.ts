import assert from 'node:assert/strict';
import test from 'node:test';
import { createAliceMemory } from './alice-memory-core.ts';
import { createPedagogicalProfile } from './pedagogical-profile-core.ts';
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
        diagnostics: [{ id: 'test-chunk' }],
      };
    },
    getMemory: async () => createAliceMemory(),
    rememberMemoryCandidates: async candidates => {
      remembered.push(...candidates.map(candidate => candidate.text));
      return createAliceMemory();
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

test('stored personal memory is injected only into Local AI', async () => {
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
  const prepare = async (backendType: 'local' | 'cloud') => {
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
  const localContext = local.history.map(message => message.content).join('\n');
  const cloudContext = cloud.history.map(message => message.content).join('\n');

  assert.match(localContext, /LOCAL MEMORY: Prefers concise answers/);
  assert.doesNotMatch(cloudContext, /LOCAL MEMORY|Prefers concise answers/);
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

test('a contextual follow-up adds only a newly named topic to retrieval', async () => {
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

  assert.deepEqual(fixture.queries, [
    'Explain what is Bitcoin?\nFollow-up topic: Lightning',
  ]);
});
