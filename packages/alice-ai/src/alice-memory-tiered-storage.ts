import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { AliceMemoryStorage } from './alice-memory-core.ts';

// The phone keychain holds the memory while it stays small. It is not made
// for a value that grows without limit (Android warns past 2048 bytes), so a
// larger memory moves to an encrypted file in the app's documents directory,
// with the file key kept in the keychain. The keychain value then only says
// where the memory lives. Reading an older keychain value that still holds
// the JSON itself needs no step of its own: it is returned as is, and the
// next write places it on the right side of the threshold.

export const ALICE_MEMORY_KEYCHAIN_LIMIT_BYTES = 1800;
export const ALICE_MEMORY_FILE_MARKER = 'file:v1';
const FILE_KEY_BYTES = 32;
const NONCE_BYTES = 12;

export type AliceMemorySecureValues = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type AliceMemoryFile = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

export type AliceMemoryTieredStorageOptions = {
  secure: AliceMemorySecureValues;
  file: AliceMemoryFile;
  valueKey: string;
  fileKeyKey: string;
  limitBytes?: number;
};

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function encryptAliceMemoryFile(plaintext: string, keyHex: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = gcm(hexToBytes(keyHex), nonce).encrypt(utf8ToBytes(plaintext));
  return `${bytesToHex(nonce)}${bytesToHex(sealed)}`;
}

export function decryptAliceMemoryFile(payload: string, keyHex: string): string {
  const nonce = hexToBytes(payload.slice(0, NONCE_BYTES * 2));
  const sealed = hexToBytes(payload.slice(NONCE_BYTES * 2));
  return new TextDecoder().decode(gcm(hexToBytes(keyHex), nonce).decrypt(sealed));
}

export function createAliceMemoryTieredStorage(options: AliceMemoryTieredStorageOptions): AliceMemoryStorage {
  const limit = options.limitBytes ?? ALICE_MEMORY_KEYCHAIN_LIMIT_BYTES;

  async function fileKey(create: boolean): Promise<string | null> {
    const existing = await options.secure.get(options.fileKeyKey);
    if (existing || !create) return existing;
    const key = bytesToHex(randomBytes(FILE_KEY_BYTES));
    await options.secure.set(options.fileKeyKey, key);
    return key;
  }

  return {
    read: async () => {
      const value = await options.secure.get(options.valueKey);
      if (value !== ALICE_MEMORY_FILE_MARKER) return value;
      const [payload, key] = await Promise.all([options.file.read(), fileKey(false)]);
      if (!payload || !key) return null;
      try {
        return decryptAliceMemoryFile(payload, key);
      } catch {
        return null;
      }
    },
    write: async value => {
      if (utf8ByteLength(value) <= limit) {
        await options.secure.set(options.valueKey, value);
        await options.file.remove().catch(() => {});
        return;
      }
      const key = await fileKey(true);
      if (!key) throw new Error('The memory file key is unavailable.');
      await options.file.write(encryptAliceMemoryFile(value, key));
      await options.secure.set(options.valueKey, ALICE_MEMORY_FILE_MARKER);
    },
    remove: async () => {
      await Promise.all([
        options.secure.remove(options.valueKey),
        options.secure.remove(options.fileKeyKey),
        options.file.remove().catch(() => {}),
      ]);
    },
  };
}
