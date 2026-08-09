import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAliceSatoraStorage,
  type SatoraKeyValueStore,
  type SatoraStoredSwap,
} from './satora-storage.ts';

class MemoryKeyValueStore implements SatoraKeyValueStore {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()]);
  }
}

function storedSwap(id = 'swap-1'): SatoraStoredSwap {
  return {
    version: 2,
    swapId: id,
    keyIndex: 4,
    response: {
      id,
      direction: 'arkade_to_lightning',
      status: 'pending',
      source_amount: '10001',
      target_amount: '10000',
      arkade_vhtlc_address: 'tark1recovery',
    },
    publicKey: 'public-secret-marker',
    preimage: 'preimage-secret-marker',
    preimageHash: 'hash-secret-marker',
    secretKey: 'refund-secret-marker',
    storedAt: 100,
    updatedAt: 100,
  } as SatoraStoredSwap;
}

describe('Alice Satora encrypted recovery storage', () => {
  it('never exposes or persists the Alice mnemonic through signer storage', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);

    assert.equal(await storage.walletStorage.getMnemonic(), null);
    await assert.rejects(
      storage.walletStorage.setMnemonic('another signer mnemonic'),
      /does not allow Satora to persist signer mnemonics/,
    );
  });

  it('persists the key index and swap recovery record across adapter instances', async () => {
    const values = new MemoryKeyValueStore();
    const first = createAliceSatoraStorage('abandon abandon abandon about', values);
    assert.equal(await first.walletStorage.incrementKeyIndex(), 0);
    assert.equal(await first.walletStorage.incrementKeyIndex(), 1);
    await first.swapStorage.store(storedSwap());

    const reopened = createAliceSatoraStorage('abandon abandon abandon about', values);
    assert.equal(await reopened.walletStorage.getKeyIndex(), 2);
    assert.equal((await reopened.swapStorage.get('swap-1'))?.preimage, 'preimage-secret-marker');
    assert.deepEqual(await reopened.swapStorage.list(), ['swap-1']);
  });

  it('starts the BIP85 signer at index zero instead of reusing a legacy counter', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);
    await storage.encryptedStorage.set('wallet:key-index', 12);

    assert.equal(await storage.walletStorage.getKeyIndex(), 0);
    assert.equal(await storage.walletStorage.incrementKeyIndex(), 0);
    assert.equal(await storage.walletStorage.getKeyIndex(), 1);
    assert.equal(await storage.encryptedStorage.get('wallet:key-index'), 12);
  });

  it('preserves Alice funding evidence when Satora refreshes the provider response', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);
    const swap = storedSwap();
    swap.response = {
      ...swap.response,
      alice_funding_attempted: true,
      arkade_fund_txid: 'funding-txid',
    } as unknown as typeof swap.response;
    await storage.swapStorage.store(swap);

    await storage.swapStorage.update('swap-1', {
      id: 'swap-1',
      direction: 'arkade_to_lightning',
      status: 'transactionmempool',
      source_amount: '10001',
      target_amount: '10000',
      arkade_vhtlc_address: 'tark1recovery',
    } as unknown as typeof swap.response);

    const refreshed = await storage.swapStorage.get('swap-1');
    assert.equal(
      (refreshed?.response as Record<string, unknown>).alice_funding_attempted,
      true,
    );
    assert.equal(
      (refreshed?.response as Record<string, unknown>).arkade_fund_txid,
      'funding-txid',
    );
    assert.equal(refreshed?.response.status, 'transactionmempool');
  });

  it('stores no swap id, preimage, refund key, or mnemonic in plaintext', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);
    await storage.walletStorage.setKeyIndex(7);
    await storage.swapStorage.store(storedSwap());

    const raw = [...values.values.values()].join('\n');
    assert.doesNotMatch(raw, /swap-1/);
    assert.doesNotMatch(raw, /preimage-secret-marker/);
    assert.doesNotMatch(raw, /refund-secret-marker/);
    assert.doesNotMatch(raw, /abandon/);
  });

  it('binds ciphertext to its record key and rejects record substitution', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);
    await storage.swapStorage.store(storedSwap('swap-1'));
    await storage.swapStorage.store(storedSwap('swap-2'));

    const first = [...values.values.entries()].find(([key]) => key.includes('swap-1'));
    const second = [...values.values.entries()].find(([key]) => key.includes('swap-2'));
    assert.ok(first);
    assert.ok(second);
    values.values.set(first[0], second[1]);

    await assert.rejects(
      storage.swapStorage.get('swap-1'),
      /could not authenticate/,
    );
  });

  it('cannot decrypt recovery data with another wallet mnemonic', async () => {
    const values = new MemoryKeyValueStore();
    const first = createAliceSatoraStorage('abandon abandon abandon about', values);
    await first.swapStorage.store(storedSwap());

    const wrongWallet = createAliceSatoraStorage('legal winner thank year', values);
    await assert.rejects(
      wrongWallet.swapStorage.get('swap-1'),
      /could not authenticate/,
    );
  });

  it('serializes concurrent key increments without reusing an index', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);
    const indices = await Promise.all([
      storage.walletStorage.incrementKeyIndex(),
      storage.walletStorage.incrementKeyIndex(),
      storage.walletStorage.incrementKeyIndex(),
    ]);
    assert.deepEqual(indices, [0, 1, 2]);
    assert.equal(await storage.walletStorage.getKeyIndex(), 3);
  });

  it('clears swap recovery records without deleting the key index', async () => {
    const values = new MemoryKeyValueStore();
    const storage = createAliceSatoraStorage('abandon abandon abandon about', values);
    await storage.walletStorage.setKeyIndex(5);
    await storage.swapStorage.store(storedSwap());
    await storage.swapStorage.clear();

    assert.deepEqual(await storage.swapStorage.getAll(), []);
    assert.equal(await storage.walletStorage.getKeyIndex(), 5);
  });
});
