---
name: Push notification logo/image base URL
description: Why push-notification image URLs must be resolved from env vars (not the request) and the resolution priority.
---

# Push notification logo/image base URL

Push notification icon/image URLs (per-academy logos) MUST be absolute https URLs:
FCM's image CDN fetches the URL itself and cannot resolve a relative path. Web push
can use a relative URL (the service worker resolves it against its own origin), but
FCM cannot.

**Why env-based, not request-based:** pushes are almost always sent from background
tasks (new-video notifications, broadcasts, onboarding welcome) with NO incoming
request, so `request.base_url` is unavailable. The absolute origin must come from
environment variables.

**How to apply:** `_public_base_url()` in `backend/routes/push_notifications.py`
resolves the origin in priority order: `REACT_APP_BACKEND_URL` -> `PUBLIC_BASE_URL`
-> `REPLIT_DOMAINS` (first comma-separated entry, prefixed with https://).
`REPLIT_DOMAINS` is always present on a Replit deployment, so branding works without
a hand-set env var. If none resolve, FCM drops the image (falls back to the APK-baked
`ic_launcher`) and web push falls back to a relative URL — both graceful.
