import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';

const auth = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('super_token') || ''}` },
});

const KINDS = ['welcome', 'trial_ending', 'payment_success', 'payment_failed', 'suspended', 'cancelled'];
const STATUSES = ['sent', 'failed', 'skipped'];

const statusBadge = (s) => {
  const map = {
    sent: { bg: '#dcfce7', fg: '#166534', label: 'تم الإرسال' },
    failed: { bg: '#fee2e2', fg: '#991b1b', label: 'فشل' },
    skipped: { bg: '#fef3c7', fg: '#92400e', label: 'تم التخطي' },
  };
  const m = map[s] || { bg: '#e2e8f0', fg: '#334155', label: s || '—' };
  return (
    <span style={{ background: m.bg, color: m.fg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
      {m.label}
    </span>
  );
};

const fmt = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-EG'); } catch (e) { return iso; }
};

export default function SuperEmails() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ provider: '', from_email: '', from_name: '', enabled: true });
  const [savingSettings, setSavingSettings] = useState(false);
  const [items, setItems] = useState([]);
  const [filterKind, setFilterKind] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testKind, setTestKind] = useState('welcome');
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [s, log] = await Promise.all([
        axios.get('/super/email/settings', auth()),
        axios.get('/super/email/log', {
          ...auth(),
          params: { limit: 200, kind: filterKind, status: filterStatus, tenant_slug: filterTenant },
        }),
      ]);
      setSettings(s.data);
      setDraft({
        provider: s.data.provider || '',
        from_email: s.data.from_email || '',
        from_name: s.data.from_name || '',
        enabled: !!s.data.enabled,
      });
      setItems(log.data?.items || []);
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate('/super/login', { replace: true });
        return;
      }
      setErr(e?.response?.data?.detail || 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [filterKind, filterStatus, filterTenant, navigate]);

  useEffect(() => { reload(); }, [reload]);

  const saveSettings = async () => {
    setSavingSettings(true);
    setErr('');
    try {
      const res = await axios.put('/super/email/settings', draft, auth());
      setSettings(res.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'تعذر حفظ الإعدادات');
    } finally {
      setSavingSettings(false);
    }
  };

  const sendTest = async () => {
    if (!testTo || !testTo.includes('@')) {
      setTestResult({ status: 'failed', error: 'أدخل بريداً صالحاً' });
      return;
    }
    setBusy(true);
    setTestResult(null);
    try {
      const res = await axios.post('/super/email/test', { to: testTo, kind: testKind }, auth());
      setTestResult(res.data);
      reload();
    } catch (e) {
      setTestResult({ status: 'failed', error: e?.response?.data?.detail || 'فشل الإرسال' });
    } finally {
      setBusy(false);
    }
  };

  const runTrialChecks = async () => {
    setBusy(true);
    try {
      const res = await axios.post('/super/email/run-trial-checks', {}, auth());
      alert(`أُرسل ${res.data?.sent || 0}، تخطّى ${res.data?.skipped || 0}`);
      reload();
    } catch (e) {
      alert(e?.response?.data?.detail || 'فشل التشغيل');
    } finally {
      setBusy(false);
    }
  };

  const card = { background: 'white', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
  const label = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 };
  const input = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' };
  const btn = (color = '#0f172a') => ({ padding: '8px 16px', background: color, color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' });

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f8fafc', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>📧 إيميلات الأكاديميات</h1>
          <Link to="/super/tenants" style={{ color: '#0ea5e9', textDecoration: 'none', fontSize: 14 }}>← العودة للأكاديميات</Link>
        </div>

        {err && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{err}</div>
        )}

        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>إعدادات مزود الإيميل</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>المزود</label>
              <select value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} style={input}>
                <option value="">— معطل —</option>
                <option value="resend">Resend</option>
                <option value="sendgrid">SendGrid</option>
              </select>
            </div>
            <div>
              <label style={label}>From Email</label>
              <input type="email" value={draft.from_email} onChange={(e) => setDraft({ ...draft, from_email: e.target.value })} placeholder="no-reply@yourdomain.com" style={input} />
            </div>
            <div>
              <label style={label}>From Name</label>
              <input type="text" value={draft.from_name} onChange={(e) => setDraft({ ...draft, from_name: e.target.value })} placeholder="Champions Academy" style={input} />
            </div>
            <div>
              <label style={label}>تفعيل</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8 }}>
                <input type="checkbox" checked={!!draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                <span style={{ fontSize: 14 }}>إرسال الإيميلات تلقائياً</span>
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={saveSettings} disabled={savingSettings} style={btn()}>{savingSettings ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</button>
            {settings && (
              <span style={{ fontSize: 13, color: settings.has_api_key ? '#059669' : '#b91c1c' }}>
                {settings.has_api_key ? '✓ مفتاح API موجود في الـ secrets' : '⚠️ المفتاح مفقود — أضف ' + (draft.provider === 'sendgrid' ? 'SENDGRID_API_KEY' : 'RESEND_API_KEY') + ' في الـ secrets'}
              </span>
            )}
          </div>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>إرسال إيميل تجريبي</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={label}>إلى</label>
              <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" style={input} />
            </div>
            <div>
              <label style={label}>القالب</label>
              <select value={testKind} onChange={(e) => setTestKind(e.target.value)} style={input}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <button onClick={sendTest} disabled={busy} style={btn('#0ea5e9')}>{busy ? '...' : 'إرسال'}</button>
          </div>
          {testResult && (
            <div style={{ marginTop: 12, fontSize: 13, color: testResult.status === 'sent' ? '#166534' : '#b91c1c' }}>
              {testResult.status === 'sent' ? `✓ أُرسل (${testResult.id || ''})` : `✗ ${testResult.status}: ${testResult.error || ''}`}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button onClick={runTrialChecks} disabled={busy} style={{ ...btn('#7c3aed'), fontSize: 13 }}>تشغيل فحص التذكيرات يدوياً</button>
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>سجل الإيميلات (آخر {items.length})</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} style={{ ...input, width: 'auto' }}>
                <option value="">كل القوالب</option>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...input, width: 'auto' }}>
                <option value="">كل الحالات</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)} placeholder="slug الأكاديمية" style={{ ...input, width: 160 }} />
              <button onClick={reload} disabled={loading} style={btn('#475569')}>{loading ? '...' : 'تحديث'}</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'right' }}>
                  <th style={{ padding: 10 }}>الوقت</th>
                  <th style={{ padding: 10 }}>القالب</th>
                  <th style={{ padding: 10 }}>إلى</th>
                  <th style={{ padding: 10 }}>الأكاديمية</th>
                  <th style={{ padding: 10 }}>الحالة</th>
                  <th style={{ padding: 10 }}>المزود</th>
                  <th style={{ padding: 10 }}>الموضوع / الخطأ</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>{loading ? 'جارٍ التحميل...' : 'لا توجد سجلات'}</td></tr>
                )}
                {items.map((it) => (
                  <tr key={it.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: 10, color: '#475569', whiteSpace: 'nowrap' }}>{fmt(it.sent_at)}</td>
                    <td style={{ padding: 10, fontFamily: 'monospace' }}>{it.kind}</td>
                    <td style={{ padding: 10 }}>{it.to}</td>
                    <td style={{ padding: 10 }}>{it.tenant_slug || '—'}</td>
                    <td style={{ padding: 10 }}>{statusBadge(it.status)}</td>
                    <td style={{ padding: 10, color: '#64748b' }}>{it.provider || '—'}</td>
                    <td style={{ padding: 10, color: it.status === 'failed' ? '#b91c1c' : '#334155', maxWidth: 360, wordBreak: 'break-word' }}>
                      {it.status === 'failed' ? it.error : it.subject}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
