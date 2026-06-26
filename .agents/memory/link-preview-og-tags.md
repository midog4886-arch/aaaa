---
name: link preview (Open Graph) tags
description: Why shared links show a broken thumbnail and how the OG tags in index.html fix it
---

# Link preview / Open Graph tags

When a customer-shared link (e.g. the `/join/{tenant}` registration link) is pasted
into WhatsApp/Facebook, the preview card (title + thumbnail) is built from Open Graph
meta tags in the page `<head>`. The SPA's `frontend/public/index.html` originally had
only `<title>` + `name="description"` and NO `og:*` tags, so the preview showed the
title/description but a BROKEN image placeholder (no `og:image`).

**Rule:** `frontend/public/index.html` must carry `og:type/og:title/og:description/
og:url/og:image` (+ twitter:card). `og:image` MUST be an ABSOLUTE https URL — relative
paths don't work for crawlers. We point it at the published domain logo
(`https://adaa-alabtal.replit.app/images/icon-512x512.png`).

**Why service worker cache is irrelevant here:** WhatsApp/Facebook fetch the page and
og:image from their OWN servers, not the user's browser — so a SW cache bump does
NOT help link previews (only matters for the in-app/PWA experience).

**Gotchas:**
- These OG tags are STATIC (crawlers don't run JS), so every route shares the same
  generic academy-branded card — fine without SSR.
- WhatsApp caches a URL's preview aggressively; after fixing + re-Publish, an
  already-shared link may keep showing the old broken card for a while. New sends
  refresh sooner.
- index.html changes need rebuild + copy to backend/static + restart (see
  frontend-build-deploy), AND a re-Publish for the live domain crawlers to see them.
