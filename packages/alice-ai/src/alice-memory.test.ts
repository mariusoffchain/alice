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
