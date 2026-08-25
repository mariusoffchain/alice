import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

// The one-shot deep-link channel carries a subject from another surface (a
// Learn anchor, a Playground transaction) into the Explorer workspace. It is
// read from localStorage, so everything it returns has to be checked: a stale
// or hand-edited entry must degrade to "open Home", never to a broken tab.

const KEY = 'explorer.pending-open.v1';

function fakeWindow() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
}

let requestPendingOpen: typeof import('./tab-storage.ts').requestPendingOpen;
let consumePendingOpen: typeof import('./tab-storage.ts').consumePendingOpen;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).window = fakeWindow();
  ({ requestPendingOpen, consumePendingOpen } = await import('./tab-storage.ts'));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

function writeRaw(value: string) {
  (globalThis as unknown as { window: { localStorage: Storage } })
    .window.localStorage.setItem(KEY, value);
}

describe('explorer pending-open channel', () => {
  it('carries a subject and its network, once', () => {
    requestPendingOpen('tx', 'ab'.repeat(32), { label: 'Test sats sent', origin: 'Playground' }, 'mutinynet');
    const first = consumePendingOpen();
    assert.equal(first?.kind, 'tx');
    assert.equal(first?.query, 'ab'.repeat(32));
    assert.equal(first?.networkId, 'mutinynet');
    assert.equal(first?.note?.origin, 'Playground');
    // One shot: a reload must not reopen the same tab for ever.
    assert.equal(consumePendingOpen(), null);
  });

  it('leaves the network open when the caller does not name one', () => {
    requestPendingOpen('address', 'tb1qexample');
    assert.equal(consumePendingOpen()?.networkId, undefined);
  });

  it('drops a network the registry no longer knows', () => {
    // A link kept from before a network was retired: the tab must fall back to
    // the visitor's default rather than point at nothing.
    writeRaw(JSON.stringify({ kind: 'tx', query: 'cd'.repeat(32), networkId: 'retirednet' }));
    const pending = consumePendingOpen();
    assert.equal(pending?.query, 'cd'.repeat(32));
    assert.equal(pending?.networkId, undefined);
  });

  it('refuses entries that are not openable at all', () => {
    for (const bad of [
      'not json',
      JSON.stringify({ kind: 'overview', query: 'x' }),
      JSON.stringify({ kind: 'tx' }),
      JSON.stringify({ kind: 'tx', query: '' }),
      JSON.stringify({ query: 'ab' }),
      JSON.stringify(null),
    ]) {
      writeRaw(bad);
      assert.equal(consumePendingOpen(), null, `accepted: ${bad.slice(0, 40)}`);
    }
  });

  it('ignores a malformed note rather than the whole request', () => {
    writeRaw(JSON.stringify({ kind: 'block', query: '800000', note: { label: 42 } }));
    const pending = consumePendingOpen();
    assert.equal(pending?.query, '800000');
    assert.equal(pending?.note, undefined);
  });
});
