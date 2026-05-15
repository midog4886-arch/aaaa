import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

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
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[App] Service Worker registered:', registration.scope);
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
        registration.update();
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
