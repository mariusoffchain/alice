import assert from 'node:assert/strict';
import test from 'node:test';
import type { SatoraKeyValueStore } from './satora-storage.ts';
import {
  ReceiveAddressController,
} from './receive-addresses.ts';
import { WalletStateStorage } from './wallet-state-storage.ts';

class MemoryStore implements SatoraKeyValueStore {
  readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async keys() { return [...this.values.keys()]; }
}

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('reserving an Arkade address keeps the shared contract active and rotates the default', async () => {
  let arkade = 'ark-old';
  let script = 'script-old';
  const stateChanges: Array<[string, string]> = [];
  const wallet = {
    getAddress: async () => arkade,
    getBoardingAddress: async () => 'btc-old',
    getNewBoardingAddress: async () => 'btc-new',
    getVtxoManager: async () => ({}),
    getContractManager: async () => ({
      setContractState: async (target: string, state: string) => {
        stateChanges.push([target, state]);
      },
    }),
    get defaultContractScript() {
      return script;
    },
    _receiveRotator: {
      runExclusive: async <T>(operation: () => Promise<T>) => operation(),
      rotate: async () => {
        arkade = 'ark-new';
        script = 'script-new';
      },
    },
  };
  const storage = new WalletStateStorage(mnemonic, new MemoryStore());
  const controller = new ReceiveAddressController(wallet as never, storage);

  await controller.initialize();
  await controller.update('ark-old', { label: 'Savings' });
  assert.equal(await controller.reserveArkade(), 'ark-old');
  assert.deepEqual(stateChanges, [['script-old', 'active']]);

  const byAddress = new Map((await controller.list()).map(item => [item.address, item]));
  assert.equal(byAddress.get('ark-old')?.label, 'Savings');
  assert.equal(byAddress.get('ark-old')?.shared, true);
  assert.equal(byAddress.get('ark-old')?.current, false);
  assert.equal(byAddress.get('ark-new')?.current, true);
});

test('reserving a boarding address rotates before exposing the old address', async () => {
  let boarding = 'btc-old';
  const wallet = {
    getAddress: async () => 'ark-current',
    getBoardingAddress: async () => boarding,
    getNewBoardingAddress: async () => {
      boarding = 'btc-new';
      return boarding;
    },
    getVtxoManager: async () => ({}),
    getContractManager: async () => ({ setContractState: async () => {} }),
    defaultContractScript: 'script',
  };
  const controller = new ReceiveAddressController(
    wallet as never,
    new WalletStateStorage(mnemonic, new MemoryStore()),
  );

  await controller.initialize();
  assert.equal(await controller.reserveOnchain(), 'btc-old');
  const byAddress = new Map((await controller.list()).map(item => [item.address, item]));
  assert.equal(byAddress.get('btc-old')?.shared, true);
  assert.equal(byAddress.get('btc-old')?.current, false);
  assert.equal(byAddress.get('btc-new')?.current, true);
});

test('only previous addresses can be archived and restored', async () => {
  let boarding = 'btc-old';
  const wallet = {
    getAddress: async () => 'ark-current',
    getBoardingAddress: async () => boarding,
    getNewBoardingAddress: async () => {
      boarding = 'btc-new';
      return boarding;
    },
    getVtxoManager: async () => ({}),
    getContractManager: async () => ({ setContractState: async () => {} }),
    defaultContractScript: 'script',
  };
  const controller = new ReceiveAddressController(
    wallet as never,
    new WalletStateStorage(mnemonic, new MemoryStore()),
  );

  await controller.initialize();
  await assert.rejects(
    () => controller.update('btc-old', { archived: true }),
    /Generate a new address/,
  );
  await controller.reserveOnchain();
  assert.equal((await controller.update('btc-old', { archived: true })).archived, true);
  assert.equal((await controller.update('btc-old', { archived: false })).archived, false);
});

test('manual address rotation is not blocked after 15 unused addresses', async () => {
  let arkadeIndex = 0;
  let script = 'script-0';
  const wallet = {
    getAddress: async () => `ark-${arkadeIndex}`,
    getBoardingAddress: async () => 'btc-current',
    getNewBoardingAddress: async () => 'btc-next',
    getVtxoManager: async () => ({}),
    getContractManager: async () => ({ setContractState: async () => {} }),
    get defaultContractScript() {
      return script;
    },
    _receiveRotator: {
      runExclusive: async <T>(operation: () => Promise<T>) => operation(),
      rotate: async () => {
        arkadeIndex += 1;
        script = `script-${arkadeIndex}`;
      },
    },
  };
  const controller = new ReceiveAddressController(
    wallet as never,
    new WalletStateStorage(mnemonic, new MemoryStore()),
  );

  await controller.initialize();
  for (let index = 0; index < 20; index += 1) {
    await controller.reserveArkade();
  }
  assert.equal(arkadeIndex, 20);
  assert.equal(
    (await controller.list()).filter(item => item.layer === 'arkade').length,
    21,
  );
});

test('a unified manual rotation advances both current addresses', async () => {
  let arkadeIndex = 0;
  let boardingIndex = 0;
  let script = 'script-0';
  const wallet = {
    getAddress: async () => `ark-${arkadeIndex}`,
    getBoardingAddress: async () => `btc-${boardingIndex}`,
    getNewBoardingAddress: async () => {
      boardingIndex += 1;
      return `btc-${boardingIndex}`;
    },
    getVtxoManager: async () => ({}),
    getContractManager: async () => ({ setContractState: async () => {} }),
    get defaultContractScript() {
      return script;
    },
    _receiveRotator: {
      runExclusive: async <T>(operation: () => Promise<T>) => operation(),
      rotate: async () => {
        arkadeIndex += 1;
        script = `script-${arkadeIndex}`;
      },
    },
  };
  const controller = new ReceiveAddressController(
    wallet as never,
    new WalletStateStorage(mnemonic, new MemoryStore()),
  );

  await controller.initialize();
  assert.deepEqual(await controller.reserveUnified(), {
    arkade: 'ark-0',
    onchain: 'btc-0',
  });
  const current = (await controller.list()).filter(item => item.current);
  assert.deepEqual(
    current.map(item => item.address).sort(),
    ['ark-1', 'btc-1'],
  );
});

test('a failed SDK rotation leaves the current address unchanged', async () => {
  const wallet = {
    getAddress: async () => 'ark-current',
    getBoardingAddress: async () => 'btc-current',
    getNewBoardingAddress: async () => 'btc-next',
    getVtxoManager: async () => ({}),
    getContractManager: async () => ({ setContractState: async () => {} }),
    defaultContractScript: 'script',
    _receiveRotator: {
      runExclusive: async <T>(operation: () => Promise<T>) => operation(),
      rotate: async () => {
        throw new Error('rotation failed');
      },
    },
  };
  const controller = new ReceiveAddressController(
    wallet as never,
    new WalletStateStorage(mnemonic, new MemoryStore()),
  );

  await controller.initialize();
  await assert.rejects(() => controller.reserveArkade(), /rotation failed/);
  const current = (await controller.list()).filter(item => item.current);
  assert.equal(current.find(item => item.layer === 'arkade')?.address, 'ark-current');
});
