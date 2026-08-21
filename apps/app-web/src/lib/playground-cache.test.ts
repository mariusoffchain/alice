import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

// The cache lets the wallet paint instantly on open. It is read before any
// network call, so a malformed or half-written entry must never reach the UI
// as if it were a real balance.

const KEY = 'alice.test-wallet.snapshot.v1';

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

let readCachedPlaygroundSnapshot: typeof import('./playground.ts').readCachedPlaygroundSnapshot;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).window = fakeWindow();
  ({ readCachedPlaygroundSnapshot } = await import('./playground.ts'));
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

function write(value: unknown) {
  (globalThis as unknown as { window: { localStorage: Storage } })
    .window.localStorage.setItem(KEY, JSON.stringify(value));
}

const VALID = {
  balanceSats: 21_000,
  pendingSats: 0,
  utxos: [],
  history: [],
  receiveAddress: 'tb1qexample',
  changeAddress: 'tb1qchange',
  addresses: [],
};

describe('playground snapshot cache', () => {
  it('returns nothing when the wallet was never opened', () => {
    assert.equal(readCachedPlaygroundSnapshot(), null);
  });

  it('returns a well-formed snapshot', () => {
    write(VALID);
    const cached = readCachedPlaygroundSnapshot();
    assert.equal(cached?.balanceSats, 21_000);
    assert.equal(cached?.receiveAddress, 'tb1qexample');
  });

  it('refuses anything malformed rather than showing a wrong balance', () => {
    for (const bad of [
      'not json at all',
      JSON.stringify({ ...VALID, balanceSats: 'lots' }),
      JSON.stringify({ ...VALID, receiveAddress: null }),
      JSON.stringify({ ...VALID, utxos: 'none' }),
      JSON.stringify({ ...VALID, history: undefined }),
      JSON.stringify({ ...VALID, addresses: 3 }),
      JSON.stringify(null),
    ]) {
      (globalThis as unknown as { window: { localStorage: Storage } })
        .window.localStorage.setItem(KEY, bad);
      assert.equal(readCachedPlaygroundSnapshot(), null, `accepted: ${bad.slice(0, 40)}`);
    }
  });
});
