import assert from 'node:assert/strict';
import test from 'node:test';
import type { SatoraKeyValueStore } from './satora-storage.ts';
import { WalletStateStorage } from './wallet-state-storage.ts';
import type { EmergencyExitState } from './wallet-backend.ts';

class MemoryStore implements SatoraKeyValueStore {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async keys() {
    return [...this.values.keys()];
  }
}

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('wallet lifecycle records are encrypted and survive controller recreation', async () => {
  const values = new MemoryStore();
  const storage = new WalletStateStorage(mnemonic, values);
  const id = `${'a'.repeat(64)}:0`;
  await storage.setExclusion(id, 'Rejected by Arkade');

  const raw = [...values.values.values()].join('');
  assert.equal(raw.includes(id), false);
  assert.equal(raw.includes('Rejected by Arkade'), false);

  const reopened = new WalletStateStorage(mnemonic, values);
  assert.deepEqual(await reopened.getExclusions(), [{
    id,
    reason: 'Rejected by Arkade',
    excludedAt: (await reopened.getExclusions())[0].excludedAt,
  }]);
});

test('wallet lifecycle storage authenticates records with the wallet recovery phrase', async () => {
  const values = new MemoryStore();
  await new WalletStateStorage(mnemonic, values).setExclusion(
    `${'b'.repeat(64)}:1`,
    'Rejected',
  );
  const wrongWallet = new WalletStateStorage(`${mnemonic} wrong`, values);
  await assert.rejects(
    () => wrongWallet.getExclusions(),
    /could not authenticate/,
  );
});

test('wallet lifecycle storage persists and clears an emergency exit', async () => {
  const values = new MemoryStore();
  const storage = new WalletStateStorage(mnemonic, values);
  const now = Date.now();
  const state: EmergencyExitState = {
    version: 1,
    stage: 'waiting-confirmation',
    destination: `bc1p${'q'.repeat(58)}`,
    selectedIds: [`${'c'.repeat(64)}:0`],
    selectedAmountSats: 10_000,
    feeAddress: `bc1p${'p'.repeat(58)}`,
    feeBalanceSats: 2_000,
    completedVtxoIds: [],
    currentTxid: 'd'.repeat(64),
    createdAt: now,
    updatedAt: now,
  };
  await storage.setEmergencyExit(state);
  assert.deepEqual(await storage.getEmergencyExit(), state);

  await storage.clearEmergencyExit();
  assert.equal(await storage.getEmergencyExit(), null);
});

test('wallet lifecycle storage rejects a malformed emergency exit record', async () => {
  const storage = new WalletStateStorage(mnemonic, new MemoryStore());
  await storage.setEmergencyExit({
    version: 1,
    stage: 'completed',
    destination: '',
  } as EmergencyExitState);

  await assert.rejects(
    () => storage.getEmergencyExit(),
    /invalid emergency exit record/,
  );
});

test('resolved exclusions can be removed without touching other records', async () => {
  const storage = new WalletStateStorage(mnemonic, new MemoryStore());
  const first = `${'e'.repeat(64)}:0`;
  const second = `${'f'.repeat(64)}:1`;
  await storage.setExclusion(first, 'First');
  await storage.setExclusion(second, 'Second');

  assert.deepEqual(await storage.removeExclusions([first]), [first]);
  assert.deepEqual((await storage.getExclusions()).map(item => item.id), [second]);
});

test('frozen VTXOs and address labels remain encrypted and independently mutable', async () => {
  const values = new MemoryStore();
  const storage = new WalletStateStorage(mnemonic, values);
  const id = `${'1'.repeat(64)}:2`;
  const address = `ark1${'q'.repeat(70)}`;

  await storage.setVtxoFrozen(id, true);
  await storage.upsertReceiveAddress({
    address,
    layer: 'arkade',
    label: 'Salary',
    shared: true,
    used: false,
    current: false,
  });
  await storage.updateReceiveAddress(address, {
    used: true,
    label: 'Employer',
    archived: true,
  });

  const raw = [...values.values.values()].join('');
  assert.equal(raw.includes(id), false);
  assert.equal(raw.includes(address), false);
  assert.equal(raw.includes('Employer'), false);

  const reopened = new WalletStateStorage(mnemonic, values);
  assert.deepEqual((await reopened.getFrozenVtxos()).map(item => item.id), [id]);
  assert.deepEqual(
    (await reopened.getReceiveAddresses()).map(item => ({
      address: item.address,
      label: item.label,
      shared: item.shared,
      used: item.used,
      archived: item.archived,
    })),
    [{ address, label: 'Employer', shared: true, used: true, archived: true }],
  );

  assert.deepEqual(await reopened.removeFrozenVtxos([id]), [id]);
  assert.deepEqual(await reopened.getFrozenVtxos(), []);
});

test('a new current address retires only the previous address on the same layer', async () => {
  const storage = new WalletStateStorage(mnemonic, new MemoryStore());
  await storage.upsertReceiveAddress({
    address: 'ark-old',
    layer: 'arkade',
    label: '',
    shared: true,
    used: false,
    current: true,
  });
  await storage.upsertReceiveAddress({
    address: 'btc-current',
    layer: 'onchain',
    label: '',
    shared: false,
    used: false,
    current: true,
  });
  await storage.upsertReceiveAddress({
    address: 'ark-new',
    layer: 'arkade',
    label: '',
    shared: false,
    used: false,
    current: true,
  });

  const byAddress = new Map(
    (await storage.getReceiveAddresses()).map(item => [item.address, item]),
  );
  assert.equal(byAddress.get('ark-old')?.current, false);
  assert.equal(byAddress.get('ark-new')?.current, true);
  assert.equal(byAddress.get('btc-current')?.current, true);
});
