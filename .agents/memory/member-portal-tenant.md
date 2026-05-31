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
