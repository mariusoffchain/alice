import type { SatoraKeyValueStore } from './satora-storage.ts';

export const SATORA_CACHE_NAME = 'alice-satora-swap-data-v1';
const CACHE_PATH = '/.alice-satora-data/';

function cacheUrl(key: string): string {
  const origin = typeof location !== 'undefined' && location.origin
    ? location.origin
    : 'https://alice.local';
  return new URL(`${CACHE_PATH}${encodeURIComponent(key)}`, origin).toString();
}

class CacheSatoraKeyValueStore implements SatoraKeyValueStore {
  async get(key: string): Promise<string | null> {
    const cache = await caches.open(SATORA_CACHE_NAME);
    const response = await cache.match(cacheUrl(key));
    return response ? response.text() : null;
  }

  async set(key: string, value: string): Promise<void> {
    const cache = await caches.open(SATORA_CACHE_NAME);
    await cache.put(
      cacheUrl(key),
      new Response(value, { headers: { 'content-type': 'text/plain' } }),
    );
  }

  async delete(key: string): Promise<void> {
    const cache = await caches.open(SATORA_CACHE_NAME);
    await cache.delete(cacheUrl(key));
  }

  async keys(): Promise<string[]> {
    const cache = await caches.open(SATORA_CACHE_NAME);
    const requests = await cache.keys();
    return requests.map(request => {
      const path = new URL(request.url).pathname;
      return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    });
  }
}

export function createSatoraKeyValueStore(
  _nativeExecutor?: unknown,
): SatoraKeyValueStore {
  if (typeof caches === 'undefined') {
    throw new Error('Secure Satora recovery storage is unavailable in this browser.');
  }
  return new CacheSatoraKeyValueStore();
}
