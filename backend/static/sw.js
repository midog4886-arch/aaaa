// Service Worker for GCSP Academy PWA
const CACHE_NAME = 'gcsp-academy-v4';
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

  // API requests - Network first, then cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.ok && API_CACHE_ROUTES.some(route => url.pathname.includes(route))) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached API response if available
          return caches.match(request).then((cachedResponse) => {
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
  
  const options = {
    body: data.body || 'لديك إشعار جديد',
    icon: '/images/icon-192x192.png',
    badge: '/images/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'open', title: 'فتح' },
      { action: 'close', title: 'إغلاق' }
    ],
    dir: 'rtl',
    lang: 'ar'
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'أكاديمية أداء الأبطال', options)
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
      
      for (const record of data) {
        await fetch('/api/attendance/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
