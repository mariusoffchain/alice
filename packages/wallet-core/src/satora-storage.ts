import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';
import type { ClientBuilder } from '@satora/swap';

const ENVELOPE_PREFIX = 'alice-satora:v1';
const NONCE_BYTES = 12;
const KEY_INDEX_ID = 'wallet:key-index:bip85-v1';
const SWAP_PREFIX = 'swap:';
const KEY_SALT = utf8ToBytes('alice-satora-storage-v1');
const KEY_INFO = utf8ToBytes('wallet-recovery-records');

type SatoraWalletStorageContract =
  Parameters<ClientBuilder['withSignerStorage']>[0];
type SatoraSwapStorageContract =
  Parameters<ClientBuilder['withSwapStorage']>[0];
export type SatoraStoredSwap = NonNullable<
  Awaited<ReturnType<SatoraSwapStorageContract['get']>>
>;
type SatoraSwapResponse = Parameters<SatoraSwapStorageContract['update']>[1];

export interface SatoraKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

function deriveStorageKey(mnemonic: string): Uint8Array {
  if (!mnemonic.trim()) throw new Error('Satora storage requires the wallet mnemonic.');
  return hkdf(
    sha256,
    utf8ToBytes(mnemonic.normalize('NFKD')),
    KEY_SALT,
    KEY_INFO,
    32,
  );
}

function parseEnvelope(value: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const parts = value.split(':');
  if (
    parts.length !== 4
    || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX
    || !/^[0-9a-f]{24}$/i.test(parts[2] ?? '')
    || !/^[0-9a-f]+$/i.test(parts[3] ?? '')
  ) {
    throw new Error('Satora recovery storage contains an invalid encrypted record.');
  }
  return {
    nonce: hexToBytes(parts[2]),
    ciphertext: hexToBytes(parts[3]),
  };
}

export class EncryptedSatoraStorage {
  private readonly encryptionKey: Uint8Array;
  private readonly values: SatoraKeyValueStore;

  constructor(
    mnemonic: string,
    values: SatoraKeyValueStore,
  ) {
    this.encryptionKey = deriveStorageKey(mnemonic);
    this.values = values;
  }

  async get<T>(key: string): Promise<T | null> {
    const encrypted = await this.values.get(key);
    if (encrypted === null) return null;
    const { nonce, ciphertext } = parseEnvelope(encrypted);
    let plaintext: Uint8Array;
    try {
      plaintext = gcm(this.encryptionKey, nonce, utf8ToBytes(key)).decrypt(ciphertext);
    } catch {
      throw new Error('Satora recovery storage could not authenticate an encrypted record.');
    }
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch {
      throw new Error('Satora recovery storage contains an unreadable record.');
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const nonce = randomBytes(NONCE_BYTES);
    const plaintext = utf8ToBytes(JSON.stringify(value));
    const ciphertext = gcm(
      this.encryptionKey,
      nonce,
      utf8ToBytes(key),
    ).encrypt(plaintext);
    await this.values.set(
      key,
      `${ENVELOPE_PREFIX}:${bytesToHex(nonce)}:${bytesToHex(ciphertext)}`,
    );
  }

  delete(key: string): Promise<void> {
    return this.values.delete(key);
  }

  keys(): Promise<string[]> {
    return this.values.keys();
  }
}

function validKeyIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('Satora recovery storage contains an invalid key index.');
  }
  return Number(value);
}

export class AliceSatoraWalletStorage implements SatoraWalletStorageContract {
  private mutation = Promise.resolve();
  private readonly storage: EncryptedSatoraStorage;

  constructor(storage: EncryptedSatoraStorage) {
    this.storage = storage;
  }

  getMnemonic(): Promise<string | null> {
    return Promise.resolve(null);
  }

  setMnemonic(_mnemonic: string): Promise<void> {
    return Promise.reject(
      new Error('Alice does not allow Satora to persist signer mnemonics.'),
    );
  }

  async getKeyIndex(): Promise<number> {
    await this.mutation;
    const index = await this.storage.get<unknown>(KEY_INDEX_ID);
    return index === null ? 0 : validKeyIndex(index);
  }

  setKeyIndex(index: number): Promise<void> {
    const validIndex = validKeyIndex(index);
    const operation = this.mutation.then(
      () => this.storage.set(KEY_INDEX_ID, validIndex),
      () => this.storage.set(KEY_INDEX_ID, validIndex),
    );
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }

  incrementKeyIndex(): Promise<number> {
    const operation = this.mutation.then(async () => {
      const current = await this.storage.get<unknown>(KEY_INDEX_ID);
      const index = current === null ? 0 : validKeyIndex(current);
      await this.storage.set(KEY_INDEX_ID, index + 1);
      return index;
    });
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }

  clear(): Promise<void> {
    const operation = this.mutation.then(
      () => this.storage.delete(KEY_INDEX_ID),
      () => this.storage.delete(KEY_INDEX_ID),
    );
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }
}

function swapKey(swapId: string): string {
  if (!swapId.trim()) throw new Error('Satora swap storage requires a swap id.');
  return `${SWAP_PREFIX}${swapId}`;
}

export class AliceSatoraSwapStorage implements SatoraSwapStorageContract {
  private mutation = Promise.resolve();
  private readonly storage: EncryptedSatoraStorage;

  constructor(storage: EncryptedSatoraStorage) {
    this.storage = storage;
  }

  async get(swapId: string): Promise<SatoraStoredSwap | null> {
    await this.mutation;
    return this.storage.get<SatoraStoredSwap>(swapKey(swapId));
  }

  store(swap: SatoraStoredSwap): Promise<void> {
    const operation = this.mutation.then(
      () => this.storage.set(swapKey(swap.swapId), swap),
      () => this.storage.set(swapKey(swap.swapId), swap),
    );
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }

  update(swapId: string, response: SatoraSwapResponse): Promise<void> {
    const operation = this.mutation.then(async () => {
      const stored = await this.storage.get<SatoraStoredSwap>(swapKey(swapId));
      if (!stored) throw new Error(`Satora swap ${swapId} is not stored locally.`);
      await this.storage.set(swapKey(swapId), {
        ...stored,
        response: {
          ...stored.response,
          ...response,
        },
        updatedAt: Date.now(),
      });
    });
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }

  delete(swapId: string): Promise<void> {
    const operation = this.mutation.then(
      () => this.storage.delete(swapKey(swapId)),
      () => this.storage.delete(swapKey(swapId)),
    );
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }

  async list(): Promise<string[]> {
    await this.mutation;
    return (await this.storage.keys())
      .filter(key => key.startsWith(SWAP_PREFIX))
      .map(key => key.slice(SWAP_PREFIX.length));
  }

  async getAll(): Promise<SatoraStoredSwap[]> {
    const ids = await this.list();
    const swaps = await Promise.all(ids.map(id => this.get(id)));
    return swaps.filter((swap): swap is SatoraStoredSwap => swap !== null);
  }

  clear(): Promise<void> {
    const operation = this.mutation.then(async () => {
      const keys = await this.storage.keys();
      await Promise.all(
        keys
          .filter(key => key.startsWith(SWAP_PREFIX))
          .map(key => this.storage.delete(key)),
      );
    });
    this.mutation = operation.then(() => {}, () => {});
    return operation;
  }
}

export function createAliceSatoraStorage(
  mnemonic: string,
  values: SatoraKeyValueStore,
): {
  encryptedStorage: EncryptedSatoraStorage;
  walletStorage: AliceSatoraWalletStorage;
  swapStorage: AliceSatoraSwapStorage;
} {
  const encryptedStorage = new EncryptedSatoraStorage(mnemonic, values);
  return {
    encryptedStorage,
    walletStorage: new AliceSatoraWalletStorage(encryptedStorage),
    swapStorage: new AliceSatoraSwapStorage(encryptedStorage),
  };
}
