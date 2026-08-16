---
name: Capacitor external links (WhatsApp) in native member app
description: Why wa.me/whatsapp:// failed inside the Android app and the config rule
---
`allowNavigation: ["*"]` in `frontend/capacitor.config.json` (mirrored in `frontend/android/app/src/main/assets/capacitor.config.json`) makes Capacitor's `Bridge.launchIntent` treat EVERY host as in-app, so wa.me loads inside the WebView and its redirect to `whatsapp://send` dies with net::ERR_UNKNOWN_URL_SCHEME.

**Rule:** never use `"*"` in allowNavigation. With no allowNavigation, any host other than `server.url` (adaa-alabtal.replit.app) is launched as an external intent — wa.me / tel: / mailto: open the right app automatically.

**Why:** member-portal "تجديد الاشتراك عبر واتساب" buttons broke on the published Android app.

**How to apply:** config is APK-baked — after editing, the app must be re-synced (`npx cap sync android`, or hand-edit the assets copy too) and the AAB rebuilt + republished on Google Play; a server deploy alone does NOT fix devices on the old APK. No web-side workaround exists while the old APK has `"*"`.
