import axios from 'axios';
import { useEffect, useState } from 'react';

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

function _isHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function _hexToHslComponents(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function _relLuminance(hex) {
  const toLin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = toLin(parseInt(hex.slice(1, 3), 16));
  const g = toLin(parseInt(hex.slice(3, 5), 16));
  const b = toLin(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function _foregroundFor(hex) {
  const L = _relLuminance(hex);
  const contrastWhite = (1.0 + 0.05) / (L + 0.05);
  const contrastBlack = (L + 0.05) / (0.0 + 0.05);
  return contrastBlack >= contrastWhite ? '0 0% 10%' : '0 0% 100%';
}

export function applyTheme(primaryHex) {
  try {
    const root = document.documentElement;
    if (!_isHexColor(primaryHex)) {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--primary-foreground');
      root.style.removeProperty('--ring');
      root.style.removeProperty('--brand');
      return;
    }
    const { h, s, l } = _hexToHslComponents(primaryHex);
    root.style.setProperty('--primary', `${h} ${s}% ${l}%`);
    root.style.setProperty('--primary-foreground', _foregroundFor(primaryHex));
    root.style.setProperty('--ring', `${h} ${s}% ${l}%`);
    root.style.setProperty('--brand', primaryHex);
  } catch (e) {}
}

/**
 * React hook that returns the live tenant primary color (hex string),
 * or '' when no tenant brand color is set. Re-renders on `branding:updated`.
 *
 * Usage:
 *   const primary = useBrandColor();
 *   <span style={primary ? { color: primary } : undefined} className={primary ? '' : 'text-amber-600'} />
 *
 * For pure CSS-based usage prefer the `--brand` custom property on `:root`,
 * e.g. `style={{ color: 'var(--brand, #d97706)' }}`.
 */
export function useBrandColor() {
  const [primary, setPrimary] = useState(getPrimaryColor());
  useEffect(() => {
    const onUpdate = () => setPrimary(getPrimaryColor());
    window.addEventListener('branding:updated', onUpdate);
    return () => window.removeEventListener('branding:updated', onUpdate);
  }, []);
  return primary;
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

export function getPrimaryColor() {
  const b = _read();
  return (b && _isHexColor(b.primary_color)) ? b.primary_color : '';
}

export async function loadBranding() {
  try {
    const { data } = await axios.get('/api/tenant/branding');
    _cache = data || {};
    if (_cache.logo_base64 && !_isSafeLogo(_cache.logo_base64)) _cache.logo_base64 = '';
    if (_cache.primary_color && !_isHexColor(_cache.primary_color)) _cache.primary_color = '';
    try { localStorage.setItem(_hostKey(), JSON.stringify(_cache)); } catch (e) {}
    applyTheme(_cache.primary_color);
    try { window.dispatchEvent(new CustomEvent('branding:updated', { detail: _cache })); } catch (e) {}
    return _cache;
  } catch (e) {
    const cached = _read() || {};
    applyTheme(cached.primary_color);
    return cached;
  }
}

export function getSubscriptionInfo() {
  const b = _read() || {};
  const days = (typeof b.days_remaining === 'number') ? b.days_remaining : null;
  const status = b.status || '';
  let state = 'active';
  if (status === 'suspended') state = 'suspended';
  else if (days !== null && days < 0) state = 'expired';
  else if (days !== null && days <= 3) state = 'urgent';
  else if (days !== null && days <= 14) state = 'warning';
  return {
    state,
    daysRemaining: days,
    status,
    endAt: b.subscription_end_at || '',
    autoSuspend: !!b.auto_suspend_on_expiry,
  };
}
