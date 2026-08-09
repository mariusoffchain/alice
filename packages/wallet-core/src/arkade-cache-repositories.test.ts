import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ARKADE_CONTRACT_CACHE,
  ARKADE_SWAP_CACHE,
  ARKADE_WALLET_CACHE,
  createArkadeCacheRepositories,
  createArkadeCacheSwapRepository,
} from './arkade-cache-repositories.ts';

function installMemoryCacheStorage(): Map<string, Map<string, Response>> {
  const stores = new Map<string, Map<string, Response>>();
  (globalThis as typeof globalThis & { caches?: CacheStorage }).caches = {
    async open(name: string) {
      const values = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, values);
      return {
        async match(request: RequestInfo | URL) {
          const key = request instanceof Request ? request.url : String(request);
          return values.get(key)?.clone();
        },
        async put(request: RequestInfo | URL, response: Response) {
          const key = request instanceof Request ? request.url : String(request);
          values.set(key, response.clone());
        },
        async delete(request: RequestInfo | URL) {
          const key = request instanceof Request ? request.url : String(request);
          return values.delete(key);
        },
      } as Cache;
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  } as CacheStorage;
  return stores;
}

afterEach(() => {
  delete (globalThis as any).caches;
  delete (globalThis as any).location;
});

describe('Arkade Cache Storage repositories', () => {
  it('persists wallet state and contracts without IndexedDB', async () => {
    installMemoryCacheStorage();
    const first = createArkadeCacheRepositories('abandon abandon abandon about');

    await first.walletRepository.saveWalletState({
      lastSyncTime: 123,
      settings: { vtxoCursorMigrated: true },
    });
    await first.contractRepository.saveContract({
      type: 'default',
      params: { user: '02abcdef' },
      script: '5120abcdef',
      address: 'tark1example',
      state: 'active',
      createdAt: 123,
      metadata: { signingDescriptor: 'wpkh(example)' },
    });

    const reopened = createArkadeCacheRepositories('abandon abandon abandon about');
    assert.deepEqual(await reopened.walletRepository.getWalletState(), {
      lastSyncTime: 123,
      settings: { vtxoCursorMigrated: true },
    });
    assert.equal((await reopened.contractRepository.getContracts())[0]?.script, '5120abcdef');
    assert.equal(
      (await reopened.contractRepository.getContracts({ state: 'inactive' })).length,
      0,
    );
  });

  it('stores ciphertext rather than wallet or contract plaintext', async () => {
    const stores = installMemoryCacheStorage();
    const repositories = createArkadeCacheRepositories('abandon abandon abandon about');

    await repositories.walletRepository.saveWalletState({ settings: { secretMarker: 'wallet-plain' } });
    await repositories.contractRepository.saveContract({
      type: 'default',
      params: {},
      script: 'contract-plain',
      address: 'tark1example',
      state: 'active',
      createdAt: 123,
    });

    const walletBodies = await Promise.all(
      [...(stores.get(ARKADE_WALLET_CACHE)?.values() ?? [])].map(response => response.text()),
    );
    const contractBodies = await Promise.all(
      [...(stores.get(ARKADE_CONTRACT_CACHE)?.values() ?? [])].map(response => response.text()),
    );
    assert.doesNotMatch(walletBodies.join(''), /wallet-plain/);
    assert.doesNotMatch(contractBodies.join(''), /contract-plain/);
  });

  it('cannot decrypt repository data with another mnemonic', async () => {
    installMemoryCacheStorage();
    const first = createArkadeCacheRepositories('abandon abandon abandon about');
    await first.walletRepository.saveWalletState({ lastSyncTime: 123 });

    const wrongWallet = createArkadeCacheRepositories('legal winner thank year');
    await assert.rejects(wrongWallet.walletRepository.getWalletState());
  });

  it('persists and filters encrypted swap recovery records', async () => {
    const stores = installMemoryCacheStorage();
    const repository = createArkadeCacheSwapRepository('abandon abandon abandon about');
    const swap = {
      id: 'swap-1',
      type: 'submarine',
      status: 'swap.created',
      createdAt: 123,
    } as any;

    await repository.saveSwap(swap);

    const reopened = createArkadeCacheSwapRepository('abandon abandon abandon about');
    assert.equal((await reopened.getAllSwaps({ id: 'swap-1' })).length, 1);
    assert.equal((await reopened.getAllSwaps({ id: 'swap-2' })).length, 0);
    const bodies = await Promise.all(
      [...(stores.get(ARKADE_SWAP_CACHE)?.values() ?? [])].map(response => response.text()),
    );
    assert.doesNotMatch(bodies.join(''), /swap-1/);
  });
});
