import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { getTenantSlug } from "./config/api";
import { toast } from 'sonner';

// Global guard: mouse-wheel over a focused number input must never change its
// value (fees, discounts, quantities...). Covers raw <input type="number">
// everywhere; the shared ui/Input has the same guard component-side.
document.addEventListener(
  "wheel",
  (e) => {
    const el = document.activeElement;
    if (el && el.tagName === "INPUT" && el.type === "number" && (el === e.target || el.contains(e.target))) {
      el.blur();
    }
  },
  { passive: true, capture: true }
);

// Optional Sentry error monitoring — only initialised when the deploy supplies
// REACT_APP_SENTRY_DSN, so local/dev builds and customers who haven't opted in
// stay zero-cost. Loaded lazily so a missing dependency cannot break boot.
if (process.env.REACT_APP_SENTRY_DSN) {
  import('@sentry/react')
    .then((Sentry) => {
      try {
        Sentry.init({
          dsn: process.env.REACT_APP_SENTRY_DSN,
          environment: process.env.REACT_APP_SENTRY_ENV || 'production',
          release: process.env.REACT_APP_SENTRY_RELEASE || undefined,
          tracesSampleRate: parseFloat(process.env.REACT_APP_SENTRY_TRACES_RATE || '0.05'),
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0.1,
        });
      } catch (e) {
        console.warn('[Sentry] init failed:', e);
      }
    })
    .catch(() => {
      console.warn('[Sentry] @sentry/react not installed; skipping error monitoring.');
    });
}

if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      // Keep entered form data intact while a new version takes control.
      const editing = Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), textarea'))
        .some(input => input.value || input === document.activeElement);
      if (editing) {
        toast.info('تحديث جديد جاهز. أعد تحميل الصفحة عندما تنتهي من إدخال بياناتك.', {
          duration: Infinity,
          action: { label: 'تحديث الآن', onClick: () => window.location.reload() },
          id: 'app-update-ready',
        });
        return;
      }
      refreshing = true;
      window.location.reload();
    }
  });

  // Push the current academy (tenant) slug into the service worker so any
  // SW-initiated network call and notification handling stays scoped to the
  // member's own academy. The native/PWA app shares one fixed domain across
  // academies, so the SW cannot infer the tenant on its own.
  const postTenantToSW = () => {
    try {
      const sw = navigator.serviceWorker.controller;
      if (sw) {
        sw.postMessage({ type: 'SET_TENANT', slug: getTenantSlug() });
      }
    } catch (e) {
      console.warn('[App] Failed to send tenant slug to Service Worker:', e);
    }
  };

  navigator.serviceWorker.ready.then(postTenantToSW).catch(() => {});

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        console.log('[App] Service Worker registered:', registration.scope);
        postTenantToSW();
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
        let lastCheck = 0;
        const checkForUpdate = () => {
          if (!navigator.onLine || document.visibilityState === 'hidden' || Date.now() - lastCheck < 60000) return;
          lastCheck = Date.now();
          registration.update().catch(() => {});
        };
        checkForUpdate();
        window.addEventListener('focus', checkForUpdate);
        window.addEventListener('online', checkForUpdate);
        document.addEventListener('visibilitychange', checkForUpdate);
        window.setInterval(checkForUpdate, 5 * 60 * 1000);
      })
      .catch((error) => {
        console.error('[App] Service Worker registration failed:', error);
      });
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
