const CACHE_NAME = 'alice-wallet-__ALICE_BUILD_ID__';
const VAULT_CACHE_NAME = 'alice-web-vault-data-v1';
const ARKADE_CACHE_PREFIX = 'alice-arkade-';

const PRECACHE_URLS = [
  '/',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (k) =>
              k !== CACHE_NAME &&
              k !== VAULT_CACHE_NAME &&
              !k.startsWith(ARKADE_CACHE_PREFIX)
          )
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Network-first for API calls and SDK requests
  if (
    url.hostname !== self.location.hostname ||
    url.pathname.startsWith('/api')
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Content-hashed assets are safe to cache first. Every deployment references
  // new bundle URLs and receives a build-specific cache name.
  if (
    url.pathname.match(/\.(js|css|png|jpg|svg|woff2?|ttf)$/) ||
    url.pathname.startsWith('/_expo/')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Network-first for HTML navigation
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
