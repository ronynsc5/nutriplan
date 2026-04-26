// sw.js — NutriPlan Service Worker
const CACHE_VERSION = 'v3';
const CACHE_NAME = 'nutriplan-' + CACHE_VERSION;
const CACHE_FILES = ['/manifest.json','/img-hardcore.png','/img-saudavel.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('anthropic.com')) return;
  if (event.request.url.includes('mercadopago')) return;
  if (event.request.url.includes('cloudinary')) return;
  if (event.request.url.includes('supabase')) return;
  if (event.request.url.includes('googleapis')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
