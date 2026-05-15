import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';

const auth = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('super_token') || ''}` },
});

const PROVIDERS = [
  { value: '', label: '— معطل —' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'moyasar', label: 'Moyasar' },
  { value: 'tap', label: 'Tap' },
];

const fmt = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-EG'); } catch (e) { return iso; }
};

export default function SuperPayment() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ provider: '', enabled: false, secret_env: 'PAYMENT_WEBHOOK_SECRET' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await axios.get('/super/payment/settings', auth());
      setSettings(res.data);
      setDraft({
        provider: res.data.provider || '',
        enabled: !!res.data.enabled,
        secret_env: res.data.secret_env || 'PAYMENT_WEBHOOK_SECRET',
      });
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate('/super/login', { replace: true });
        return;
      }
      setErr(e?.response?.data?.detail || 'تعذر تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => { reload(); }, [reload]);

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    setErr('');
    try {
      const res = await axios.post('/super/payment/test-webhook', {}, auth());
      setTestResult(res.data);
    } catch (e) {
      const data = e?.response?.data;
      setTestResult({
        ok: false,
        error: (data && data.detail) || e?.message || 'تعذر إرسال الـ webhook التجريبي',
        status_code: e?.response?.status,
      });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');
    try {
      const res = await axios.put('/super/payment/settings', draft, auth());
      setSettings(res.data);
      setDraft({
        provider: res.data.provider || '',
        enabled: !!res.data.enabled,
        secret_env: res.data.secret_env || 'PAYMENT_WEBHOOK_SECRET',
      });
      setOkMsg('تم حفظ الإعدادات بنجاح');
      setTimeout(() => setOkMsg(''), 3000);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'تعذر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const card = { background: 'white', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
  const label = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 };
  const input = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' };
  const btn = (color = '#0f172a') => ({ padding: '8px 16px', background: color, color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' });

  const secretMissing = settings && draft.enabled && !settings.has_secret;

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>💳 إعدادات مزود الدفع</h1>
          <Link to="/super/tenants" style={{ color: '#0ea5e9', textDecoration: 'none', fontSize: 14 }}>← العودة للأكاديميات</Link>
        </div>

        {err && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{err}</div>
        )}
        {okMsg && (
          <div style={{ background: '#dcfce7', color: '#166534', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{okMsg}</div>
        )}

        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 8 }}>الإعدادات الحالية</h2>
          {loading && !settings ? (
            <div style={{ color: '#64748b', fontSize: 14 }}>جارٍ التحميل...</div>
          ) : settings ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>المزود</div>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{settings.provider || '— معطل —'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>التفعيل</div>
                <div style={{ fontWeight: 600, color: settings.enabled ? '#059669' : '#b91c1c' }}>
                  {settings.enabled ? '✓ مفعل' : '✗ غير مفعل'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>اسم متغير السر</div>
                <div style={{ fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>{settings.secret_env}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>حالة السر</div>
                <div style={{ fontWeight: 600, color: settings.has_secret ? '#059669' : '#b91c1c' }}>
                  {settings.has_secret ? '✓ موجود في الـ secrets' : '✗ مفقود'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>آخر تحديث</div>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{fmt(settings.updated_at)}</div>
              </div>
            </div>
          ) : null}
        </div>

        {secretMissing && (
          <div style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            ⚠️ المزود مفعّل لكن متغير البيئة <code style={{ fontFamily: 'monospace', background: '#fff7ed', padding: '1px 6px', borderRadius: 4 }}>{draft.secret_env}</code> غير مضبوط في الـ secrets — لن تنجح عملية التحقق من توقيع الـ webhook حتى يُضاف.
          </div>
        )}

        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>تحديث الإعدادات</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={label}>مزود الدفع</label>
              <select value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} style={input}>
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>اسم متغير السر</label>
              <input
                type="text"
                value={draft.secret_env}
                onChange={(e) => setDraft({ ...draft, secret_env: e.target.value })}
                placeholder="PAYMENT_WEBHOOK_SECRET"
                style={{ ...input, fontFamily: 'monospace' }}
              />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                حروف وأرقام و _ فقط. السر نفسه يُقرأ من الـ secrets.
              </div>
            </div>
            <div>
              <label style={label}>التفعيل</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                <input
                  type="checkbox"
                  checked={!!draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                <span style={{ fontSize: 14 }}>قبول webhooks الدفع</span>
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={save} disabled={saving} style={btn()}>{saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</button>
            <button onClick={reload} disabled={loading} style={btn('#475569')}>{loading ? '...' : '↻ إعادة تحميل'}</button>
          </div>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 8 }}>اختبار الاتصال بالـ webhook</h2>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, lineHeight: 1.6 }}>
            يولّد حدثاً وهمياً موقّعاً بالسر الحالي ويتحقق منه بنفس الدالة التي يستخدمها مسار <code style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>/api/billing/webhook/{settings?.provider || '…'}</code>. لا يُجرى أي اتصال خارجي ولا يُسجَّل أي تجديد أو فشل دفع.
          </div>
          <button
            onClick={sendTest}
            disabled={testing || !settings?.enabled || !settings?.provider || !settings?.has_secret}
            style={{ ...btn('#0ea5e9'), opacity: (testing || !settings?.enabled || !settings?.provider || !settings?.has_secret) ? 0.6 : 1 }}
            title={
              !settings?.provider ? 'اختر مزوداً أولاً' :
              !settings?.enabled ? 'فعّل المزود أولاً' :
              !settings?.has_secret ? 'اضبط السر في الـ secrets أولاً' : ''
            }
          >
            {testing ? 'جارٍ الاختبار...' : '📤 إرسال webhook تجريبي'}
          </button>

          {testResult && (
            <div style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              fontSize: 13,
              background: testResult.ok ? '#dcfce7' : '#fef2f2',
              color: testResult.ok ? '#166534' : '#b91c1c',
              border: `1px solid ${testResult.ok ? '#86efac' : '#fecaca'}`,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {testResult.ok ? '✓ نجح التحقق من التوقيع' : '✗ فشل التحقق من التوقيع'}
              </div>
              {testResult.error && (
                <div style={{ marginBottom: 6 }}>{testResult.error}</div>
              )}
              <div style={{ fontSize: 12, opacity: 0.85, fontFamily: 'monospace' }}>
                {testResult.provider ? `provider: ${testResult.provider}` : ''}
                {testResult.signature_header ? ` · header: ${testResult.signature_header}` : ''}
                {testResult.secret_env ? ` · secret_env: ${testResult.secret_env}` : ''}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
