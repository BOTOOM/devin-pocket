const VERSION = 'v1';
const SHELL = `dp-shell-${VERSION}`;
const ASSETS = `dp-assets-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add('/'))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname === '/ws')
    return;

  // Hashed vite assets: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ??
          fetch(e.request).then((r) => {
            if (r.ok) {
              const clone = r.clone();
              caches.open(ASSETS).then((c) => c.put(e.request, clone));
            }
            return r;
          }),
      ),
    );
    return;
  }

  // Everything else (shell): network-first, cache fallback.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && (url.pathname === '/' || !url.pathname.includes('.'))) {
          const clone = r.clone();
          caches.open(SHELL).then((c) => c.put('/', clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((h) => h ?? caches.match('/'))),
  );
});
