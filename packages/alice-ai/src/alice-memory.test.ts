import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aliceMemoryContext,
  clearAliceMemoryFromStorage,
  createAliceMemory,
  forgetAliceMemoryItemInStorage,
  getAliceMemoryFromStorage,
  parseAliceMemoryResponse,
  rememberAliceCandidatesInStorage,
  setAliceMemoryEnabledInStorage,
  type AliceMemoryStorage,
} from './alice-memory-core.ts';

function createStorage(initial: string | null = null) {
  let value = initial;
  const storage: AliceMemoryStorage = {
    read: async () => value,
    write: async next => { value = next; },
    remove: async () => { value = null; },
  };
  return { storage, value: () => value };
}

test('parses and removes a valid private memory block from the visible answer', () => {
  const result = parseAliceMemoryResponse('Hello there.\n<alice_memory>{"items":[{"category":"project","text":"Building Alice Wallet"}]}</alice_memory>');
  assert.equal(result.visibleText, 'Hello there.');
  assert.deepEqual(result.candidates, [{ category: 'project', text: 'Building Alice Wallet' }]);
});

test('never exposes an incomplete private memory block in the visible answer', () => {
  const result = parseAliceMemoryResponse('Useful answer.\n<alice_memory>{"items":[');
  assert.equal(result.visibleText, 'Useful answer.');
  assert.deepEqual(result.candidates, []);
});

test('rejects wallet, financial, identifier, and sensitive personal memories', () => {
  const result = parseAliceMemoryResponse(`Answer.
<alice_memory>{"items":[
  {"category":"background","text":"Has a balance of 500 sats"},
  {"category":"background","text":"Email is person@example.com"},
  {"category":"background","text":"My name is Marius"},
  {"category":"background","text":"Has a medical diagnosis"},
  {"category":"interest","text":"Interested in Ark and Lightning"}
]}</alice_memory>`);
  assert.equal(result.visibleText, 'Answer.');
  assert.deepEqual(result.candidates, [{ category: 'interest', text: 'Interested in Ark and Lightning' }]);
});

test('rejects raw secrets and identifiers even when the model omits their label', () => {
  const sensitiveValues = [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    `K${'1'.repeat(51)}`,
    `xprv${'1'.repeat(90)}`,
    `bc1q${'q'.repeat(38)}`,
    `lnbc${'q'.repeat(40)}`,
    `nsec1${'q'.repeat(58)}`,
    'person@example.com',
    'alice.rabbit#1234',
    '550e8400-e29b-41d4-a716-446655440000',
    '+33 6 12 34 56 78',
    'a'.repeat(64),
  ];
  const result = parseAliceMemoryResponse(`Answer.
<alice_memory>${JSON.stringify({
    items: sensitiveValues.map(text => ({ category: 'background', text })),
  })}</alice_memory>`);

  assert.equal(result.visibleText, 'Answer.');
  assert.deepEqual(result.candidates, []);
});

test('parses and stores a valid memory candidate end to end', async () => {
  const parsed = parseAliceMemoryResponse('Noted.\n<alice_memory>{"items":[{"category":"project","text":"Building Alice Wallet"}]}</alice_memory>');
  const fixture = createStorage();
  const memory = await rememberAliceCandidatesInStorage(parsed.candidates, fixture.storage, new Date(2026, 7, 10));

  assert.equal(parsed.visibleText, 'Noted.');
  assert.deepEqual(memory.items.map(item => ({ category: item.category, text: item.text })), [
    { category: 'project', text: 'Building Alice Wallet' },
  ]);
  assert.equal(memory.items[0].createdDay, '2026-08-10');
});

test('stores a bounded deduplicated list and supports item deletion', async () => {
  const fixture = createStorage();
  let memory = await rememberAliceCandidatesInStorage([
    { category: 'goal', text: 'Learn Bitcoin privacy' },
    { category: 'goal', text: 'Learn Bitcoin privacy' },
  ], fixture.storage, new Date(2026, 7, 8));
  assert.equal(memory.items.length, 1);
  assert.equal(memory.items[0].createdDay, '2026-08-08');

  memory = await forgetAliceMemoryItemInStorage(memory.items[0].id, fixture.storage);
  assert.deepEqual(memory.items, []);
});

test('deduplicates equivalent memories created by older model-based capture', async () => {
  const fixture = createStorage(JSON.stringify({
    version: 1,
    enabled: true,
    items: [
      { category: 'preference', text: 'Prefers concise answers', createdDay: '2026-08-08', updatedDay: '2026-08-08' },
      { category: 'preference', text: 'concise answers', createdDay: '2026-08-08', updatedDay: '2026-08-08' },
      { category: 'project', text: 'Working on Alice Wallet', createdDay: '2026-08-08', updatedDay: '2026-08-08' },
      { category: 'project', text: 'Building Alice Wallet', createdDay: '2026-08-08', updatedDay: '2026-08-08' },
    ],
  }));

  const memory = await getAliceMemoryFromStorage(fixture.storage);
  assert.deepEqual(memory.items.map(item => item.text), [
    'Prefers concise answers',
    'Working on Alice Wallet',
  ]);
});

test('disabled memory neither stores nor injects personal facts', async () => {
  const fixture = createStorage(JSON.stringify({ ...createAliceMemory(), enabled: false }));
  const memory = await rememberAliceCandidatesInStorage([
    { category: 'preference', text: 'Prefers concise explanations' },
  ], fixture.storage);
  assert.deepEqual(memory.items, []);
  assert.equal(aliceMemoryContext(memory), '');
});

test('clearing removes the whole personal memory store', async () => {
  const fixture = createStorage(JSON.stringify(createAliceMemory()));
  await setAliceMemoryEnabledInStorage(false, fixture.storage);
  assert.equal((await getAliceMemoryFromStorage(fixture.storage)).enabled, false);
  await clearAliceMemoryFromStorage(fixture.storage);
  assert.equal(fixture.value(), null);
});

test('memory context picks by relevance, not by recency', () => {
  // Nine fresh decoys about an unrelated topic, one old fact about the
  // question being asked. The old rule (last ten) would have drowned it.
  const items = [
    { id: 'lightning', category: 'interest' as const, text: 'Runs a Lightning routing node at home', createdDay: '2026-07-01', updatedDay: '2026-07-01' },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `garden-${i}`,
      category: 'project' as const,
      text: `Working on garden irrigation sensors, step ${i}`,
      createdDay: '2026-08-19',
      updatedDay: '2026-08-19',
    })),
  ];
  const memory = { ...createAliceMemory(), items };
  const context = aliceMemoryContext(memory, 'How should I manage my Lightning channel liquidity?');
  assert.match(context, /Lightning routing node/);
});

test('preferences and constraints ride along whatever the topic', () => {
  const items = [
    { id: 'concise', category: 'preference' as const, text: 'Prefers concise answers', createdDay: '2026-06-01', updatedDay: '2026-06-01' },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `topic-${i}`,
      category: 'interest' as const,
      text: `Curious about topic number ${i}`,
      createdDay: '2026-08-19',
      updatedDay: '2026-08-19',
    })),
  ];
  const memory = { ...createAliceMemory(), items };
  // The question shares no words with the preference; it must be there anyway.
  const context = aliceMemoryContext(memory, 'What is a UTXO?');
  assert.match(context, /Prefers concise answers/);
});
