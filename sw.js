// JNF App Service Worker v1.0
const CACHE_NAME = 'jnf-app-v1';
const FIREBASE_URLS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
];
const STATIC_ASSETS = [
  './',
  './index.html',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
];

// Instalar: cachear todos los recursos necesarios
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        [...FIREBASE_URLS, ...STATIC_ASSETS].map(url =>
          cache.add(url).catch(e => console.warn('[SW] No se pudo cachear:', url, e))
        )
      );
    })
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Cache-first para Firebase SDKs, Network-first para el resto
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase SDKs y assets estáticos: cache-first
  if (FIREBASE_URLS.some(u => url.includes(u)) || url.includes('sheetjs') || url.includes('chart.min')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // index.html: Network-first con fallback a cache
  if (url.includes('index.html') || url.endsWith('/') || url.endsWith('/jnf-app/')) {
    event.respondWith(
      fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Todo lo demás: network con fallback a cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Sync: cuando vuelve internet, notificar al cliente
self.addEventListener('sync', event => {
  if (event.tag === 'jnf-sync-offline-data') {
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({type: 'SYNC_NOW'}))
    );
  }
});
