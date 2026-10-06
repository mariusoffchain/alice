import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALICE_MEMORY_FILE_MARKER,
  ALICE_MEMORY_KEYCHAIN_LIMIT_BYTES,
  createAliceMemoryTieredStorage,
  decryptAliceMemoryFile,
  encryptAliceMemoryFile,
  utf8ByteLength,
} from './alice-memory-tiered-storage.ts';
import { getAliceMemoryFromStorage, rememberAliceCandidatesInStorage } from './alice-memory-core.ts';

function fixture(initialSecure: Record<string, string> = {}) {
  const secure = new Map(Object.entries(initialSecure));
  let file: string | null = null;
  const storage = createAliceMemoryTieredStorage({
    valueKey: 'memory',
    fileKeyKey: 'memory-file-key',
    secure: {
      get: async key => secure.get(key) ?? null,
      set: async (key, value) => { secure.set(key, value); },
      remove: async key => { secure.delete(key); },
    },
    file: {
      read: async () => file,
      write: async value => { file = value; },
      remove: async () => { file = null; },
    },
  });
  return { storage, secure, file: () => file };
}

const small = JSON.stringify({ version: 2, enabled: true, items: [], pausedCategories: [] });
const large = JSON.stringify({
  version: 2,
  enabled: true,
  pausedCategories: [],
  items: Array.from({ length: 40 }, (_, index) => ({
    id: `memory-${index}`,
    category: 'interest',
    text: `Interested in topic number ${index} and its many ramifications`,
    createdDay: '2026-10-06',
    updatedDay: '2026-10-06',
  })),
});

test('byte length counts UTF-8, not characters', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('é'), 2);
  assert.equal(utf8ByteLength('€'), 3);
  assert.equal(utf8ByteLength('😀'), 4);
  assert.ok(utf8ByteLength(large) > ALICE_MEMORY_KEYCHAIN_LIMIT_BYTES);
  assert.ok(utf8ByteLength(small) <= ALICE_MEMORY_KEYCHAIN_LIMIT_BYTES);
});

test('a small memory stays in the keychain and no file is written', async () => {
  const { storage, secure, file } = fixture();
  await storage.write(small);
  assert.equal(secure.get('memory'), small);
  assert.equal(secure.has('memory-file-key'), false);
  assert.equal(file(), null);
  assert.equal(await storage.read(), small);
});

test('past the keychain limit the memory moves to an encrypted file, with the key in the keychain', async () => {
  const { storage, secure, file } = fixture();
  await storage.write(large);
  assert.equal(secure.get('memory'), ALICE_MEMORY_FILE_MARKER);
  const key = secure.get('memory-file-key');
  assert.match(key ?? '', /^[0-9a-f]{64}$/);
  assert.ok(file());
  assert.doesNotMatch(file() ?? '', /Interested in topic/);
  assert.equal(decryptAliceMemoryFile(file()!, key!), large);
  assert.equal(await storage.read(), large);
});

test('a memory that shrinks back goes back to the keychain and the file is removed', async () => {
  const { storage, secure, file } = fixture();
  await storage.write(large);
  await storage.write(small);
  assert.equal(secure.get('memory'), small);
  assert.equal(file(), null);
  assert.equal(await storage.read(), small);
});

test('an older keychain value that holds the JSON itself is read as is', async () => {
  const legacy = JSON.stringify({ version: 1, enabled: true, items: [{ category: 'goal', text: 'Wants to run a node' }] });
  const { storage } = fixture({ memory: legacy });
  assert.equal(await storage.read(), legacy);
  const memory = await getAliceMemoryFromStorage(storage);
  assert.equal(memory.version, 2);
  assert.deepEqual(memory.items.map(item => item.text), ['Wants to run a node']);
});

test('the memory core grows across the threshold without noticing the move', async () => {
  const { storage, secure } = fixture();
  for (let index = 0; index < 40; index += 1) {
    await rememberAliceCandidatesInStorage([
      { category: 'interest', text: `Interested in topic number ${index} and its many ramifications` },
    ], storage);
  }
  assert.equal(secure.get('memory'), ALICE_MEMORY_FILE_MARKER);
  const memory = await getAliceMemoryFromStorage(storage);
  assert.equal(memory.items.length, 40);
});

test('removing the memory clears the keychain value, the key and the file', async () => {
  const { storage, secure, file } = fixture();
  await storage.write(large);
  await storage.remove();
  assert.equal(secure.size, 0);
  assert.equal(file(), null);
  assert.equal(await storage.read(), null);
});

test('a file that cannot be decrypted reads as an empty memory rather than a crash', async () => {
  const { storage, secure } = fixture();
  await storage.write(large);
  secure.set('memory-file-key', 'ab'.repeat(32));
  assert.equal(await storage.read(), null);
  const memory = await getAliceMemoryFromStorage(storage);
  assert.deepEqual(memory.items, []);
});

test('each encryption uses a fresh nonce', () => {
  const key = 'cd'.repeat(32);
  const first = encryptAliceMemoryFile('same text', key);
  const second = encryptAliceMemoryFile('same text', key);
  assert.notEqual(first, second);
  assert.equal(decryptAliceMemoryFile(first, key), 'same text');
  assert.equal(decryptAliceMemoryFile(second, key), 'same text');
});
