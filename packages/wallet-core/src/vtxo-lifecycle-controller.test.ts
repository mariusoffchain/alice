import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtendedVirtualCoin } from '@arkade-os/sdk';
import type { SatoraKeyValueStore } from './satora-storage.ts';
import { WalletStateStorage } from './wallet-state-storage.ts';
import {
  VTXO_RENEWAL_THRESHOLD_MS,
  VtxoLifecycleController,
} from './vtxo-lifecycle.ts';

class MemoryStore implements SatoraKeyValueStore {
  private readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async keys() { return [...this.values.keys()]; }
}

function coin(txid: string, value = 5_000): ExtendedVirtualCoin {
  return {
    txid,
    vout: 0,
    value,
    isSpent: false,
    isUnrolled: false,
    createdAt: new Date(),
    virtualStatus: {
      state: 'settled',
      batchExpiry: Date.now() + VTXO_RENEWAL_THRESHOLD_MS - 1_000,
    },
  } as ExtendedVirtualCoin;
}

function setup(vtxos: ExtendedVirtualCoin[]) {
  const targetedSyncs: Array<Array<{ txid: string; vout: number }>> = [];
  let fullSyncs = 0;
  const settlements: unknown[] = [];
  let delegateEnabled = false;
  let delegateVtxos: ExtendedVirtualCoin[] = [];
  const wallet = {
    dustAmount: 330n,
    arkProvider: {
      getInfo: async () => ({ vtxoMaxAmount: -1n }),
    },
    getContractManager: async () => ({
      refreshOutpoints: async (outpoints: Array<{ txid: string; vout: number }>) => {
        targetedSyncs.push(outpoints);
      },
      refreshVtxos: async () => { fullSyncs += 1; },
      getContractsWithVtxos: async () => delegateEnabled
        ? [{
            contract: { type: 'delegate' },
            vtxos: delegateVtxos,
          }]
        : [],
    }),
    getDelegateManager: async () => delegateEnabled ? {} : undefined,
    getVtxos: async () => vtxos,
    getAddress: async () => 'ark1destination',
    settle: async (params: unknown) => {
      settlements.push(params);
      return 'settlement-txid';
    },
  };
  const storage = new WalletStateStorage(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    new MemoryStore(),
  );
  return {
    controller: new VtxoLifecycleController(wallet as never, storage),
    storage,
    settlements,
    targetedSyncs,
    getFullSyncs: () => fullSyncs,
    enableDelegate: (nextVtxos: ExtendedVirtualCoin[]) => {
      delegateEnabled = true;
      delegateVtxos = nextVtxos;
    },
  };
}

test('full VTXO sync refreshes state without creating a settlement', async () => {
  const context = setup([coin('a'.repeat(64))]);
  const result = await context.controller.sync();
  assert.equal(context.getFullSyncs(), 1);
  assert.equal(context.settlements.length, 0);
  assert.equal(result.inputIds.length, 1);
});

test('renew settles only the explicitly selected and revalidated VTXO', async () => {
  const first = coin('a'.repeat(64), 5_000);
  const second = coin('b'.repeat(64), 7_000);
  const context = setup([first, second]);
  const firstId = `${first.txid}:0`;

  const result = await context.controller.renew([firstId]);

  assert.deepEqual(context.targetedSyncs, [[{ txid: first.txid, vout: 0 }]]);
  assert.equal(result.amountSats, 5_000);
  assert.deepEqual(result.inputIds, [firstId]);
  assert.equal(context.settlements.length, 1);
  const settlement = context.settlements[0] as {
    inputs: ExtendedVirtualCoin[];
    outputs: Array<{ amount: bigint }>;
  };
  assert.deepEqual(settlement.inputs.map(input => input.txid), [first.txid]);
  assert.equal(settlement.outputs[0].amount, 5_000n);
});

test('foreground maintenance synchronizes first and renews an eligible batch', async () => {
  const expiring = coin('d'.repeat(64), 6_000);
  const fresh = coin('e'.repeat(64), 8_000);
  fresh.virtualStatus.batchExpiry = Date.now() + VTXO_RENEWAL_THRESHOLD_MS + 60_000;
  const context = setup([expiring, fresh]);

  const result = await context.controller.maintain();

  assert.equal(context.getFullSyncs(), 1);
  assert.deepEqual(context.targetedSyncs, [[{ txid: expiring.txid, vout: 0 }]]);
  assert.deepEqual(result.renewal?.inputIds, [`${expiring.txid}:0`]);
  assert.equal(context.settlements.length, 1);
});

test('foreground maintenance leaves delegate VTXOs to the configured delegate', async () => {
  const delegated = coin('f'.repeat(64), 6_000);
  const legacy = coin('1'.repeat(64), 8_000);
  const context = setup([delegated, legacy]);
  context.enableDelegate([delegated]);

  const result = await context.controller.maintain();

  assert.deepEqual(result.renewal?.inputIds, [`${legacy.txid}:0`]);
  assert.equal(context.settlements.length, 1);
});

test('sync removes an exclusion only after the authoritative input is spent', async () => {
  const spent = coin('c'.repeat(64));
  spent.isSpent = true;
  const context = setup([spent]);
  const id = `${spent.txid}:0`;
  await context.storage.setExclusion(id, 'Rejected input');

  const result = await context.controller.sync([id]);

  assert.deepEqual(result.removedExclusions, [id]);
  assert.deepEqual(await context.storage.getExclusions(), []);
});
