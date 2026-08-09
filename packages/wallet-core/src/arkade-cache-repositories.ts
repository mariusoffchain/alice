import {
  WalletRepositoryImpl,
  type ArkTransaction,
  type Contract,
  type ContractRepository,
  type ExtendedCoin,
  type ExtendedVirtualCoin,
  type WalletRepository,
} from '@arkade-os/sdk';
import type { StorageAdapter } from '@arkade-os/sdk/adapters/indexedDB';
import type {
  BoltzSwap,
  SwapRepository,
} from '@arkade-os/boltz-swap';

export const ARKADE_WALLET_CACHE = 'alice-arkade-wallet-data-v1';
export const ARKADE_CONTRACT_CACHE = 'alice-arkade-contract-data-v1';
export const ARKADE_SWAP_CACHE = 'alice-arkade-swap-data-v1';
export const ARKADE_CACHE_NAMES = [
  ARKADE_WALLET_CACHE,
  ARKADE_CONTRACT_CACHE,
  ARKADE_SWAP_CACHE,
] as const;

const CACHE_PATH = '/.alice-arkade-data/';
const KEY_ITERATIONS = 120_000;

type EncryptedValue = {
  version: 1;
  iv: string;
  ciphertext: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveCacheKey(mnemonic: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(mnemonic),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('alice-arkade-cache-v1'),
      iterations: KEY_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function cacheUrl(cacheName: string, key: string): string {
  const origin = typeof location !== 'undefined' && location.origin
    ? location.origin
    : 'https://alice.local';
  return new URL(`${CACHE_PATH}${encodeURIComponent(cacheName)}/${encodeURIComponent(key)}`, origin).toString();
}

class EncryptedCacheAdapter implements StorageAdapter {
  private readonly cacheName: string;
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(cacheName: string, mnemonic: string) {
    this.cacheName = cacheName;
    this.keyPromise = deriveCacheKey(mnemonic);
  }

  async getItem(key: string): Promise<string | null> {
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(cacheUrl(this.cacheName, key));
    if (!response) return null;
    const encrypted = await response.json() as EncryptedValue;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(encrypted.iv) },
      await this.keyPromise,
      base64ToBytes(encrypted.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  }

  async setItem(key: string, value: string): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.keyPromise,
      new TextEncoder().encode(value),
    );
    const encrypted: EncryptedValue = {
      version: 1,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
    const cache = await caches.open(this.cacheName);
    await cache.put(
      cacheUrl(this.cacheName, key),
      new Response(JSON.stringify(encrypted), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  async removeItem(key: string): Promise<void> {
    const cache = await caches.open(this.cacheName);
    await cache.delete(cacheUrl(this.cacheName, key));
  }

  async clear(): Promise<void> {
    await caches.delete(this.cacheName);
  }
}

class CacheWalletRepository implements WalletRepository {
  readonly version = 1 as const;
  private readonly delegate: WalletRepositoryImpl;
  private readonly storage: EncryptedCacheAdapter;

  constructor(storage: EncryptedCacheAdapter) {
    this.storage = storage;
    this.delegate = new WalletRepositoryImpl(storage);
  }

  clear(): Promise<void> {
    return this.storage.clear();
  }

  getVtxos(address: string): Promise<ExtendedVirtualCoin[]> {
    return this.delegate.getVtxos(address);
  }

  saveVtxos(address: string, vtxos: ExtendedVirtualCoin[]): Promise<void> {
    return this.delegate.saveVtxos(address, vtxos);
  }

  deleteVtxos(address: string): Promise<void> {
    return this.delegate.deleteVtxos(address);
  }

  getUtxos(address: string): Promise<ExtendedCoin[]> {
    return this.delegate.getUtxos(address);
  }

  saveUtxos(address: string, utxos: ExtendedCoin[]): Promise<void> {
    return this.delegate.saveUtxos(address, utxos);
  }

  deleteUtxos(address: string): Promise<void> {
    return this.delegate.deleteUtxos(address);
  }

  getTransactionHistory(address: string): Promise<ArkTransaction[]> {
    return this.delegate.getTransactionHistory(address);
  }

  saveTransactions(address: string, transactions: ArkTransaction[]): Promise<void> {
    return this.delegate.saveTransactions(address, transactions);
  }

  deleteTransactions(address: string): Promise<void> {
    return this.delegate.deleteTransactions(address);
  }

  getWalletState(): ReturnType<WalletRepositoryImpl['getWalletState']> {
    return this.delegate.getWalletState();
  }

  saveWalletState(state: Parameters<WalletRepositoryImpl['saveWalletState']>[0]): Promise<void> {
    return this.delegate.saveWalletState(state);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.delegate[Symbol.asyncDispose]();
  }
}

class CacheContractRepository implements ContractRepository {
  readonly version = 1 as const;
  private readonly storage: EncryptedCacheAdapter;
  private readonly key = 'contracts';

  constructor(mnemonic: string) {
    this.storage = new EncryptedCacheAdapter(ARKADE_CONTRACT_CACHE, mnemonic);
  }

  private async readAll(): Promise<Contract[]> {
    const stored = await this.storage.getItem(this.key);
    return stored ? JSON.parse(stored) as Contract[] : [];
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }

  async getContracts(
    filter?: Parameters<ContractRepository['getContracts']>[0],
  ): Promise<Contract[]> {
    const contracts = await this.readAll();
    if (!filter) return contracts;
    const scripts = filter.script
      ? new Set(Array.isArray(filter.script) ? filter.script : [filter.script])
      : null;
    const states = filter.state
      ? new Set(Array.isArray(filter.state) ? filter.state : [filter.state])
      : null;
    const types = filter.type
      ? new Set(Array.isArray(filter.type) ? filter.type : [filter.type])
      : null;
    return contracts.filter(contract =>
      (!scripts || scripts.has(contract.script))
      && (!states || states.has(contract.state))
      && (!types || types.has(contract.type))
    );
  }

  async saveContract(contract: Contract): Promise<void> {
    const contracts = await this.readAll();
    const index = contracts.findIndex(candidate => candidate.script === contract.script);
    if (index >= 0) contracts[index] = contract;
    else contracts.push(contract);
    await this.storage.setItem(this.key, JSON.stringify(contracts));
  }

  async deleteContract(script: string): Promise<void> {
    const contracts = (await this.readAll()).filter(contract => contract.script !== script);
    await this.storage.setItem(this.key, JSON.stringify(contracts));
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}

class CacheSwapRepository implements SwapRepository {
  readonly version = 1 as const;
  private readonly storage: EncryptedCacheAdapter;
  private readonly key = 'swaps';

  constructor(mnemonic: string) {
    this.storage = new EncryptedCacheAdapter(ARKADE_SWAP_CACHE, mnemonic);
  }

  private async readAll<T extends BoltzSwap>(): Promise<T[]> {
    const stored = await this.storage.getItem(this.key);
    return stored ? JSON.parse(stored) as T[] : [];
  }

  async saveSwap<T extends BoltzSwap>(swap: T): Promise<void> {
    const swaps = await this.readAll<BoltzSwap>();
    const index = swaps.findIndex(candidate => candidate.id === swap.id);
    if (index >= 0) swaps[index] = swap;
    else swaps.push(swap);
    await this.storage.setItem(this.key, JSON.stringify(swaps));
  }

  async deleteSwap(id: string): Promise<void> {
    const swaps = (await this.readAll<BoltzSwap>()).filter(swap => swap.id !== id);
    await this.storage.setItem(this.key, JSON.stringify(swaps));
  }

  async getAllSwaps<T extends BoltzSwap>(
    filter?: Parameters<SwapRepository['getAllSwaps']>[0],
  ): Promise<T[]> {
    let swaps = await this.readAll<T>();
    if (filter?.id) {
      const values = new Set(Array.isArray(filter.id) ? filter.id : [filter.id]);
      swaps = swaps.filter(swap => values.has(swap.id));
    }
    if (filter?.status) {
      const values = new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
      swaps = swaps.filter(swap => values.has(swap.status));
    }
    if (filter?.type) {
      const values = new Set(Array.isArray(filter.type) ? filter.type : [filter.type]);
      swaps = swaps.filter(swap => values.has(swap.type));
    }
    if (filter?.orderBy === 'createdAt') {
      const direction = filter.orderDirection === 'desc' ? -1 : 1;
      swaps.sort((left, right) => direction * (left.createdAt - right.createdAt));
    }
    return swaps;
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}

export function createArkadeCacheRepositories(mnemonic: string): {
  walletRepository: WalletRepository;
  contractRepository: ContractRepository;
} {
  return {
    walletRepository: new CacheWalletRepository(
      new EncryptedCacheAdapter(ARKADE_WALLET_CACHE, mnemonic),
    ),
    contractRepository: new CacheContractRepository(mnemonic),
  };
}

export function createArkadeCacheSwapRepository(mnemonic: string): SwapRepository {
  return new CacheSwapRepository(mnemonic);
}
