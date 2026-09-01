/**
 * SMART SCHOOL CONTROL CENTER - SERVICE WORKER
 * Version: ronit-local-v5
 * 
 * Safe static caching + runtime caching for assets.
 * Live Web Serial, COM, Arduino commands, microphone/speech and dynamic requests
 * are explicitly bypassed and never intercepted or cached.
 */

const CACHE_NAME = 'ronit-local-v5';
const RUNTIME_CACHE = 'ronit-local-runtime-v5';

// Core Application Shell assets to cache during installation
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './assistant.css',
  './assistantConfig.js',
  './assistant.js'
];

// Install Event - Pre-cache minimal essential static application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching application shell');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Some pre-cache assets could not be cached immediately:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up any old versioned caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== RUNTIME_CACHE) {
            console.log('[ServiceWorker] Removing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Safe strategy routing
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Only handle GET requests. Skip non-GET requests (POST, WebSocket, etc.)
  if (request.method !== 'GET') {
    return;
  }

  // 2. Ignore non-HTTP(S) protocols like chrome-extension://, blob:, data:
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 3. DO NOT cache or intercept any API/device/live data endpoints
  if (url.pathname.includes('/api/') || url.searchParams.has('live') || url.searchParams.has('nocache')) {
    return;
  }

  // 4. Video files (Range requests / lazy-loaded animations)
  // Let browser manage byte-range streaming naturally; on full response, allow runtime caching safely.
  if (request.destination === 'video' || url.pathname.endsWith('.mp4') || url.pathname.endsWith('.webm')) {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // 5. HTML Navigation Requests -> Network First, fall back to cached shell
  if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 6. Static Resources (CSS, JS, Fonts, Images) -> Cache First, fall back to network & store in runtime cache
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          // Check if response is valid (including opaque responses for cross-origin fonts/icons)
          if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseClone).catch(() => {});
          });

          return networkResponse;
        })
        .catch((err) => {
          console.warn('[ServiceWorker] Fetch failed for:', request.url, err);
        });
    })
  );
});
