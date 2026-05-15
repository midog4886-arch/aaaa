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

const EVENT_STATUSES = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'received', label: 'مستلم' },
  { value: 'recorded', label: 'فشل دفع مسجَّل' },
  { value: 'renewed', label: 'تجديد ناجح' },
  { value: 'duplicate', label: 'مكرر' },
  { value: 'ignored', label: 'مُتجاهل' },
  { value: 'signature_invalid', label: 'توقيع غير صالح' },
  { value: 'invalid_payload', label: 'محتوى غير صالح' },
  { value: 'tenant_not_found', label: 'أكاديمية غير موجودة' },
  { value: 'provider_disabled', label: 'مزود معطّل' },
  { value: 'secret_missing', label: 'سر مفقود' },
  { value: 'error', label: 'خطأ' },
];

const EVENT_OUTCOMES = [
  { value: 'all', label: 'كل النتائج' },
  { value: 'processed', label: '✓ تمت المعالجة' },
  { value: 'duplicate', label: '⟳ مكرر' },
  { value: 'ignored', label: '∅ تم التجاهل' },
];

const OUTCOME_COLORS = {
  processed: { bg: '#dcfce7', fg: '#166534' },
  duplicate: { bg: '#e0e7ff', fg: '#3730a3' },
  ignored: { bg: '#f1f5f9', fg: '#475569' },
};

const outcomeLabel = (o) =>
  (EVENT_OUTCOMES.find((x) => x.value === o) || {}).label || o || '—';

const STATUS_COLORS = {
  recorded: { bg: '#fef3c7', fg: '#92400e' },
  renewed: { bg: '#dcfce7', fg: '#166534' },
  duplicate: { bg: '#e0e7ff', fg: '#3730a3' },
  ignored: { bg: '#f1f5f9', fg: '#475569' },
  signature_invalid: { bg: '#fef2f2', fg: '#b91c1c' },
  invalid_payload: { bg: '#fef2f2', fg: '#b91c1c' },
  tenant_not_found: { bg: '#fef2f2', fg: '#b91c1c' },
  provider_disabled: { bg: '#fff7ed', fg: '#9a3412' },
  secret_missing: { bg: '#fff7ed', fg: '#9a3412' },
  error: { bg: '#fef2f2', fg: '#b91c1c' },
  received: { bg: '#e0f2fe', fg: '#075985' },
};

const fmt = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-EG'); } catch (e) { return iso; }
};

const statusLabel = (s) =>
  (EVENT_STATUSES.find((x) => x.value === s) || {}).label || s || '—';

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
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState('');
  const [eventStatus, setEventStatus] = useState('all');
  const [eventProvider, setEventProvider] = useState('all');
  const [eventOutcome, setEventOutcome] = useState('all');
  const [maxRetained, setMaxRetained] = useState(0);
  const [exporting, setExporting] = useState(false);

  const reloadEvents = useCallback(async (
    statusFilter = eventStatus,
    providerFilter = eventProvider,
    outcomeFilter = eventOutcome,
  ) => {
    setEventsLoading(true);
    setEventsErr('');
    try {
      const params = { limit: 200 };
      if (statusFilter && statusFilter !== 'all') params.status = statusFilter;
      if (providerFilter && providerFilter !== 'all') params.provider = providerFilter;
      if (outcomeFilter && outcomeFilter !== 'all') params.outcome = outcomeFilter;
      const res = await axios.get('/super/payment/events', { ...auth(), params });
      setEvents(Array.isArray(res.data?.items) ? res.data.items : []);
      if (typeof res.data?.max_retained === 'number') setMaxRetained(res.data.max_retained);
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate('/super/login', { replace: true });
        return;
      }
      setEventsErr(e?.response?.data?.detail || 'تعذر تحميل سجل الأحداث');
    } finally {
      setEventsLoading(false);
    }
  }, [eventStatus, eventProvider, eventOutcome, navigate]);

  useEffect(() => { reloadEvents(eventStatus, eventProvider, eventOutcome); }, [reloadEvents, eventStatus, eventProvider, eventOutcome]);

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

  const exportEventsCsv = async () => {
    setExporting(true);
    setEventsErr('');
    try {
      const params = { limit: 200 };
      if (eventStatus && eventStatus !== 'all') params.status = eventStatus;
      if (eventProvider && eventProvider !== 'all') params.provider = eventProvider;
      if (eventOutcome && eventOutcome !== 'all') params.outcome = eventOutcome;
      const res = await axios.get('/super/payment/events.csv', {
        ...auth(),
        params,
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `payment-webhook-events-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate('/super/login', { replace: true });
        return;
      }
      setEventsErr(e?.response?.data?.detail || 'تعذر تصدير سجل الأحداث');
    } finally {
      setExporting(false);
    }
  };

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

        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📜 آخر أحداث الـ webhook</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13, color: '#475569' }}>المزود:</label>
              <select
                value={eventProvider}
                onChange={(e) => setEventProvider(e.target.value)}
                style={{ ...input, width: 'auto', padding: '6px 10px' }}
              >
                <option value="all">كل المزودات</option>
                {PROVIDERS.filter((p) => p.value).map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <label style={{ fontSize: 13, color: '#475569' }}>النتيجة:</label>
              <select
                value={eventOutcome}
                onChange={(e) => setEventOutcome(e.target.value)}
                style={{ ...input, width: 'auto', padding: '6px 10px' }}
              >
                {EVENT_OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <label style={{ fontSize: 13, color: '#475569' }}>الحالة:</label>
              <select
                value={eventStatus}
                onChange={(e) => setEventStatus(e.target.value)}
                style={{ ...input, width: 'auto', padding: '6px 10px' }}
              >
                {EVENT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <button
                onClick={() => reloadEvents(eventStatus, eventProvider, eventOutcome)}
                disabled={eventsLoading}
                style={{ ...btn('#475569'), padding: '6px 12px', fontSize: 13 }}
              >
                {eventsLoading ? '...' : '↻ تحديث'}
              </button>
              <button
                onClick={exportEventsCsv}
                disabled={exporting || eventsLoading}
                style={{ ...btn('#0ea5e9'), padding: '6px 12px', fontSize: 13 }}
                title="تنزيل الأحداث المعروضة كملف CSV"
              >
                {exporting ? '...' : '⬇ تصدير CSV'}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.6 }}>
            يحتفظ النظام بآخر {maxRetained || 200} حدث وارد إلى <code style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>/api/billing/webhook/&lt;مزود&gt;</code> — مفيد لتشخيص ما إذا كانت الـ webhooks تصل وما إذا كانت تُقبل أو تُرفض.
          </div>
          {eventsErr && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{eventsErr}</div>
          )}
          {eventsLoading && events.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 14, padding: 12 }}>جارٍ التحميل...</div>
          ) : events.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 14, padding: 12, textAlign: 'center', background: '#f8fafc', borderRadius: 8 }}>
              لا توجد أحداث {eventStatus !== 'all' ? 'بهذه الحالة' : 'مسجلة بعد'}.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'right' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>الوقت</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>المزود</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>النتيجة</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>الحالة</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>الأكاديمية</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>السبب / التفاصيل</th>
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>event_id</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev, i) => {
                    const c = STATUS_COLORS[ev.status] || { bg: '#f1f5f9', fg: '#475569' };
                    const oc = OUTCOME_COLORS[ev.outcome] || { bg: '#f1f5f9', fg: '#475569' };
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#0f172a' }}>{fmt(ev.received_at)}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#0f172a' }}>{ev.provider || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: oc.bg, color: oc.fg, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontSize: 12 }}>
                            {outcomeLabel(ev.outcome)}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 999, fontWeight: 600, fontSize: 12 }}>
                            {statusLabel(ev.status)}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#0f172a' }}>{ev.tenant_slug || '—'}</td>
                        <td style={{ padding: '8px 10px', color: '#475569', maxWidth: 320, wordBreak: 'break-word' }}>{ev.reason || '—'}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#64748b', fontSize: 12, wordBreak: 'break-all', maxWidth: 200 }}>{ev.event_id || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
