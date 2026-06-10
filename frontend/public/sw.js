// Service Worker for GCSP Academy PWA
// v12: API responses are now cached per academy (tenant) so an offline
// fallback never serves one academy's ads / daily videos to a member of a
// different academy. Bumping the cache name also purges any older un-scoped
// entries on activate.
// v13: academy logo (/images/academy-logo.png) replaced — bump cache so the
// precached old logo is purged and the new one is fetched on activate.
// v14: SW is now tenant-aware for push — it persists the academy slug (set via
// the SET_TENANT message / stamped on each push payload) so SW-initiated calls
// and notification tags are scoped to the right academy. Bump purges old caches.
// v15: bump to purge stale cache-first JS chunks so the latest app code (e.g.
// the branch filter on the coach salaries page) is fetched on activate.
// v16: bump to ship the members "expired" filter consistency fix (only members
// whose subscriptions are ALL expired show under the expired filter).
// v17: bump to ship the new members "needs renewal / قرب ينتهي" filter.
// v18: bump to ship custom activities on the levels/schedule page.
// v19: bump for custom-activity built-in prefix fix (football grouping).
// v20: bump to ship custom-activity name validation (reserved " - " guard).
const CACHE_NAME = 'gcsp-academy-v20';
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/images/academy-logo.png',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png'
];

// API routes to cache with network-first strategy
const API_CACHE_ROUTES = [
  '/api/daily-videos/today',
  '/api/daily-videos/week',
  '/api/advertisements/public'
];

// Build a per-academy (tenant) cache key for an API request. The SW has no
// access to localStorage, so it reads the academy from the X-Tenant-Slug
// header the app attaches to every member API call, and folds it into the
// cache URL. This keeps each academy's cached responses isolated, so an
// offline fallback can never serve another academy's data.
function tenantScopedRequest(request) {
  const slug = request.headers.get('X-Tenant-Slug') || 'default';
  const url = new URL(request.url);
  url.searchParams.set('__tenant', slug);
  return new Request(url.toString(), { method: 'GET' });
}

// ── Tenant (academy) persistence for the service worker ───────────────────
// The native/PWA app ships against ONE fixed domain shared by every academy,
// and the backend resolves the academy from the X-Tenant-Slug header. The SW
// has no localStorage AND is terminated when idle (so module-level variables
// do NOT survive between push events). To give SW-initiated network calls a
// reliable academy, the app posts the current slug (SET_TENANT message) and we
// persist it inside Cache Storage, which does survive restarts. Reads fall
// back to 'default' so a missing slug never crashes a handler.
const TENANT_META_URL = '/__sw-tenant-slug';

async function persistTenantSlug(slug) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      TENANT_META_URL,
      new Response(slug || 'default', { headers: { 'Content-Type': 'text/plain' } })
    );
  } catch (e) {
    console.warn('[ServiceWorker] Failed to persist tenant slug:', e);
  }
}

async function readTenantSlug() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(TENANT_META_URL);
    if (res) {
      const slug = (await res.text()).trim();
      if (slug) return slug;
    }
  } catch (e) {
    console.warn('[ServiceWorker] Failed to read tenant slug:', e);
  }
  return 'default';
}

// Install event - precache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    // Cache YouTube thumbnails
    if (url.hostname === 'img.youtube.com') {
      event.respondWith(
        caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(request).then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          }).catch(() => {
            // Return placeholder for failed YouTube thumbnails
            return new Response('', { status: 404 });
          });
        })
      );
      return;
    }
    return;
  }

  // API requests - Network first, then cache (per academy).
  // The cache key is scoped by the X-Tenant-Slug header so an offline fallback
  // only ever returns the current academy's cached data, never another's.
  if (url.pathname.startsWith('/api/')) {
    const cacheKey = tenantScopedRequest(request);
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses under the academy-scoped key
          if (response.ok && API_CACHE_ROUTES.some(route => url.pathname.includes(route))) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(cacheKey, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return this academy's cached API response if available
          return caches.match(cacheKey).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return empty JSON for failed API requests
            return new Response(JSON.stringify({ offline: true, data: [] }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // Static assets - Cache first, then network
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$/)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Update cache in background
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response);
              });
            }
          });
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages - Network first, then cache, then offline page
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Sync event:', event.tag);
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncAttendance());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received');
  const data = event.data ? event.data.json() : {};

  // The server stamps the recipient's academy (tenant) onto the payload.
  // Routing is already guaranteed (the subscription lives in this academy's
  // DB, so the push is only delivered to its own members), but a single
  // browser/origin can be shared by members of different academies over time.
  // Namespacing the notification tag by academy prevents one academy's push
  // from silently replacing/collapsing another's, and we persist the slug so
  // the click handler and any SW-initiated call use the right academy.
  const tenant = data.tenant || '';
  const baseTag = data.tag || 'default';
  const scopedTag = tenant ? `${tenant}:${baseTag}` : baseTag;

  const options = {
    body: data.body || 'لديك إشعار جديد',
    icon: data.icon || '/images/icon-192x192.png',
    badge: data.badge || '/images/icon-72x72.png',
    image: data.image || undefined,
    tag: scopedTag,
    renotify: true,
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      tenant,
      ...(data.data || {})
    },
    actions: [
      { action: 'open', title: 'فتح' },
      { action: 'close', title: 'إغلاق' }
    ],
    dir: 'rtl',
    lang: 'ar'
  };

  event.waitUntil(
    (async () => {
      // Only persist a real slug; never let an unstamped (legacy) push reset a
      // previously stored academy back to 'default'.
      if (tenant) {
        await persistTenantSlug(tenant);
      }
      await self.registration.showNotification(
        data.title || 'أكاديمية أداء الأبطال',
        options
      );
    })()
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click:', event.action);
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open, focus it
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        // Otherwise open new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Helper function to sync offline attendance
async function syncAttendance() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const offlineData = await cache.match('offline-attendance');
    
    if (offlineData) {
      const data = await offlineData.json();

      // This is a SW-initiated request (not an intercepted member call), so it
      // carries no academy context of its own. Attach the persisted slug as the
      // X-Tenant-Slug header so the backend records attendance against the
      // member's own academy instead of falling back to the default tenant.
      const tenantSlug = await readTenantSlug();

      for (const record of data) {
        await fetch('/api/attendance/record', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Slug': tenantSlug
          },
          body: JSON.stringify(record)
        });
      }
      
      // Clear offline data after successful sync
      await cache.delete('offline-attendance');
      console.log('[ServiceWorker] Offline attendance synced');
    }
  } catch (error) {
    console.error('[ServiceWorker] Sync failed:', error);
  }
}

// Message handler for cache management
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // The app knows the current academy (from localStorage); push it to the SW so
  // SW-initiated network calls and notification handling stay tenant-aware even
  // after the SW is restarted (Cache Storage survives, JS variables do not).
  if (event.data && event.data.type === 'SET_TENANT') {
    event.waitUntil(persistTenantSlug(event.data.slug));
  }

  if (event.data && event.data.type === 'CACHE_VIDEO') {
    const videoId = event.data.videoId;
    // Cache video thumbnail
    caches.open(CACHE_NAME).then((cache) => {
      cache.add(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);
      cache.add(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
    });
  }
});

console.log('[ServiceWorker] Loaded');
