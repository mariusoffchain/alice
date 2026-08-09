import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  downloadPack,
  deletePack,
  listDownloadedPackIds,
  restoreDownloadedPacks,
  checkForPackUpdates,
  parsePack,
  PackIntegrityError,
  type PackDescriptor,
  type PackStorage,
} from './pack-downloader.ts';
import { getAllChunks, getRegisteredPacks, unregisterPack } from './knowledge-packs.ts';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function memoryStorage(): PackStorage {
  const data = new Map<string, string>();
  let lastCheckedAt: number | null = null;
  return {
    async readPackIndex() {
      return Array.from(data.keys());
    },
    async readPackData(packId) {
      return data.get(packId) ?? null;
    },
    async writePackData(packId, value) {
      data.set(packId, value);
    },
    async deletePackData(packId) {
      data.delete(packId);
    },
    async readLastCheckedAt() {
      return lastCheckedAt;
    },
    async writeLastCheckedAt(timestamp) {
      lastCheckedAt = timestamp;
    },
  };
}

function samplePackBytes(id = 'test-pack', version = '1.0.0') {
  const pack = {
    id,
    version,
    language: 'en',
    chunks: [
      { id: `${id}-chunk-1`, title: 'Sample chunk', keywords: ['sample'], level: 'beginner', content: 'Sample content.' },
    ],
  };
  return new TextEncoder().encode(JSON.stringify(pack));
}

function fakeFetch(bytes: Uint8Array, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  })) as unknown as typeof fetch;
}

function descriptorFor(bytes: Uint8Array, overrides: Partial<PackDescriptor> = {}): PackDescriptor {
  return {
    id: 'test-pack',
    title: 'Test pack',
    description: 'A pack used only in tests.',
    sizeBytes: bytes.byteLength,
    language: 'en',
    version: '1.0.0',
    url: 'https://example.test/test-pack.json',
    sha256: toHex(sha256(bytes)),
    ...overrides,
  };
}

test.afterEach(() => {
  unregisterPack('test-pack');
});

test('parsePack rejects a payload missing required fields', () => {
  assert.throws(() => parsePack(JSON.stringify({ id: 'x' })), /Malformed knowledge pack/);
});

test('downloads, verifies, persists and registers a pack', async () => {
  const bytes = samplePackBytes();
  const storage = memoryStorage();
  const descriptor = descriptorFor(bytes);

  await downloadPack(descriptor, undefined, storage, fakeFetch(bytes));

  assert.deepEqual(await listDownloadedPackIds(storage), ['test-pack']);
  const registered = getRegisteredPacks().find(pack => pack.id === 'test-pack');
  assert.ok(registered);
  assert.equal(registered!.source, 'downloaded');
  assert.ok(getAllChunks().some(chunk => chunk.id === 'test-pack-chunk-1'));
});

test('rejects a pack whose bytes do not match the declared hash', async () => {
  const bytes = samplePackBytes();
  const storage = memoryStorage();
  const descriptor = descriptorFor(bytes, { sha256: '00'.repeat(32) });

  await assert.rejects(
    downloadPack(descriptor, undefined, storage, fakeFetch(bytes)),
    (error: unknown) => error instanceof PackIntegrityError,
  );
  assert.deepEqual(await listDownloadedPackIds(storage), []);
  assert.equal(getRegisteredPacks().some(pack => pack.id === 'test-pack'), false);
});

test('rejects a pack whose payload id does not match the descriptor', async () => {
  const bytes = samplePackBytes('other-id');
  const storage = memoryStorage();
  const descriptor = descriptorFor(bytes);

  await assert.rejects(
    downloadPack(descriptor, undefined, storage, fakeFetch(bytes)),
    /does not match descriptor id/,
  );
});

test('surfaces a non-OK response instead of silently doing nothing', async () => {
  const bytes = samplePackBytes();
  const storage = memoryStorage();
  const descriptor = descriptorFor(bytes);

  await assert.rejects(
    downloadPack(descriptor, undefined, storage, fakeFetch(bytes, false, 404)),
    /Pack download failed \(404\)/,
  );
});

test('deletePack removes storage and unregisters the pack', async () => {
  const bytes = samplePackBytes();
  const storage = memoryStorage();
  await downloadPack(descriptorFor(bytes), undefined, storage, fakeFetch(bytes));

  await deletePack('test-pack', storage);

  assert.deepEqual(await listDownloadedPackIds(storage), []);
  assert.equal(getRegisteredPacks().some(pack => pack.id === 'test-pack'), false);
});

test('restoreDownloadedPacks re-registers everything persisted from a previous session', async () => {
  const bytes = samplePackBytes();
  const storage = memoryStorage();
  await downloadPack(descriptorFor(bytes), undefined, storage, fakeFetch(bytes));
  unregisterPack('test-pack');
  assert.equal(getRegisteredPacks().some(pack => pack.id === 'test-pack'), false);

  await restoreDownloadedPacks(storage);

  assert.ok(getRegisteredPacks().some(pack => pack.id === 'test-pack'));
});

test('restoreDownloadedPacks drops an entry that no longer parses instead of crashing', async () => {
  const storage = memoryStorage();
  await storage.writePackData('broken-pack', 'not json');

  await restoreDownloadedPacks(storage);

  assert.deepEqual(await listDownloadedPackIds(storage), []);
});

test('checkForPackUpdates silently refreshes a downloaded pack whose catalog version changed', async () => {
  const storage = memoryStorage();
  const v1Bytes = samplePackBytes('test-pack', '1.0.0');
  const v1 = descriptorFor(v1Bytes, { version: '1.0.0' });
  await downloadPack(v1, undefined, storage, fakeFetch(v1Bytes));

  const v2Bytes = samplePackBytes('test-pack', '2.0.0');
  const v2 = descriptorFor(v2Bytes, { version: '2.0.0' });

  const result = await checkForPackUpdates([v2], { now: Date.now() }, storage, fakeFetch(v2Bytes));

  assert.equal(result.checked, true);
  assert.deepEqual(result.updated, ['test-pack']);
  const stored = await storage.readPackData('test-pack');
  assert.equal(parsePack(stored!).version, '2.0.0');
});

test('checkForPackUpdates never fetches a pack the user did not already download', async () => {
  const storage = memoryStorage();
  const bytes = samplePackBytes();
  let fetchCalls = 0;
  const trackedFetch: typeof fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return fakeFetch(bytes)(...args);
  }) as typeof fetch;

  const result = await checkForPackUpdates([descriptorFor(bytes)], { now: Date.now() }, storage, trackedFetch);

  assert.equal(result.checked, true);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await listDownloadedPackIds(storage), []);
});

test('checkForPackUpdates does nothing when the stored version already matches the catalog', async () => {
  const storage = memoryStorage();
  const bytes = samplePackBytes('test-pack', '1.0.0');
  const descriptor = descriptorFor(bytes, { version: '1.0.0' });
  await downloadPack(descriptor, undefined, storage, fakeFetch(bytes));

  let fetchCalls = 0;
  const trackedFetch: typeof fetch = ((...args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    return fakeFetch(bytes)(...args);
  }) as typeof fetch;

  const result = await checkForPackUpdates([descriptor], { now: Date.now() }, storage, trackedFetch);

  assert.equal(result.updated.length, 0);
  assert.equal(fetchCalls, 0);
});

test('checkForPackUpdates respects the throttle interval and skips a too-recent check', async () => {
  const storage = memoryStorage();
  const v1Bytes = samplePackBytes('test-pack', '1.0.0');
  await downloadPack(descriptorFor(v1Bytes, { version: '1.0.0' }), undefined, storage, fakeFetch(v1Bytes));

  const start = 1_000_000;
  await checkForPackUpdates([descriptorFor(v1Bytes, { version: '1.0.0' })], { now: start }, storage, fakeFetch(v1Bytes));

  const v2Bytes = samplePackBytes('test-pack', '2.0.0');
  const soon = start + 60_000; // 1 minute later, well under the 24h interval
  const result = await checkForPackUpdates(
    [descriptorFor(v2Bytes, { version: '2.0.0' })],
    { now: soon },
    storage,
    fakeFetch(v2Bytes),
  );

  assert.equal(result.checked, false);
  const stored = await storage.readPackData('test-pack');
  assert.equal(parsePack(stored!).version, '1.0.0');
});

test('checkForPackUpdates keeps the previous pack in place when the refresh fetch fails', async () => {
  const storage = memoryStorage();
  const v1Bytes = samplePackBytes('test-pack', '1.0.0');
  await downloadPack(descriptorFor(v1Bytes, { version: '1.0.0' }), undefined, storage, fakeFetch(v1Bytes));

  const v2Bytes = samplePackBytes('test-pack', '2.0.0');
  const v2 = descriptorFor(v2Bytes, { version: '2.0.0' });

  const result = await checkForPackUpdates([v2], { now: Date.now() }, storage, fakeFetch(v2Bytes, false, 500));

  assert.deepEqual(result.failed, ['test-pack']);
  const stored = await storage.readPackData('test-pack');
  assert.equal(parsePack(stored!).version, '1.0.0');
});
