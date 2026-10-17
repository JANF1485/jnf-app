// Motocaimán — © 2026 Asesorías y Consultorías JNF S.A.S. (NIT 901.904.435-9). Todos los derechos reservados.
// Prohibida su reproducción, copia, modificación o distribución, total o parcial, sin autorización escrita del titular.
// Motocaimán — service worker
// Estrategia "red primero": siempre intenta descargar la versión publicada más reciente
// (sin usar la caché HTTP del navegador) y solo usa la copia guardada si no hay conexión. Así las actualizaciones se ven de inmediato.
const CACHE = 'jnf-moto-v13';
const SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './splash.js', './splash-1.png', './splash-2.png', './splash-3.png', './splash-4.png', './splash-5.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return; // Firebase, mapas y fuentes van directo a la red
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Notificaciones push: llegan aunque la app esté cerrada o el celular bloqueado
const VIB = { solicitud: [400, 150, 400, 150, 400, 150, 600], oferta: [200, 100, 200], asignado: [300, 120, 300], en_punto: [400, 150, 400, 150, 400], cancelado: [500, 200, 500], prueba: [200, 100, 200], registro: [300, 120, 300] };
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { titulo: 'Motocaimán', cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Con la app abierta y a la vista, la propia app ya suena y muestra el aviso
    if (d.tipo !== 'prueba' && wins.some(w => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.titulo || 'Motocaimán', {
      body: d.cuerpo || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'jnf', renotify: true,
      vibrate: VIB[d.tipo] || [200, 100, 200], requireInteraction: d.tipo === 'solicitud', data: { url: d.abrir ? './?abrir=' + encodeURIComponent(d.abrir) : './', abrir: d.abrir || null }
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const dt = e.notification.data || {};
    for (const w of wins) { if ('focus' in w) { if (dt.abrir) w.postMessage({ abrir: dt.abrir }); return w.focus(); } }
    return self.clients.openWindow(dt.url || './');
  })());
});
