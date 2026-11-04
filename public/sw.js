// Service worker : rend l'app installable et lançable hors connexion (la coquille, pas les données).
// Réseau d'abord pour toujours avoir la dernière version ; le cache ne sert que sans réseau.
const CACHE = 'pari-tenu-v11';
const SHELL = ['/', '/css/app.css', '/theme.css', '/js/main.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Les images des sources (/media) restent au cache du navigateur : elles ne gonflent pas celui de l'app.
  // L'admin (/admin) n'est jamais gardée hors connexion : elle ne prend pas la place de la coquille.
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\/(api|media)\/|^\/admin(\/|$)|^\/js\/admin\//.test(url.pathname)) return;
  // Toutes les pages de l'app (/, /groups, /invite/<lien>, /<groupe>/…) sont la même coquille index.html.
  const key = request.mode === 'navigate' ? '/' : request;
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(key, copy));
      }
      return response;
    })
    .catch(() => caches.match(key)));
});
