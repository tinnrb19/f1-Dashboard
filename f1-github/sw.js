// F1 Dashboard service worker: network-first (always fresh when online), cached fallback when offline.
// Live data APIs (Jolpica, Wikipedia, Open-Meteo, Supabase) and the admin pages are never cached.
const CACHE = 'f1-shell-v3';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const staticCdn = /(^|\.)cdnjs\.cloudflare\.com$|(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !staticCdn) return;                       // live APIs go straight to the network
  if (url.pathname.includes('/.well-known/')) return;
  if (/\/(admin\.html|admin\.js|config\.js)$/.test(url.pathname)) return;   // admin + keys: never cached
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
