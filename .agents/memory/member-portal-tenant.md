---
name: Member portal tenant resolution
description: How the member portal resolves the tenant on the shared native app, and why explicit X-Tenant-Slug headers are required.
---

# Member portal tenant resolution

The Capacitor native app for members ships against ONE fixed domain
(`LIVE_SERVER_URL` in `frontend/src/config/api.js`), and multiple academies
share that same app. The backend tenant middleware resolves the tenant from
subdomain → `X-Tenant-Slug` header → `default`. A fixed domain has no useful
subdomain, so the **header is the only signal** for non-default academies.

**Rule:** every member-facing request must carry `X-Tenant-Slug` (use
`getTenantSlug()` from `config/api.js`).
- `member_login` queries the tenant DB resolved from the header, and
  `create_member_token` embeds that tenant in the JWT.
- `get_current_member` returns **403 Tenant mismatch** if the token's tenant
  differs from the request's resolved tenant.

**Why:** `memberAPI` is created via `axios.create()`, which does NOT inherit the
global `axios.interceptors` registered in `services/api.js`. So the member
portal needs its own header injection; otherwise non-default academies silently
fall back to `default` and either 404 on login or 403 on every API call.

**How to apply:**
- When switching academy (`AcademyPickerPage.confirmAcademy`), clear the cached
  `member_token`/`member_data` if the slug changed, or the portal redirects into
  a stale wrong-tenant dashboard and then 403s.
- The remembered member phone for one-tap login is tenant-scoped
  (`member_login_phone:<slug>`) so auto-login can't sign into the wrong academy.
- Any member-facing component that does its OWN `axios.create()` or raw `axios`
  calls (not routed through `memberAPI`) must inject `X-Tenant-Slug` itself.
  Known case: `PushNotificationManager.jsx` has its own `pushAPI` instance with
  a header interceptor. When adding new shared member components, either route
  through `memberAPI` or add the same interceptor.
- Service worker (`public/sw.js`, the only registered one — `service-worker.js`
  is dead/unregistered) caches `/api/advertisements/public` + daily-videos. The
  SW has no localStorage, so it reads `X-Tenant-Slug` off the intercepted member
  request and folds it into a synthetic `?__tenant=<slug>` cache key
  (`tenantScopedRequest`); per-academy cache keeps offline fallback from leaking
  one academy's data to another. Bump `CACHE_NAME` to purge old un-scoped entries.
- Web-push ROUTING is already correct without any SW tenant logic — the
  subscription lives in the academy's own tenant DB, so the server only delivers
  a push to that academy's members. The SW only renders the payload + opens url.
- Even so, the SW is now tenant-aware defensively: the backend stamps the
  recipient's academy `tenant` slug onto every web-push payload
  (`send_push_notification`), and the app posts the slug to the SW via a
  `SET_TENANT` message (index.js on load/ready + subscribeWeb). The SW persists
  it in Cache Storage (key `/__sw-tenant-slug`) because the SW is killed when
  idle and JS variables don't survive between push events.
- The SW uses this slug to (a) namespace the notification `tag` per academy so
  one academy's push can't collapse/replace another's on a shared device, and
  (b) attach `X-Tenant-Slug` to any SW-initiated fetch.
- The SW `offline-attendance` sync path is dead (nothing writes that cache key),
  but its `/api/attendance/record` POST now sends `X-Tenant-Slug` from the
  persisted slug so it can't silently hit the default tenant if ever revived.
