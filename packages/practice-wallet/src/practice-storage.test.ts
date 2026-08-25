import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRACTICE_ADDRESS_INDEXES_KEY,
  PracticeWalletStore,
  type PracticeStorageBackend,
} from './practice-storage.ts';

function memoryBackend(): PracticeStorageBackend & { dump(): Record<string, string> } {
  let secret: string | null = null;
  const values = new Map<string, string>();
  return {
    getSecret: () => Promise.resolve(secret),
    setSecret: (value) => {
      secret = value;
      return Promise.resolve();
    },
    removeSecret: () => {
      secret = null;
      return Promise.resolve();
    },
    getValue: (key) => Promise.resolve(values.get(key) ?? null),
    setValue: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeValue: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    dump: () => ({
      ...(secret !== null ? { secret } : {}),
      ...Object.fromEntries(values),
    }),
  };
}

test('ensureWallet creates the wallet once and is then stable', async () => {
  const store = new PracticeWalletStore(memoryBackend());
  let generated = 0;
  const generate = () => {
    generated += 1;
    return `practice mnemonic ${generated}`;
  };
  const first = await store.ensureWallet(generate);
  assert.deepEqual(first, { mnemonic: 'practice mnemonic 1', created: true });
  const second = await store.ensureWallet(generate);
  assert.deepEqual(second, { mnemonic: 'practice mnemonic 1', created: false });
  assert.equal(generated, 1);
  assert.equal(await store.hasWallet(), true);
});

test('ensureWallet rejects an empty generated mnemonic', async () => {
  const store = new PracticeWalletStore(memoryBackend());
  await assert.rejects(() => store.ensureWallet(() => '  '), /empty phrase/);
  assert.equal(await store.hasWallet(), false);
});

test('mode flag toggles and defaults to inactive', async () => {
  const store = new PracticeWalletStore(memoryBackend());
  assert.equal(await store.isModeActive(), false);
  await store.setModeActive(true);
  assert.equal(await store.isModeActive(), true);
  await store.setModeActive(false);
  assert.equal(await store.isModeActive(), false);
});

test('address indexes default, persist and reject bad values', async () => {
  const backend = memoryBackend();
  const store = new PracticeWalletStore(backend);
  assert.deepEqual(await store.getAddressIndexes(), { external: 1, change: 0 });
  await store.setAddressIndexes({ external: 4, change: 2 });
  assert.deepEqual(await store.getAddressIndexes(), { external: 4, change: 2 });
  await assert.rejects(
    () => store.setAddressIndexes({ external: 0, change: 0 }),
    /non-negative integers/,
  );
  await assert.rejects(
    () => store.setAddressIndexes({ external: 1, change: -1 }),
    /non-negative integers/,
  );
});

test('corrupt address index state falls back to defaults', async () => {
  const backend = memoryBackend();
  const store = new PracticeWalletStore(backend);
  await backend.setValue(PRACTICE_ADDRESS_INDEXES_KEY, 'not-json{');
  assert.deepEqual(await store.getAddressIndexes(), { external: 1, change: 0 });
  await backend.setValue(PRACTICE_ADDRESS_INDEXES_KEY, JSON.stringify({ external: -3 }));
  assert.deepEqual(await store.getAddressIndexes(), { external: 1, change: 0 });
});

test('clear removes the seed and every practice state key', async () => {
  const backend = memoryBackend();
  const store = new PracticeWalletStore(backend);
  await store.ensureWallet(() => 'practice mnemonic');
  await store.setModeActive(true);
  await store.setAddressIndexes({ external: 2, change: 1 });
  await store.clear();
  assert.deepEqual(backend.dump(), {});
  assert.equal(await store.hasWallet(), false);
  assert.equal(await store.isModeActive(), false);
});
