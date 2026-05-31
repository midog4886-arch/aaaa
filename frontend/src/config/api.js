import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

const LIVE_SERVER_URL = 'https://adaa-alabtal.replit.app';

export const API_URL = isNative ? LIVE_SERVER_URL : '';

export const getApiUrl = () => API_URL;

// ── Tenant + remembered member identity helpers ───────────────────────────
// The native app runs on a single fixed domain, so the backend cannot infer
// the tenant from the host; it relies on the `X-Tenant-Slug` header. These
// helpers keep that slug (and the remembered member phone) consistent across
// the academy picker, member login, and the member portal API instance.
export const getTenantSlug = () => {
  try { return localStorage.getItem('tenant_slug') || 'default'; } catch { return 'default'; }
};

const rememberedPhoneKey = () => `member_login_phone:${getTenantSlug()}`;

export const getRememberedMemberPhone = () => {
  try {
    const scoped = localStorage.getItem(rememberedPhoneKey());
    if (scoped) return scoped;
    // Fall back to the legacy unscoped key so a phone remembered before
    // tenant-scoping still pre-fills; the next successful login rewrites it
    // under the scoped key.
    return localStorage.getItem('member_login_phone') || '';
  } catch { return ''; }
};

export const setRememberedMemberPhone = (phone) => {
  try { if (phone) localStorage.setItem(rememberedPhoneKey(), phone); } catch {}
};

export const clearRememberedMemberPhone = () => {
  try { localStorage.removeItem(rememberedPhoneKey()); } catch {}
  // Drop the legacy unscoped key too (written before tenant-scoping).
  try { localStorage.removeItem('member_login_phone'); } catch {}
};

export default API_URL;
