import axios from 'axios';

const KEY_PREFIX = 'tenant_branding:';
const FALLBACK_LOGO = '/images/academy-logo.png';

let _cache = null;

function _hostKey() {
  try { return KEY_PREFIX + (window.location.host || ''); } catch (e) { return KEY_PREFIX + 'default'; }
}

function _read() {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(_hostKey());
    if (raw) _cache = JSON.parse(raw);
  } catch (e) {}
  return _cache;
}

function _isSafeLogo(s) {
  if (typeof s !== 'string') return false;
  if (!s.startsWith('data:image/')) return false;
  if (s.indexOf(';base64,') === -1) return false;
  if (/["'<>\\]/.test(s)) return false;
  return true;
}

export function getAcademyLogoUrl() {
  const b = _read();
  if (b && _isSafeLogo(b.logo_base64)) return b.logo_base64;
  return FALLBACK_LOGO;
}

export function getAcademyName() {
  const b = _read();
  return (b && b.name) || '';
}

export async function loadBranding() {
  try {
    const { data } = await axios.get('/api/tenant/branding');
    _cache = data || {};
    if (_cache.logo_base64 && !_isSafeLogo(_cache.logo_base64)) {
      _cache.logo_base64 = '';
    }
    try { localStorage.setItem(_hostKey(), JSON.stringify(_cache)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('branding:updated', { detail: _cache })); } catch (e) {}
    return _cache;
  } catch (e) {
    return _read() || {};
  }
}
