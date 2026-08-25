import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecoveryScanFlag, type KeyValueStore } from './recovery-scan-flag.ts';

function memoryStore(): KeyValueStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    async getItem(key) { return map.get(key) ?? null; },
    async setItem(key, value) { map.set(key, value); },
    async removeItem(key) { map.delete(key); },
    async getAllKeys() { return [...map.keys()]; },
    async multiRemove(keys) { for (const key of keys) map.delete(key); },
    dump() { return Object.fromEntries(map); },
  };
}

function tokens(...values: string[]) {
  const queue = [...values];
  return () => queue.shift() ?? 'unexpected';
}

test('a pass that finishes late for seed A leaves seed B still pending', async () => {
  const store = memoryStore();
  const flag = createRecoveryScanFlag(store, tokens('A', 'B'));

  const a = await flag.mark();          // import A: quick pass found funds, deep pass starts
  await flag.reset();                   // "Create wallet": seed A forgotten
  const b = await flag.mark();          // import B: its own deep pass starts
  assert.equal(await flag.current(), b);

  await flag.clear(a);                  // A's deep pass completes, late
  assert.equal(await flag.isPending(), true, 'B must still be reported as unfinished');
  assert.equal(await flag.current(), b);

  await flag.clear(b);
  assert.equal(await flag.isPending(), false);
});

test('a stale pass that was never reset cannot clear the newer one either', async () => {
  const store = memoryStore();
  const flag = createRecoveryScanFlag(store, tokens('A', 'B'));
  const a = await flag.mark();
  const b = await flag.mark();          // a second restore without a reset in between
  await flag.clear(a);
  assert.equal(await flag.current(), b);
  await flag.clear(b);
  assert.equal(await flag.isPending(), false);
});

test('the pending state survives a relaunch and resumes with the stored token', async () => {
  const store = memoryStore();
  const first = createRecoveryScanFlag(store, tokens('A'));
  await first.mark();
  const relaunched = createRecoveryScanFlag(store, tokens());
  assert.equal(await relaunched.current(), 'A');
  await relaunched.clear('A');
  assert.equal(await relaunched.isPending(), false);
});

test('reset sweeps pointer and every marker', async () => {
  const store = memoryStore();
  const flag = createRecoveryScanFlag(store, tokens('A', 'B'));
  await flag.mark();
  await flag.mark();
  await store.setItem('alice_other', 'keep');
  await flag.reset();
  assert.deepEqual(store.dump(), { alice_other: 'keep' });
});
