const C = 'mk-v2', FILES = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/huninn.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
