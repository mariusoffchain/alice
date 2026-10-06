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

// --- Session 1 of the user-memory plan (2026-10-06) ---

import {
  ALICE_MEMORY_CATEGORIES,
  ALICE_MEMORY_CATEGORY_LABELS,
  ALICE_MEMORY_CAPTURE_INSTRUCTION,
  aliceMemoryRefusalMessage,
  aliceMemoryRefusalReason,
  clearAliceMemoryCategoryInStorage,
  editAliceMemoryItemInStorage,
  setAliceMemoryCategoryPausedInStorage,
} from './alice-memory-core.ts';

test('every category has a label in both languages and the new ones are present', () => {
  for (const category of ALICE_MEMORY_CATEGORIES) {
    assert.ok(ALICE_MEMORY_CATEGORY_LABELS.en[category]);
    assert.ok(ALICE_MEMORY_CATEGORY_LABELS.fr[category]);
  }
  assert.equal(ALICE_MEMORY_CATEGORY_LABELS.fr.setup, 'Installation');
  assert.equal(ALICE_MEMORY_CATEGORY_LABELS.fr.experience, 'Expérience');
  assert.equal(ALICE_MEMORY_CATEGORY_LABELS.fr['requested-note'], 'Notes demandées');
  assert.match(ALICE_MEMORY_CAPTURE_INSTRUCTION, /0 to 3 items/);
  assert.match(ALICE_MEMORY_CAPTURE_INSTRUCTION, /Do not infer/);
  assert.match(ALICE_MEMORY_CAPTURE_INSTRUCTION, /setup/);
  assert.match(ALICE_MEMORY_CAPTURE_INSTRUCTION, /experience/);
  assert.doesNotMatch(ALICE_MEMORY_CAPTURE_INSTRUCTION, /"category":"[^"]*requested-note/);
});

test('amounts with a bitcoin or fiat unit are refused, bare numbers and cosigner counts are kept', () => {
  for (const text of [
    'Keeps 0.5 BTC on a hardware wallet',
    'Holds 20 000 sats on Lightning',
    'Spends about 150 € a month in bitcoin',
    'Budget is $300 per month',
    'Owns 2 bitcoins',
    'Veut acheter 20k sats par semaine',
    'A mis 1 500 euros de côté',
    'Owns half a bitcoin',
    'Possède un demi-bitcoin',
    'Has around EUR 150 to spend',
  ]) {
    assert.equal(aliceMemoryRefusalReason(text), 'amount', text);
  }
  for (const text of [
    'A un multisig 2 sur 3',
    'Uses a 2-of-3 multisig',
    'Has used Bitcoin since 2021',
    'Runs Bitcoin Core 27 on a Raspberry Pi 5',
    'Has 2 bitcoin wallets, one for daily use',
    'Explains Bitcoin to 3 friends',
    'Prefers answers in 3 bullet points',
  ]) {
    assert.equal(aliceMemoryRefusalReason(text), null, text);
  }
});

test('exchange accounts are refused, self-custody setup stays accepted', () => {
  for (const text of [
    'Garde ses bitcoins sur mon compte Binance',
    'Has a Kraken account for buying',
    'Bought bitcoin on Coinbase in 2021',
    'Uses Bitstamp',
    'Verified on Bitpanda',
    'Has a Strike account',
    'Utilise le wallet Relai',
  ]) {
    assert.equal(aliceMemoryRefusalReason(text), 'exchange', text);
  }
  for (const text of [
    'Uses a hardware wallet with a 2-of-3 multisig',
    'Runs a pruned node at home',
    'Lives near the river and likes to swim',
    'Reads about the Gemini space program',
    'Wants to leave custodial platforms for self-custody',
  ]) {
    assert.equal(aliceMemoryRefusalReason(text), null, text);
  }
});

test('each refusal reason names what was refused in both languages', () => {
  assert.equal(aliceMemoryRefusalReason('My recovery phrase is written on paper'), 'secret');
  assert.equal(aliceMemoryRefusalReason(`Sends to bc1q${'q'.repeat(38)}`), 'address');
  assert.equal(aliceMemoryRefusalReason('Last transaction was yesterday'), 'activity');
  assert.equal(aliceMemoryRefusalReason('Email is person@example.com'), 'identity');
  assert.equal(aliceMemoryRefusalReason('Has a medical diagnosis'), 'sensitive');
  assert.equal(aliceMemoryRefusalReason('Lives at 12 rue des Lilas'), 'location');
  assert.equal(aliceMemoryRefusalReason('ab'), 'too-short');
  assert.equal(aliceMemoryRefusalReason('x'.repeat(161)), 'too-long');
  assert.match(aliceMemoryRefusalMessage('amount', 'fr'), /un montant/);
  assert.match(aliceMemoryRefusalMessage('amount', 'en'), /an amount/);
  assert.match(aliceMemoryRefusalMessage('exchange', 'fr'), /plateforme d'échange/);
  assert.match(aliceMemoryRefusalMessage('too-long', 'en'), /160 characters/);
  for (const language of ['fr', 'en'] as const) {
    for (const reason of ['secret', 'address', 'amount', 'exchange', 'too-short'] as const) {
      assert.doesNotMatch(aliceMemoryRefusalMessage(reason, language), /—/);
    }
  }
});

test('the model may propose up to three items but never a requested note', () => {
  const result = parseAliceMemoryResponse(`Answer.
<alice_memory>{"items":[
  {"category":"setup","text":"Uses a hardware wallet with a 2-of-3 multisig"},
  {"category":"experience","text":"Has used Bitcoin since 2021"},
  {"category":"requested-note","text":"Call me at noon"},
  {"category":"interest","text":"Interested in coinjoin"},
  {"category":"goal","text":"Wants to run a node"}
]}</alice_memory>`);
  assert.deepEqual(result.candidates.map(candidate => candidate.category), ['setup', 'experience', 'interest']);
});

test('a version 1 store is read without loss and written back as version 2', async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    category: 'interest',
    text: `Interested in topic number ${index}`,
    createdDay: '2026-08-08',
    updatedDay: '2026-08-08',
  }));
  const fixture = createStorage(JSON.stringify({ version: 1, enabled: false, items }));
  const memory = await getAliceMemoryFromStorage(fixture.storage);
  assert.equal(memory.version, 2);
  assert.equal(memory.enabled, false);
  assert.equal(memory.items.length, 20);
  assert.deepEqual(memory.pausedCategories, []);

  await setAliceMemoryEnabledInStorage(true, fixture.storage);
  const written = JSON.parse(fixture.value() ?? '{}') as { version: number; items: unknown[]; pausedCategories: unknown[] };
  assert.equal(written.version, 2);
  assert.equal(written.items.length, 20);
  assert.deepEqual(written.pausedCategories, []);
});

test('the store has no hard cap: the twenty-first and the sixtieth fact both stay', async () => {
  const fixture = createStorage();
  for (let index = 0; index < 60; index += 1) {
    await rememberAliceCandidatesInStorage([
      { category: 'interest', text: `Interested in topic number ${index}` },
    ], fixture.storage, new Date(2026, 9, 6));
  }
  const memory = await getAliceMemoryFromStorage(fixture.storage);
  assert.equal(memory.items.length, 60);
  assert.equal(memory.items[0].text, 'Interested in topic number 0');
  assert.equal(memory.items[59].text, 'Interested in topic number 59');
});

test('a turn adds at most three candidates', async () => {
  const fixture = createStorage();
  const memory = await rememberAliceCandidatesInStorage(
    Array.from({ length: 5 }, (_, index) => ({ category: 'interest' as const, text: `Interested in topic number ${index}` })),
    fixture.storage,
  );
  assert.equal(memory.items.length, 3);
});

test('a paused category stops capture without erasing what it holds', async () => {
  const fixture = createStorage();
  let memory = await rememberAliceCandidatesInStorage([
    { category: 'setup', text: 'Uses a hardware wallet' },
  ], fixture.storage);
  memory = await setAliceMemoryCategoryPausedInStorage('setup', true, fixture.storage);
  assert.deepEqual(memory.pausedCategories, ['setup']);
  memory = await rememberAliceCandidatesInStorage([
    { category: 'setup', text: 'Runs a pruned node' },
    { category: 'interest', text: 'Interested in coinjoin' },
  ], fixture.storage);
  assert.deepEqual(memory.items.map(item => item.text), ['Uses a hardware wallet', 'Interested in coinjoin']);

  memory = await setAliceMemoryCategoryPausedInStorage('setup', false, fixture.storage);
  assert.deepEqual(memory.pausedCategories, []);
  memory = await rememberAliceCandidatesInStorage([{ category: 'setup', text: 'Runs a pruned node' }], fixture.storage);
  assert.equal(memory.items.length, 3);
});

test('editing a fact goes through the filters and reports the refusal', async () => {
  const fixture = createStorage();
  const initial = await rememberAliceCandidatesInStorage([
    { category: 'setup', text: 'Uses a hardware wallet' },
    { category: 'setup', text: 'Runs a pruned node' },
  ], fixture.storage, new Date(2026, 9, 1));
  const [first, second] = initial.items;

  const refused = await editAliceMemoryItemInStorage(first.id, 'Keeps 0.5 BTC on a hardware wallet', fixture.storage);
  assert.equal(refused.refusal, 'amount');
  assert.deepEqual(refused.memory.items.map(item => item.text), ['Uses a hardware wallet', 'Runs a pruned node']);

  const accepted = await editAliceMemoryItemInStorage(first.id, 'Uses a hardware wallet with a 2-of-3 multisig', fixture.storage, new Date(2026, 9, 6));
  assert.equal(accepted.refusal, null);
  const edited = accepted.memory.items[0];
  assert.equal(edited.text, 'Uses a hardware wallet with a 2-of-3 multisig');
  assert.equal(edited.category, 'setup');
  assert.equal(edited.createdDay, '2026-10-01');
  assert.equal(edited.updatedDay, '2026-10-06');
  assert.notEqual(edited.id, first.id);

  // An edit that lands on another fact's text keeps one row, not two.
  const merged = await editAliceMemoryItemInStorage(edited.id, 'Runs a pruned node', fixture.storage);
  assert.deepEqual(merged.memory.items.map(item => item.text), ['Runs a pruned node']);
  assert.equal(merged.memory.items[0].id, second.id);

  const unknown = await editAliceMemoryItemInStorage('memory-missing', 'Anything', fixture.storage);
  assert.equal(unknown.refusal, null);
  assert.equal(unknown.memory.items.length, 1);
});

test('clearing one category leaves the others and the pause list intact', async () => {
  const fixture = createStorage();
  await rememberAliceCandidatesInStorage([
    { category: 'setup', text: 'Uses a hardware wallet' },
    { category: 'goal', text: 'Wants to run a node' },
  ], fixture.storage);
  await setAliceMemoryCategoryPausedInStorage('goal', true, fixture.storage);
  const memory = await clearAliceMemoryCategoryInStorage('setup', fixture.storage);
  assert.deepEqual(memory.items.map(item => item.text), ['Wants to run a node']);
  assert.deepEqual(memory.pausedCategories, ['goal']);
});

test('requested notes ride along like preferences, setup facts only when the topic is touched', () => {
  const items = [
    { id: 'note', category: 'requested-note' as const, text: 'Answer in French when I write in French', createdDay: '2026-06-01', updatedDay: '2026-06-01' },
    { id: 'setup', category: 'setup' as const, text: 'Uses a hardware wallet with a 2-of-3 multisig', createdDay: '2026-06-01', updatedDay: '2026-06-01' },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `topic-${i}`,
      category: 'interest' as const,
      text: `Curious about topic number ${i}`,
      createdDay: '2026-08-19',
      updatedDay: '2026-08-19',
    })),
  ];
  const memory = { ...createAliceMemory(), items };
  const unrelated = aliceMemoryContext(memory, 'What is a UTXO?');
  assert.match(unrelated, /Answer in French/);
  assert.doesNotMatch(unrelated, /hardware wallet/);
  assert.match(aliceMemoryContext(memory, 'How do I back up a multisig?'), /hardware wallet/);
});

test('a phone as a device is a constraint, a phone number is an identifier', () => {
  assert.equal(aliceMemoryRefusalReason('Only has a phone, no computer'), null);
  assert.equal(aliceMemoryRefusalReason("Pas d'ordinateur, seulement un téléphone"), null);
  assert.equal(aliceMemoryRefusalReason('Phone number is 06 12 34 56 78'), 'identity');
  assert.equal(aliceMemoryRefusalReason('Call +33 6 12 34 56 78'), 'identity');
});

import { writeAliceCandidatesToStorage } from './alice-memory-core.ts';

test('a write reports whether it reached the store', async () => {
  const ok = createStorage();
  const written = await writeAliceCandidatesToStorage([{ category: 'goal', text: 'Wants to run a node' }], ok.storage);
  assert.equal(written.saved, true);
  assert.equal(written.memory.items.length, 1);

  const failing: AliceMemoryStorage = {
    read: async () => null,
    write: async () => { throw new Error('keychain unavailable'); },
    remove: async () => {},
  };
  const failed = await writeAliceCandidatesToStorage([{ category: 'goal', text: 'Wants to run a node' }], failing);
  assert.equal(failed.saved, false);
  assert.equal(failed.memory.items.length, 1);

  // Nothing to write is not a failure.
  const disabled = createStorage(JSON.stringify({ ...createAliceMemory(), enabled: false }));
  assert.equal((await writeAliceCandidatesToStorage([{ category: 'goal', text: 'Wants to run a node' }], disabled.storage)).saved, true);
});
