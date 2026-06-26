// Canonical public base URL for links shared with CUSTOMERS (registration / join /
// referral links).
//
// Problem: when an admin copies a share link while working inside the Replit DEV
// preview, the origin is a long random "...replit.dev" host that looks like a
// suspicious / untrustworthy link in WhatsApp. We never want to hand that to a
// customer.
//
// Behaviour:
//   - On the dev preview (or localhost) -> use the published domain below.
//   - On the published site OR a future custom domain -> use that origin as-is,
//     so links automatically become the custom domain once the academy opens the
//     app through it (no code change needed). It can also be forced via the
//     REACT_APP_PUBLIC_BASE_URL build env var.
const PUBLISHED_BASE_URL = (
  process.env.REACT_APP_PUBLIC_BASE_URL || 'https://adaa-alabtal.replit.app'
).replace(/\/+$/, '');

// Matches Replit dev/preview hosts (e.g. *.replit.dev, *.pike.replit.dev, *.repl.co).
const DEV_HOST_RE = /(\.replit\.dev|\.repl\.co)$/i;

export function getPublicBaseUrl() {
  if (typeof window === 'undefined' || !window.location) return PUBLISHED_BASE_URL;
  const { origin, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || DEV_HOST_RE.test(hostname)) {
    return PUBLISHED_BASE_URL;
  }
  return (origin || PUBLISHED_BASE_URL).replace(/\/+$/, '');
}
