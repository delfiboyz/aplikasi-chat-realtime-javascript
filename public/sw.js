// Service worker: caches the app shell so the UI loads instantly and works as an installable PWA.
const CACHE = 'obrolan-v2';
const SHELL = [
  '/',
  '/login.html',
  '/css/style.css',
  '/js/app.js',
  '/js/format.js',
  '/js/login.js',
  '/js/theme.js',
  '/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Network first so deployments show up immediately; fall back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match('/'))),
  );
});
