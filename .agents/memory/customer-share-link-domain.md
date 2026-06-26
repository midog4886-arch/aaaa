---
name: customer-facing share link domain
description: Why customer-shared links must not use window.location.origin, and how getPublicBaseUrl resolves the trusted domain
---

# Customer-facing share link domain

Links shared with CUSTOMERS — public registration link `/register/{tenant}/{branch}`,
social/join link `/join/{tenant}`, and marketer referral link `/register/...?ref=` —
must NOT be built from `window.location.origin`. When an admin copies a link while
working inside the Replit dev preview, the origin is a long random `...replit.dev`
host that looks like a phishing/untrustworthy link in WhatsApp.

**Rule:** build these links with `getPublicBaseUrl()` (`frontend/src/utils/publicUrl.js`),
not `window.location.origin`.

**How it resolves:**
- On `localhost` / `127.0.0.1` / `*.replit.dev` / `*.repl.co` → returns the published
  base (`REACT_APP_PUBLIC_BASE_URL` env, default `https://adaa-alabtal.replit.app`).
- Otherwise → returns `window.location.origin`, so the published `.replit.app` site
  AND a future custom domain both work automatically (no code change needed; once the
  admin opens the app through the custom domain, links use it).

**Why:** customers distrust long random dev-preview URLs. The published domain is the
trustworthy one. For a custom domain later, either just browse the app via it, or set
`REACT_APP_PUBLIC_BASE_URL` at build time.

**How to apply:** any NEW customer-shared link must use `getPublicBaseUrl()`. Do NOT
change the other `window.location.origin` uses — QR scanner station, print-template
logo `src` (`/images/academy-logo.png`), and internal embeds are correctly
origin-relative.
