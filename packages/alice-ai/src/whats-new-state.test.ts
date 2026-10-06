import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingWhatsNew, acknowledgeWhatsNew } from './whats-new-state.ts';
function storage(initial: string | null) {
  let value = initial;
  return { getItem: async () => value, setItem: async (_key: string, next: string) => { value = next; } };
}
test('effect replay does not consume an upgrade before dismissal', async () => {
  const store = storage('0.2.1');
  assert.deepEqual(await Promise.all([pendingWhatsNew(store, '0.2.2'), pendingWhatsNew(store, '0.2.2')]), ['0.2.2', '0.2.2']);
  assert.equal(await store.getItem(), '0.2.1');
  await acknowledgeWhatsNew(store, '0.2.2');
  assert.equal(await pendingWhatsNew(store, '0.2.2'), null);
});
test('fresh installation records a baseline without showing an upgrade', async () => {
  const store = storage(null);
  assert.equal(await pendingWhatsNew(store, '0.2.2'), null);
  assert.equal(await store.getItem(), '0.2.2');
});
test('older builds do not announce a downgrade or regress the seen version', async () => {
  const store = storage('0.3.0');
  assert.equal(await pendingWhatsNew(store, '0.2.2'), null);
  await acknowledgeWhatsNew(store, '0.2.2');
  assert.equal(await store.getItem(), '0.3.0');
});
test('invalid versions and unavailable storage fail quietly', async () => {
  const store = storage('0.2.1');
  assert.equal(await pendingWhatsNew(store, null), null);
  await acknowledgeWhatsNew(store, 'banana');
  assert.equal(await store.getItem(), '0.2.1');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(await pendingWhatsNew(blocked, '0.2.2'), null);
  await acknowledgeWhatsNew(blocked, '0.2.2');
});
