// ============================================
// Service Worker — SantéPro PWA
// Gère le cache pour le mode hors ligne
// ============================================

const CACHE_VERSION = 'santepro-v1';
const CACHE_STATIC = `${CACHE_VERSION}-static`;
const CACHE_RUNTIME = `${CACHE_VERSION}-runtime`;

// Ressources à pré-cacher (le cœur de l'app)
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// Domaines autorisés pour le cache runtime (runtime = à la volée)
const RUNTIME_CACHE_DOMAINS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'accounts.google.com',
  'www.googleapis.com'
];

// Domaines à NE JAMAIS cacher (API dynamiques, auth)
const NEVER_CACHE_DOMAINS = [
  'accounts.google.com',   // Auth Google
  'oauth2.googleapis.com'  // Tokens OAuth
];

// ============================================
// INSTALLATION — Pré-cache des ressources
// ============================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation...');
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Échec pré-cache:', url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ============================================
// ACTIVATION — Nettoyage des vieux caches
// ============================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key.startsWith('santepro-') && key !== CACHE_STATIC && key !== CACHE_RUNTIME)
          .map(key => {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================
// FETCH — Stratégie de cache
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // 2. Ne jamais cacher l'auth Google
  if (NEVER_CACHE_DOMAINS.some(d => url.hostname.includes(d))) {
    return;
  }

  // 3. Ne pas cacher les API Google Drive / Calendar (dynamiques)
  if (url.hostname === 'www.googleapis.com') {
    return;
  }

  // 4. Ressources locales → Cache First (le plus rapide)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_RUNTIME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // Fallback : retourne index.html pour les navigations
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Hors ligne', { status: 503 });
        });
      })
    );
    return;
  }

  // 5. CDN externes (Tailwind, Chart, FontAwesome...) → Stale While Revalidate
  if (RUNTIME_CACHE_DOMAINS.some(d => url.hostname.includes(d))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_RUNTIME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 6. Autres (analytics, etc.) → réseau uniquement
});

// ============================================
// MESSAGES — Permettre au client de forcer la mise à jour
// ============================================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    );
  }
});
