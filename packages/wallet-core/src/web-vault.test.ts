import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  clearWebVault,
  clearWebVaultPin,
  deriveWebPinVerifier,
  diagnoseWebStorage,
  getWebStorageDiagnostics,
  isWebBackupComplete,
  isWebOnboarded,
  loadWebMnemonic,
  lockWebVault,
  markWebBackupComplete,
  markWebOnboarded,
  saveWebMnemonic,
  setWebVaultPin,
  unlockWebVault,
  WebStorageError,
} from './web-vault.ts';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function installWindow(storage: Storage | null, isSecureContext = true): void {
  const value: { isSecureContext: boolean; localStorage?: Storage } = { isSecureContext };
  if (storage) value.localStorage = storage;
  (globalThis as any).window = value;
}

function installMemoryIndexedDB(
  initial: Map<string, Map<string, Map<string, unknown>>> = new Map(),
): Map<string, Map<string, Map<string, unknown>>> {
  const databases = initial;
  const versions = new Map([...initial.keys()].map(name => [name, 1]));
  (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB = {
    open(name: string, requestedVersion?: number) {
      const open = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;
      setTimeout(() => {
        const isNew = !databases.has(name);
        const currentVersion = versions.get(name) ?? 0;
        const nextVersion = requestedVersion ?? Math.max(currentVersion, 1);
        const needsUpgrade = isNew || nextVersion > currentVersion;
        const stores = databases.get(name) ?? new Map<string, Map<string, unknown>>();
        databases.set(name, stores);
        versions.set(name, nextVersion);
        const db = {
          objectStoreNames: { contains: (storeName: string) => stores.has(storeName) },
          createObjectStore(storeName: string) {
            const values = new Map<string, unknown>();
            stores.set(storeName, values);
            return {};
          },
          close: () => {},
          transaction: (storeName: string) => {
            const values = stores.get(storeName);
            if (!values) throw new DOMException(`Missing object store ${storeName}`);
            const transaction = {
              error: null,
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              objectStore: () => ({
                get(id: string) {
                  const request = {
                    result: undefined,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  } as unknown as IDBRequest<unknown>;
                  setTimeout(() => {
                    (request as unknown as { result: unknown }).result = values.get(id);
                    request.onsuccess?.(new Event('success'));
                  }, 0);
                  return request;
                },
                put(value: unknown, id: string) {
                  const request = {
                    result: undefined,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  } as unknown as IDBRequest<IDBValidKey>;
                  setTimeout(() => {
                    values.set(id, value);
                    request.onsuccess?.(new Event('success'));
                    transaction.oncomplete?.();
                  }, 0);
                  return request;
                },
                delete(id: string) {
                  const request = {
                    result: undefined,
                    error: null,
                    onsuccess: null,
                    onerror: null,
                  } as unknown as IDBRequest<undefined>;
                  setTimeout(() => {
                    values.delete(id);
                    request.onsuccess?.(new Event('success'));
                    transaction.oncomplete?.();
                  }, 0);
                  return request;
                },
              }),
            };
            return transaction;
          },
        } as unknown as IDBDatabase;
        (open as unknown as { result: IDBDatabase }).result = db;
        if (needsUpgrade) {
          open.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
        }
        open.onsuccess?.(new Event('success'));
      }, 0);
      return open;
    },
    deleteDatabase(name: string) {
      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;
      setTimeout(() => {
        databases.delete(name);
        request.onsuccess?.(new Event('success'));
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;
  return databases;
}

function installLegacyIndexedDB(values: Map<string, unknown>): void {
  installMemoryIndexedDB(new Map([
    ['alice-web-vault', new Map([
      ['vault', values],
    ])],
  ]));
}

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
  } as CacheStorage;
  return stores;
}

afterEach(() => {
  lockWebVault();
  delete (globalThis as any).indexedDB;
  delete (globalThis as any).caches;
  delete (globalThis as any).location;
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
});

describe('diagnoseWebStorage', () => {
  it('passes with localStorage and Web Crypto when IndexedDB is unavailable', async () => {
    installWindow(new MemoryStorage());
    await diagnoseWebStorage();
  });

  it('reports unavailable first-party storage without blaming HTTPS in a secure context', async () => {
    installWindow(null);
    await assert.rejects(
      diagnoseWebStorage(),
      (cause: unknown) => {
        assert.ok(cause instanceof WebStorageError);
        assert.equal(cause.code, 'storage_unavailable');
        assert.doesNotMatch(cause.message, /HTTPS/);
        return true;
      },
    );
  });

  it('mentions HTTPS only when the browser context is insecure', async () => {
    installWindow(null, false);
    await assert.rejects(
      diagnoseWebStorage(),
      (cause: unknown) => {
        assert.ok(cause instanceof WebStorageError);
        assert.match(cause.message, /HTTPS/);
        return true;
      },
    );
  });

  it('reports the exact localStorage error while accepting IndexedDB', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    installWindow(storage);
    installMemoryIndexedDB();

    const diagnostics = await getWebStorageDiagnostics();
    assert.equal(diagnostics.localStorage.available, false);
    assert.equal(diagnostics.localStorage.errorCode, 'localstorage_write_failed');
    assert.equal(diagnostics.localStorage.errorName, 'SecurityError');
    assert.equal(diagnostics.indexedDB.available, true);
    await diagnoseWebStorage();
  });

  it('keeps the underlying browser exception when every storage engine fails', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('The operation is insecure', 'SecurityError');
    };
    installWindow(storage);

    await assert.rejects(
      diagnoseWebStorage(),
      (cause: unknown) => {
        assert.ok(cause instanceof WebStorageError);
        assert.equal(cause.code, 'storage_unavailable');
        assert.match(cause.message, /SecurityError/);
        assert.match(cause.message, /The operation is insecure/);
        return true;
      },
    );
  });
});

describe('web vault hybrid persistence', () => {
  it('derives a slow, deterministic PIN verifier without storing the PIN', async () => {
    installWindow(new MemoryStorage());
    const salt = '00112233445566778899aabbccddeeff';
    const first = await deriveWebPinVerifier('123456', salt);
    const second = await deriveWebPinVerifier('123456', salt);
    const wrong = await deriveWebPinVerifier('654321', salt);

    assert.equal(first, second);
    assert.notEqual(first, wrong);
    assert.match(first, /^[0-9a-f]{64}$/);
  });

  it('saves and reloads an encrypted mnemonic without IndexedDB or a PIN', async () => {
    const storage = new MemoryStorage();
    installWindow(storage);
    await saveWebMnemonic('abandon abandon abandon about');

    assert.equal(await loadWebMnemonic(), 'abandon abandon abandon about');
    assert.doesNotMatch(storage.getItem('alice_web_vault_mnemonic') ?? '', /abandon/);
  });

  it('saves and reloads through IndexedDB when localStorage is blocked', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    installWindow(storage);
    installMemoryIndexedDB();

    await saveWebMnemonic('indexeddb mnemonic');
    await markWebOnboarded();
    await markWebBackupComplete();

    assert.equal(await loadWebMnemonic(), 'indexeddb mnemonic');
    assert.equal(await isWebOnboarded(), true);
    assert.equal(await isWebBackupComplete(), true);

    await setWebVaultPin('123456');
    lockWebVault();
    await assert.rejects(
      loadWebMnemonic(),
      (cause: unknown) => cause instanceof WebStorageError && cause.code === 'vault_locked',
    );
    assert.equal(await unlockWebVault('123456'), true);
    assert.equal(await loadWebMnemonic(), 'indexeddb mnemonic');
  });

  it('repairs an existing IndexedDB database whose vault store is missing', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    installWindow(storage);
    installMemoryIndexedDB(new Map([
      ['alice-web-vault-v2', new Map()],
    ]));

    await saveWebMnemonic('repaired indexeddb mnemonic');

    assert.equal(await loadWebMnemonic(), 'repaired indexeddb mnemonic');
  });

  it('saves and reloads through Cache Storage when localStorage and IndexedDB are blocked', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    installWindow(storage);
    installMemoryCacheStorage();

    await saveWebMnemonic('cache storage mnemonic');
    await markWebOnboarded();
    await markWebBackupComplete();

    assert.equal(await loadWebMnemonic(), 'cache storage mnemonic');
    assert.equal(await isWebOnboarded(), true);
    assert.equal(await isWebBackupComplete(), true);

    await setWebVaultPin('123456');
    lockWebVault();
    await assert.rejects(
      loadWebMnemonic(),
      (cause: unknown) => cause instanceof WebStorageError && cause.code === 'vault_locked',
    );
    assert.equal(await unlockWebVault('123456'), true);
    assert.equal(await loadWebMnemonic(), 'cache storage mnemonic');
  });

  it('uses the PIN to encrypt and unlock the mnemonic', async () => {
    installWindow(new MemoryStorage());
    await saveWebMnemonic('test mnemonic');
    await setWebVaultPin('123456');
    lockWebVault();

    await assert.rejects(
      loadWebMnemonic(),
      (cause: unknown) => cause instanceof WebStorageError && cause.code === 'vault_locked',
    );
    assert.equal(await unlockWebVault('000000'), false);
    assert.equal(await unlockWebVault('123456'), true);
    assert.equal(await loadWebMnemonic(), 'test mnemonic');
  });

  it('returns to passwordless encryption when the PIN is removed', async () => {
    installWindow(new MemoryStorage());
    await saveWebMnemonic('test mnemonic');
    await setWebVaultPin('123456');
    await clearWebVaultPin();
    lockWebVault();

    assert.equal(await loadWebMnemonic(), 'test mnemonic');
  });

  it('uses the newest copy when one storage engine missed an update', async () => {
    const storage = new MemoryStorage();
    installWindow(storage);
    const databases = installMemoryIndexedDB();
    await saveWebMnemonic('test mnemonic');

    delete (globalThis as any).indexedDB;
    await setWebVaultPin('123456');
    lockWebVault();
    installMemoryIndexedDB(databases);

    await assert.rejects(
      loadWebMnemonic(),
      (cause: unknown) => cause instanceof WebStorageError && cause.code === 'vault_locked',
    );
    assert.equal(await unlockWebVault('123456'), true);
    assert.equal(await loadWebMnemonic(), 'test mnemonic');
  });

  it('persists onboarding and backup state without IndexedDB', async () => {
    installWindow(new MemoryStorage());
    await saveWebMnemonic('test mnemonic');
    await markWebOnboarded();
    await markWebBackupComplete();

    assert.equal(await isWebOnboarded(), true);
    assert.equal(await isWebBackupComplete(), true);
  });

  it('checks onboarding without decrypting a PIN-protected mnemonic', async () => {
    installWindow(new MemoryStorage());
    await saveWebMnemonic('test mnemonic');
    await markWebOnboarded();
    await setWebVaultPin('123456');
    lockWebVault();

    assert.equal(await isWebOnboarded(), true);
  });

  it('migrates the existing IndexedDB mnemonic into localStorage', async () => {
    const storage = new MemoryStorage();
    installWindow(storage);
    const key = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode('legacy mnemonic'),
    );
    installLegacyIndexedDB(new Map<string, unknown>([
      ['encryption-key', key],
      ['mnemonic', { iv, ciphertext }],
    ]));

    assert.equal(await loadWebMnemonic(), 'legacy mnemonic');
    assert.ok(storage.getItem('alice_web_vault_mnemonic'));

    delete (globalThis as any).indexedDB;
    assert.equal(await loadWebMnemonic(), 'legacy mnemonic');
  });

  it('clears all local vault data without IndexedDB', async () => {
    const storage = new MemoryStorage();
    installWindow(storage);
    await saveWebMnemonic('test mnemonic');
    await markWebOnboarded();

    await clearWebVault();

    assert.equal(storage.length, 0);
    assert.equal(await loadWebMnemonic(), null);
  });
});
