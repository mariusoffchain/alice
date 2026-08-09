const LEGACY_DB_NAME = 'alice-web-vault';
const LEGACY_STORE_NAME = 'vault';
const LEGACY_KEY_ID = 'encryption-key';
const HYBRID_DB_NAME = 'alice-web-vault-v2';
const HYBRID_DB_VERSION = 2;
const HYBRID_STORE_NAME = 'vault';
const CACHE_VAULT_NAME = 'alice-web-vault-data-v1';
const CACHE_VAULT_PATH = '/.alice-web-vault/';
const MNEMONIC_ID = 'mnemonic';
const ONBOARDED_ID = 'onboarded';
const BACKUP_COMPLETE_ID = 'backup-complete';
const LOCK_CONFIG_ID = 'lock-config';
const IDB_PROBE_ID = 'healthcheck';

const LOCAL_PREFIX = 'alice_web_vault_';
const LOCAL_MNEMONIC_ID = `${LOCAL_PREFIX}mnemonic`;
const LOCAL_ONBOARDED_ID = `${LOCAL_PREFIX}onboarded`;
const LOCAL_BACKUP_COMPLETE_ID = `${LOCAL_PREFIX}backup_complete`;
const LOCAL_LOCK_CONFIG_ID = `${LOCAL_PREFIX}lock_config`;
const LOCAL_PROBE_ID = `${LOCAL_PREFIX}healthcheck`;
const DEFAULT_WEB_PASSWORD = 'alice-web-wallet-default-v1';
const PBKDF2_ITERATIONS = 600_000;

let sessionPin: string | null = null;

export type WebStorageErrorCode =
  | 'localstorage_unavailable'
  | 'localstorage_write_failed'
  | 'localstorage_read_failed'
  | 'localstorage_delete_failed'
  | 'indexeddb_unavailable'
  | 'indexeddb_open_failed'
  | 'indexeddb_write_failed'
  | 'indexeddb_read_failed'
  | 'indexeddb_delete_failed'
  | 'cachestorage_unavailable'
  | 'cachestorage_write_failed'
  | 'cachestorage_read_failed'
  | 'cachestorage_delete_failed'
  | 'storage_unavailable'
  | 'webcrypto_unavailable'
  | 'vault_locked';

export class WebStorageError extends Error {
  readonly code: WebStorageErrorCode;
  readonly cause?: unknown;

  constructor(code: WebStorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'WebStorageError';
    this.code = code;
    this.cause = cause;
  }
}

type LocalEncryptedMnemonic = {
  version: 1;
  protection: 'default' | 'pin';
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt?: number;
};

type LegacyEncryptedMnemonic = {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};

type HybridValue<T> = {
  version: 1;
  updatedAt: number;
  value: T;
};

type StorageProbe = {
  available: boolean;
  errorCode?: WebStorageErrorCode;
  errorName?: string;
  errorMessage?: string;
};

export type WebStorageDiagnostics = {
  secureContext: boolean;
  displayMode: 'browser' | 'standalone';
  localStorage: StorageProbe;
  indexedDB: StorageProbe;
  cacheStorage: StorageProbe;
  persisted?: boolean;
  quota?: number;
  usage?: number;
};

function isSecureWebContext(): boolean {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext !== false;
}

function webCrypto(): Crypto {
  const browserCrypto = typeof window !== 'undefined' ? window.crypto : undefined;
  const cryptoApi = browserCrypto?.subtle ? browserCrypto : globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new WebStorageError(
      'webcrypto_unavailable',
      isSecureWebContext()
        ? 'Alice cannot access Web Crypto in this browser context.'
        : 'Alice needs a secure browser context to protect wallet keys. Open Alice from HTTPS or localhost.',
    );
  }
  return cryptoApi;
}

function describeCause(cause: unknown): string | undefined {
  if (cause instanceof AggregateError) {
    const details = cause.errors
      .map((error: unknown) => describeCause(error))
      .filter((detail: string | undefined): detail is string => Boolean(detail));
    return details.length > 0 ? details.join('; ') : cause.message;
  }
  if (cause instanceof DOMException || cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  return typeof cause === 'string' ? cause : undefined;
}

function storageUnavailableMessage(cause?: unknown): string {
  if (!isSecureWebContext()) {
    return 'Alice needs a secure browser context to protect wallet data. Open Alice from HTTPS or localhost.';
  }
  const detail = describeCause(cause);
  return detail
    ? `Alice could not save wallet data locally (${detail}).`
    : 'Alice could not save wallet data locally on this device.';
}

function storageError(code: WebStorageErrorCode, cause?: unknown): WebStorageError {
  return new WebStorageError(code, storageUnavailableMessage(cause), cause);
}

function webStorage(): Storage {
  try {
    const storage = typeof window !== 'undefined'
      ? window.localStorage
      : (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    if (!storage) throw storageError('localstorage_unavailable');
    return storage;
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('localstorage_unavailable', cause);
  }
}

function readLocal(key: string): string | null {
  try {
    return webStorage().getItem(key);
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('localstorage_read_failed', cause);
  }
}

function writeLocal(key: string, value: string): void {
  try {
    webStorage().setItem(key, value);
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('localstorage_write_failed', cause);
  }
}

function removeLocal(key: string): void {
  try {
    webStorage().removeItem(key);
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('localstorage_delete_failed', cause);
  }
}

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

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('Invalid hexadecimal value.');
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function readLocalJson<T>(key: string): T | null {
  const raw = readLocal(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw storageError('localstorage_read_failed', cause);
  }
}

function writeLocalJson(key: string, value: unknown): void {
  writeLocal(key, JSON.stringify(value));
}

function indexedDbFactory(): IDBFactory {
  const factory = typeof indexedDB !== 'undefined'
    ? indexedDB
    : (typeof window !== 'undefined' ? window.indexedDB : undefined);
  if (!factory) throw storageError('indexeddb_unavailable');
  return factory;
}

function openHybridVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = indexedDbFactory().open(HYBRID_DB_NAME, HYBRID_DB_VERSION);
    } catch (cause) {
      reject(storageError('indexeddb_open_failed', cause));
      return;
    }
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(HYBRID_STORE_NAME)) {
        open.result.createObjectStore(HYBRID_STORE_NAME);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(storageError('indexeddb_open_failed', open.error));
    open.onblocked = () => reject(storageError('indexeddb_open_failed', new Error('IndexedDB open was blocked')));
  });
}

function cacheStorageFactory(): CacheStorage {
  const storage = globalThis.caches
    ?? (typeof window !== 'undefined' ? window.caches : undefined);
  if (!storage) throw storageError('cachestorage_unavailable');
  return storage;
}

function cacheVaultUrl(key: string): string {
  const origin = typeof location !== 'undefined' && location.origin
    ? location.origin
    : 'https://alice.local';
  return new URL(`${CACHE_VAULT_PATH}${encodeURIComponent(key)}`, origin).toString();
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    const cache = await cacheStorageFactory().open(CACHE_VAULT_NAME);
    const response = await cache.match(cacheVaultUrl(key));
    if (!response) return null;
    return await response.json() as T;
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('cachestorage_read_failed', cause);
  }
}

async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    const cache = await cacheStorageFactory().open(CACHE_VAULT_NAME);
    await cache.put(
      cacheVaultUrl(key),
      new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('cachestorage_write_failed', cause);
  }
}

async function removeCache(key: string): Promise<void> {
  try {
    const cache = await cacheStorageFactory().open(CACHE_VAULT_NAME);
    await cache.delete(cacheVaultUrl(key));
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('cachestorage_delete_failed', cause);
  }
}

function idbRequest<T>(request: IDBRequest<T>, code: WebStorageErrorCode): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(code, request.error));
  });
}

async function readIdb<T>(key: string): Promise<T | null> {
  const db = await openHybridVault();
  try {
    const result = await idbRequest(
      db.transaction(HYBRID_STORE_NAME, 'readonly').objectStore(HYBRID_STORE_NAME).get(key),
      'indexeddb_read_failed',
    );
    return (result as T | undefined) ?? null;
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('indexeddb_read_failed', cause);
  } finally {
    db.close();
  }
}

async function writeIdb(key: string, value: unknown): Promise<void> {
  const db = await openHybridVault();
  try {
    await new Promise<void>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(HYBRID_STORE_NAME, 'readwrite');
        transaction.objectStore(HYBRID_STORE_NAME).put(value, key);
      } catch (cause) {
        reject(storageError('indexeddb_write_failed', cause));
        return;
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError('indexeddb_write_failed', transaction.error));
      transaction.onabort = () => reject(storageError('indexeddb_write_failed', transaction.error));
    });
  } finally {
    db.close();
  }
}

async function removeIdb(key: string): Promise<void> {
  const db = await openHybridVault();
  try {
    await new Promise<void>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(HYBRID_STORE_NAME, 'readwrite');
        transaction.objectStore(HYBRID_STORE_NAME).delete(key);
      } catch (cause) {
        reject(storageError('indexeddb_delete_failed', cause));
        return;
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError('indexeddb_delete_failed', transaction.error));
      transaction.onabort = () => reject(storageError('indexeddb_delete_failed', transaction.error));
    });
  } finally {
    db.close();
  }
}

function normalizeHybridValue<T>(value: HybridValue<T> | T | null): HybridValue<T> | null {
  if (value === null) return null;
  if (
    typeof value === 'object'
    && value !== null
    && (value as Partial<HybridValue<T>>).version === 1
    && typeof (value as Partial<HybridValue<T>>).updatedAt === 'number'
    && 'value' in value
  ) {
    return value as HybridValue<T>;
  }
  return { version: 1, updatedAt: 0, value: value as T };
}

async function readHybridValue<T>(localKey: string, idbKey: string): Promise<HybridValue<T> | null> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => normalizeHybridValue(readLocalJson<HybridValue<T> | T>(localKey))),
    readIdb<HybridValue<T> | T>(idbKey).then(normalizeHybridValue),
    readCache<HybridValue<T> | T>(idbKey).then(normalizeHybridValue),
  ]);
  const availableResults = results.filter(
    (result): result is PromiseFulfilledResult<HybridValue<T> | null> => result.status === 'fulfilled',
  );
  if (availableResults.length === 0) {
    throw storageError(
      'storage_unavailable',
      new AggregateError(
        results.map(result => (result as PromiseRejectedResult).reason),
        'All browser storage engines failed',
      ),
    );
  }
  return availableResults
    .map(result => result.value)
    .filter((value): value is HybridValue<T> => value !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

async function writeHybridValue<T>(localKey: string, idbKey: string, value: T): Promise<HybridValue<T>> {
  const record: HybridValue<T> = { version: 1, updatedAt: Date.now(), value };
  const results = await Promise.allSettled([
    Promise.resolve().then(() => writeLocalJson(localKey, record)),
    writeIdb(idbKey, record),
    writeCache(idbKey, record),
  ]);
  if (results.every(result => result.status === 'rejected')) {
    throw storageError(
      'storage_unavailable',
      new AggregateError(
        results.map(result => (result as PromiseRejectedResult).reason),
        'All browser storage engines failed',
      ),
    );
  }
  return record;
}

async function removeHybridValue(localKey: string, idbKey: string): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => removeLocal(localKey)),
    removeIdb(idbKey),
    removeCache(idbKey),
  ]);
  if (results.every(result => result.status === 'rejected')) {
    throw storageError(
      'storage_unavailable',
      new AggregateError(
        results.map(result => (result as PromiseRejectedResult).reason),
        'All browser storage engines failed',
      ),
    );
  }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    await globalThis.navigator?.storage?.persist?.();
  } catch {
    // Persistence is an optimization. The vault remains usable when denied.
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  const cryptoApi = webCrypto();
  const material = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return cryptoApi.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function deriveWebPinVerifier(pin: string, saltHex: string): Promise<string> {
  const cryptoApi = webCrypto();
  const material = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await cryptoApi.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function encryptMnemonic(
  mnemonic: string,
  password: string,
  protection: LocalEncryptedMnemonic['protection'],
): Promise<LocalEncryptedMnemonic> {
  const cryptoApi = webCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deriveKey(password, salt, 'encrypt'),
    new TextEncoder().encode(mnemonic),
  );
  return {
    version: 1,
    protection,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: Date.now(),
  };
}

async function decryptMnemonic(encrypted: LocalEncryptedMnemonic, password: string): Promise<string> {
  if (
    encrypted.version !== 1
    || !['default', 'pin'].includes(encrypted.protection)
    || !encrypted.salt
    || !encrypted.iv
    || !encrypted.ciphertext
  ) {
    throw storageError('localstorage_read_failed');
  }
  const plaintext = await webCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encrypted.iv) },
    await deriveKey(password, base64ToBytes(encrypted.salt), 'decrypt'),
    base64ToBytes(encrypted.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function probeLocalStorage(): Promise<StorageProbe> {
  const probe = `${Date.now()}:${Math.random()}`;
  try {
    writeLocal(LOCAL_PROBE_ID, probe);
    if (readLocal(LOCAL_PROBE_ID) !== probe) throw storageError('localstorage_read_failed');
    removeLocal(LOCAL_PROBE_ID);
    return { available: true };
  } catch (cause) {
    const error = cause instanceof WebStorageError ? cause : storageError('localstorage_unavailable', cause);
    return {
      available: false,
      errorCode: error.code,
      errorName: describeCause(error.cause)?.split(':')[0] ?? error.name,
      errorMessage: describeCause(error.cause) ?? error.message,
    };
  }
}

async function probeIndexedDB(): Promise<StorageProbe> {
  webCrypto();
  const probe = `${Date.now()}:${Math.random()}`;
  try {
    await writeIdb(IDB_PROBE_ID, probe);
    if (await readIdb<string>(IDB_PROBE_ID) !== probe) throw storageError('indexeddb_read_failed');
    await removeIdb(IDB_PROBE_ID);
    return { available: true };
  } catch (cause) {
    const error = cause instanceof WebStorageError ? cause : storageError('indexeddb_unavailable', cause);
    return {
      available: false,
      errorCode: error.code,
      errorName: describeCause(error.cause)?.split(':')[0] ?? error.name,
      errorMessage: describeCause(error.cause) ?? error.message,
    };
  }
}

async function probeCacheStorage(): Promise<StorageProbe> {
  webCrypto();
  const probe = `${Date.now()}:${Math.random()}`;
  try {
    await writeCache(IDB_PROBE_ID, probe);
    if (await readCache<string>(IDB_PROBE_ID) !== probe) {
      throw storageError('cachestorage_read_failed');
    }
    await removeCache(IDB_PROBE_ID);
    return { available: true };
  } catch (cause) {
    const error = cause instanceof WebStorageError ? cause : storageError('cachestorage_unavailable', cause);
    return {
      available: false,
      errorCode: error.code,
      errorName: describeCause(error.cause)?.split(':')[0] ?? error.name,
      errorMessage: describeCause(error.cause) ?? error.message,
    };
  }
}

export async function getWebStorageDiagnostics(): Promise<WebStorageDiagnostics> {
  webCrypto();
  const [localStorage, indexedDB, cacheStorage, persisted, estimate] = await Promise.all([
    probeLocalStorage(),
    probeIndexedDB(),
    probeCacheStorage(),
    globalThis.navigator?.storage?.persisted?.().catch(() => undefined),
    globalThis.navigator?.storage?.estimate?.().catch(() => undefined),
  ]);
  const standalone = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  return {
    secureContext: isSecureWebContext(),
    displayMode: standalone ? 'standalone' : 'browser',
    localStorage,
    indexedDB,
    cacheStorage,
    persisted,
    quota: estimate?.quota,
    usage: estimate?.usage,
  };
}

export async function diagnoseWebStorage(): Promise<void> {
  const diagnostics = await getWebStorageDiagnostics();
  if (
    diagnostics.localStorage.available
    || diagnostics.indexedDB.available
    || diagnostics.cacheStorage.available
  ) return;
  throw storageError(
    'storage_unavailable',
    new AggregateError(
      [
        diagnostics.localStorage.errorMessage,
        diagnostics.indexedDB.errorMessage,
        diagnostics.cacheStorage.errorMessage,
      ].filter(Boolean),
      'All browser storage engines failed',
    ),
  );
}

export async function saveWebMnemonic(mnemonic: string): Promise<void> {
  await requestPersistentStorage();
  const password = sessionPin ?? DEFAULT_WEB_PASSWORD;
  const protection = sessionPin ? 'pin' : 'default';
  const encrypted = await encryptMnemonic(mnemonic, password, protection);
  await writeHybridValue(LOCAL_MNEMONIC_ID, MNEMONIC_ID, encrypted);
  const saved = await readHybridValue<LocalEncryptedMnemonic>(LOCAL_MNEMONIC_ID, MNEMONIC_ID);
  if (!saved) throw storageError('storage_unavailable', new Error('Wallet verification found no saved seed'));
  const verified = await decryptMnemonic(saved.value, password);
  if (verified !== mnemonic) {
    throw storageError('storage_unavailable', new Error('Wallet verification did not match the saved seed'));
  }
}

async function loadCurrentMnemonic(): Promise<string | null> {
  const record = await readHybridValue<LocalEncryptedMnemonic>(LOCAL_MNEMONIC_ID, MNEMONIC_ID);
  if (!record) return null;
  const encrypted = record.value;
  if (encrypted.protection === 'pin' && !sessionPin) {
    throw new WebStorageError('vault_locked', 'Unlock Alice to access the wallet.');
  }
  try {
    return await decryptMnemonic(encrypted, encrypted.protection === 'pin' ? sessionPin! : DEFAULT_WEB_PASSWORD);
  } catch (cause) {
    if (cause instanceof WebStorageError) throw cause;
    throw storageError('localstorage_read_failed', cause);
  }
}

export async function loadWebMnemonic(): Promise<string | null> {
  const currentMnemonic = await loadCurrentMnemonic();
  if (currentMnemonic !== null) return currentMnemonic;

  const legacyMnemonic = await loadLegacyMnemonic();
  if (legacyMnemonic === null) return null;
  await writeHybridValue(
    LOCAL_MNEMONIC_ID,
    MNEMONIC_ID,
    await encryptMnemonic(legacyMnemonic, DEFAULT_WEB_PASSWORD, 'default'),
  );
  return legacyMnemonic;
}

export async function hasWebMnemonic(): Promise<boolean> {
  if (await readHybridValue<LocalEncryptedMnemonic>(LOCAL_MNEMONIC_ID, MNEMONIC_ID)) return true;
  return (await loadWebMnemonic()) !== null;
}

export async function setWebVaultPin(pin: string): Promise<void> {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) throw new Error('PIN must contain exactly 4 or 6 digits.');
  const mnemonic = await loadWebMnemonic();
  if (!mnemonic) throw new Error('No wallet seed is available to protect.');
  await writeHybridValue(LOCAL_MNEMONIC_ID, MNEMONIC_ID, await encryptMnemonic(mnemonic, pin, 'pin'));
  sessionPin = pin;
}

export async function unlockWebVault(pin: string): Promise<boolean> {
  const record = await readHybridValue<LocalEncryptedMnemonic>(LOCAL_MNEMONIC_ID, MNEMONIC_ID);
  if (!record) return false;
  const encrypted = record.value;
  try {
    if (encrypted.protection === 'default') {
      const mnemonic = await decryptMnemonic(encrypted, DEFAULT_WEB_PASSWORD);
      await writeHybridValue(LOCAL_MNEMONIC_ID, MNEMONIC_ID, await encryptMnemonic(mnemonic, pin, 'pin'));
    } else {
      await decryptMnemonic(encrypted, pin);
    }
    sessionPin = pin;
    return true;
  } catch {
    return false;
  }
}

export async function clearWebVaultPin(): Promise<void> {
  const mnemonic = await loadWebMnemonic();
  if (mnemonic) {
    await writeHybridValue(
      LOCAL_MNEMONIC_ID,
      MNEMONIC_ID,
      await encryptMnemonic(mnemonic, DEFAULT_WEB_PASSWORD, 'default'),
    );
  }
  sessionPin = null;
}

export function lockWebVault(): void {
  sessionPin = null;
}

export async function clearWebVault(): Promise<void> {
  sessionPin = null;
  await Promise.allSettled([
    removeHybridValue(LOCAL_MNEMONIC_ID, MNEMONIC_ID),
    removeHybridValue(LOCAL_ONBOARDED_ID, ONBOARDED_ID),
    removeHybridValue(LOCAL_BACKUP_COMPLETE_ID, BACKUP_COMPLETE_ID),
    removeHybridValue(LOCAL_LOCK_CONFIG_ID, LOCK_CONFIG_ID),
    Promise.resolve().then(() => removeLocal(LOCAL_PROBE_ID)),
    removeIdb(IDB_PROBE_ID),
    removeCache(IDB_PROBE_ID),
  ]);
  await deleteLegacyDatabase();
}

export async function isWebOnboarded(): Promise<boolean> {
  const current = await readHybridValue<boolean>(LOCAL_ONBOARDED_ID, ONBOARDED_ID);
  const onboarded = current?.value ?? await migrateLegacyValue<boolean>(
    ONBOARDED_ID,
    LOCAL_ONBOARDED_ID,
    ONBOARDED_ID,
  );
  return onboarded === true && await hasWebMnemonic();
}

export async function markWebOnboarded(): Promise<void> {
  await writeHybridValue(LOCAL_ONBOARDED_ID, ONBOARDED_ID, true);
}

export async function isWebBackupComplete(): Promise<boolean> {
  const current = await readHybridValue<boolean>(LOCAL_BACKUP_COMPLETE_ID, BACKUP_COMPLETE_ID);
  return (
    current?.value
    ?? await migrateLegacyValue<boolean>(
      BACKUP_COMPLETE_ID,
      LOCAL_BACKUP_COMPLETE_ID,
      BACKUP_COMPLETE_ID,
    )
  ) === true;
}

export async function markWebBackupComplete(): Promise<void> {
  await writeHybridValue(LOCAL_BACKUP_COMPLETE_ID, BACKUP_COMPLETE_ID, true);
}

export async function loadWebLockConfig<T>(): Promise<T | null> {
  const current = await readHybridValue<T>(LOCAL_LOCK_CONFIG_ID, LOCK_CONFIG_ID);
  return current?.value ?? await migrateLegacyValue<T>(
    LOCK_CONFIG_ID,
    LOCAL_LOCK_CONFIG_ID,
    LOCK_CONFIG_ID,
  );
}

export async function saveWebLockConfig<T>(config: T): Promise<void> {
  await writeHybridValue(LOCAL_LOCK_CONFIG_ID, LOCK_CONFIG_ID, config);
}

export async function clearWebLockConfig(): Promise<void> {
  await removeHybridValue(LOCAL_LOCK_CONFIG_ID, LOCK_CONFIG_ID);
  await deleteLegacyValue(LOCK_CONFIG_ID);
}

function legacyRequest<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('Legacy IndexedDB request failed'));
  });
}

function openLegacyVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Legacy IndexedDB is unavailable'));
  return new Promise((resolve, reject) => {
    try {
      const open = indexedDB.open(LEGACY_DB_NAME, 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Unable to open legacy web vault'));
    } catch (cause) {
      reject(cause);
    }
  });
}

async function readLegacyValue<T>(id: string): Promise<T | undefined> {
  const db = await openLegacyVault();
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) return undefined;
    return await legacyRequest(
      db.transaction(LEGACY_STORE_NAME, 'readonly').objectStore(LEGACY_STORE_NAME).get(id),
    ) as T | undefined;
  } finally {
    db.close();
  }
}

async function loadLegacyMnemonic(): Promise<string | null> {
  try {
    const [encrypted, key] = await Promise.all([
      readLegacyValue<LegacyEncryptedMnemonic>(MNEMONIC_ID),
      readLegacyValue<CryptoKey>(LEGACY_KEY_ID),
    ]);
    if (!encrypted || !key) return null;
    const plaintext = await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
      key,
      encrypted.ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

async function migrateLegacyValue<T>(legacyId: string, localId: string, idbId: string): Promise<T | null> {
  try {
    const value = await readLegacyValue<T>(legacyId);
    if (value === undefined) return null;
    await writeHybridValue(localId, idbId, value);
    return value;
  } catch {
    return null;
  }
}

async function deleteLegacyValue(id: string): Promise<void> {
  try {
    const db = await openLegacyVault();
    try {
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) return;
      const transaction = db.transaction(LEGACY_STORE_NAME, 'readwrite');
      transaction.objectStore(LEGACY_STORE_NAME).delete(id);
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // The local value is already gone, so legacy cleanup remains best-effort.
  }
}

function deleteLegacyDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    try {
      const deletion = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => resolve();
      deletion.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
