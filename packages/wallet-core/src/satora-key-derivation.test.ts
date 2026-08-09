import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@satora/swap';
import { deriveSatoraXprv } from './satora-key-derivation.ts';
import {
  createAliceSatoraStorage,
  type SatoraKeyValueStore,
} from './satora-storage.ts';

class MemoryKeyValueStore implements SatoraKeyValueStore {
  private readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()]);
  }
}

test('derives the official BIP85 XPRV test vector', () => {
  assert.equal(
    deriveSatoraXprv(
      'install scatter logic circle pencil average fall shoe quantum disease suspect usage',
    ),
    'xprv9s21ZrQH143K2srSbCSg4m4kLvPMzcWydgmKEnMmoZUurYuBuYG46c6P71UGXMzmriLzCCBvKQWBUv3vPB3m1SATMhp3uEjXHJ42jFg7myX',
  );
});

test('derivation is deterministic and isolated from the Alice root XPRV', () => {
  const mnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const first = deriveSatoraXprv(mnemonic);

  assert.equal(deriveSatoraXprv(mnemonic), first);
  assert.match(first, /^xprv/);
  assert.notEqual(
    first,
    'xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu',
  );
});

test('builds the Satora client without making the Alice mnemonic available', async () => {
  const mnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const { walletStorage, swapStorage } = createAliceSatoraStorage(
    mnemonic,
    new MemoryKeyValueStore(),
  );
  const client = await Client.builder()
    .withSignerStorage(walletStorage)
    .withSwapStorage(swapStorage)
    .withXprv(deriveSatoraXprv(mnemonic))
    .build();

  assert.throws(
    () => client.getMnemonic(),
    /wallet was initialized from an xprv/,
  );
  assert.equal(await walletStorage.getMnemonic(), null);
});
