---
name: AcademyGuard public route bypass
description: Any new public/tokenized route must be whitelisted in ACADEMY_BYPASS_PREFIXES or it silently redirects to the academy picker.
---

# AcademyGuard blocks unlisted public routes

`AcademyGuard` (frontend `App.js`) redirects any visitor without a confirmed academy
to `/academy-picker`, UNLESS the path matches a prefix in `ACADEMY_BYPASS_PREFIXES`
(matched as exact `path === p` or `path.startsWith(p + '/')`).

**Why:** A new public, tokenized entry point (e.g. the marketer self-service portal
`/marketer/:tenantSlug/:token`) is reached by logged-out users who have never picked
an academy. If its prefix is not in the bypass list, they get bounced to the picker
and the public link is effectively dead — even though the route + page render fine.

**How to apply:** Whenever you add a route meant to work for unauthenticated /
no-academy-context visitors (public registration, join, coach QR, marketer portal,
etc.), add its top-level prefix to `ACADEMY_BYPASS_PREFIXES` in the same change, then
rebuild + redeploy (the list is baked into the JS bundle in `backend/static`).
Verify by loading the route logged-out: it should show the page (or its own error),
NOT the academy picker.
