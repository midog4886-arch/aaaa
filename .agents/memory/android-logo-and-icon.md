---
name: Android app logo vs launcher icon
description: How the logo shows up in the native (Capacitor) app and what is needed to change it
---

# Where the academy logo / app icon live in the native app

The Capacitor Android app loads its web content **from the live server**
(`server.url` in `frontend/capacitor.config.json` points at the production
domain), NOT from the bundled `webDir` assets. Consequences:

- **In-app logo** (the `/images/academy-logo.png` shown on login / inside
  screens) is served by the backend. Replacing that file + redeploying updates
  the native app too — no Google Play rebuild needed. Users may still see the
  old one until the **service worker cache** is refreshed: bump `CACHE_NAME` in
  `frontend/public/sw.js` (the logo is in `PRECACHE_ASSETS`), and the user must
  fully close & reopen the app (SW already calls skipWaiting + clients.claim).
  The copy bundled under `frontend/android/.../assets/public/images/` is dead
  while `server.url` is set, but keep it in sync for safety.

- **App launcher icon** (home screen + Play Store) is baked into the APK:
  `frontend/android/app/src/main/res/mipmap-*/ic_launcher.png`,
  `ic_launcher_round.png`, and the adaptive `ic_launcher_foreground.png`
  (background is the solid color `#FFFFFF` in `values/ic_launcher_background.xml`,
  foreground resolves to the `@mipmap` PNGs, not the drawable vector).
  Changing it REQUIRES regenerating those PNGs AND rebuilding the APK/AAB and
  re-publishing to Google Play — that build/publish step happens outside this
  environment. The 512×512 Play Store listing icon is uploaded separately in the
  Play Console.

**Why:** user reported "logo didn't change on Google Play" after we swapped the
web logo. The web/PWA had updated; the native in-app view just needed a SW cache
refresh, and the launcher icon is a separate APK-baked asset.

**How to apply (adaptive foreground):** content must sit in the center ~66% safe
zone or masks crop it. Our source logo has ~82% tall content, so scale it to
~0.80 of the foreground canvas centered on transparent; legacy square ~0.92 and
round ~0.85 on a white canvas.

**Standing rule conflict:** `replit.md` says never touch `frontend/android/`.
Only override when the user explicitly asks to change the app icon (they did),
and tell them clearly you are touching that folder + that a rebuild/republish is
required.
