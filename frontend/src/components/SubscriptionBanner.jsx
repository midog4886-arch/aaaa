import React, { useEffect, useState } from 'react';
import { AlertTriangle, AlertOctagon, XCircle } from 'lucide-react';
import { getSubscriptionInfo } from '../services/branding';

const STORAGE_DISMISS_PREFIX = 'subscription_banner_dismissed:';

function _dismissKey(endAt) {
  return STORAGE_DISMISS_PREFIX + (endAt || 'unknown');
}

export default function SubscriptionBanner() {
  const [info, setInfo] = useState(getSubscriptionInfo());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const refresh = () => setInfo(getSubscriptionInfo());
    window.addEventListener('branding:updated', refresh);
    const id = setInterval(refresh, 60 * 60 * 1000);
    return () => { window.removeEventListener('branding:updated', refresh); clearInterval(id); };
  }, []);

  useEffect(() => {
    try {
      const d = localStorage.getItem(_dismissKey(info.endAt));
      setDismissed(d === '1' && info.state === 'warning');
    } catch (e) {}
  }, [info.endAt, info.state]);

  if (info.state === 'active') return null;
  if (dismissed && info.state === 'warning') return null;

  const palette = {
    warning: { bg: '#fef3c7', border: '#f59e0b', text: '#78350f', Icon: AlertTriangle },
    urgent: { bg: '#fee2e2', border: '#ef4444', text: '#7f1d1d', Icon: AlertOctagon },
    expired: { bg: '#fecaca', border: '#dc2626', text: '#7f1d1d', Icon: XCircle },
    suspended: { bg: '#1f2937', border: '#111827', text: '#fef2f2', Icon: XCircle },
  }[info.state] || { bg: '#fef3c7', border: '#f59e0b', text: '#78350f', Icon: AlertTriangle };

  const Icon = palette.Icon;

  let message = '';
  if (info.state === 'suspended') {
    message = 'تم تعليق اشتراك الأكاديمية. يرجى التواصل مع الإدارة لتفعيل الحساب.';
  } else if (info.state === 'expired') {
    message = `انتهت صلاحية الاشتراك منذ ${Math.abs(info.daysRemaining)} يوم. يرجى تجديد الاشتراك للاستمرار.`;
  } else if (info.state === 'urgent') {
    message = info.daysRemaining === 0
      ? 'ينتهي اشتراك الأكاديمية اليوم. يرجى التجديد فوراً لتجنب انقطاع الخدمة.'
      : `ينتهي اشتراك الأكاديمية خلال ${info.daysRemaining} ${info.daysRemaining === 1 ? 'يوم' : 'أيام'}. يرجى التجديد قريباً.`;
  } else {
    message = `ينتهي اشتراك الأكاديمية خلال ${info.daysRemaining} يوم. يُنصح بتجديد الاشتراك قبل انتهاء المدة.`;
  }

  const dismiss = () => {
    try { localStorage.setItem(_dismissKey(info.endAt), '1'); } catch (e) {}
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', margin: '8px 12px 0 12px',
        background: palette.bg, color: palette.text,
        border: `1px solid ${palette.border}`,
        borderRadius: 8, fontSize: 14, fontWeight: 600,
        direction: 'rtl',
      }}
    >
      <Icon size={20} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>{message}</div>
      {info.state === 'warning' && (
        <button
          onClick={dismiss}
          style={{ background: 'transparent', border: `1px solid ${palette.border}`, color: palette.text, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
        >
          إخفاء
        </button>
      )}
    </div>
  );
}
