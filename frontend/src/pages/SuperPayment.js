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

const FAILURE_STATUSES = ['signature_invalid', 'tenant_not_found', 'secret_missing', 'error', 'invalid_payload'];
const SUCCESS_STATUSES = ['recorded', 'renewed'];
const NEUTRAL_STATUSES = ['received', 'duplicate', 'ignored', 'provider_disabled'];
const REPROCESS_ELIGIBLE_STATUSES = ['tenant_not_found', 'error'];

const STAT_STYLES = {
  total: { bg: '#f1f5f9', fg: '#0f172a', border: '#cbd5e1' },
  success: { bg: '#dcfce7', fg: '#166534', border: '#86efac' },
  failure: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca' },
  neutral: { bg: '#fff7ed', fg: '#9a3412', border: '#fed7aa' },
};

const WINDOW_OPTIONS = [
  { value: 1, label: 'آخر ساعة' },
  { value: 6, label: 'آخر 6 ساعات' },
  { value: 24, label: 'آخر 24 ساعة' },
  { value: 24 * 7, label: 'آخر 7 أيام' },
];

function StatPill({ kind, label, count }) {
  const s = STAT_STYLES[kind] || STAT_STYLES.neutral;
  return (
    <div style={{
      background: s.bg,
      color: s.fg,
      border: `1px solid ${s.border}`,
      borderRadius: 8,
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      minWidth: 110,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{count}</div>
      <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.85, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function WebhookStatsStrip({ stats, loading, err, windowHours, onWindowChange }) {
  const byStatus = (stats && stats.by_status) || {};
  const total = (stats && stats.total) || 0;
  const successCount = SUCCESS_STATUSES.reduce((acc, s) => acc + (byStatus[s] || 0), 0);
  const failureBuckets = FAILURE_STATUSES
    .map((s) => ({ status: s, count: byStatus[s] || 0 }))
    .filter((b) => b.count > 0);
  const failureTotal = failureBuckets.reduce((acc, b) => acc + b.count, 0);
  const neutralCount = NEUTRAL_STATUSES.reduce((acc, s) => acc + (byStatus[s] || 0), 0);

  return (
    <div style={{
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: 12,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>📊 ملخص صحة الاستلام</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>النافذة:</label>
          <select
            value={windowHours}
            onChange={(e) => onWindowChange(parseInt(e.target.value, 10))}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, background: 'white' }}
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      {err ? (
        <div style={{ fontSize: 12, color: '#b91c1c' }}>{err}</div>
      ) : loading && !stats ? (
        <div style={{ fontSize: 12, color: '#64748b' }}>جارٍ الحساب…</div>
      ) : total === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b' }}>
          لم تصل أي webhooks في هذه النافذة الزمنية.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <StatPill kind="total" label="إجمالي" count={total} />
          <StatPill kind="success" label="نجحت (تجديد/تسجيل)" count={successCount} />
          {failureBuckets.length === 0 ? (
            <StatPill kind="failure" label="فشل" count={0} />
          ) : (
            <>
              <StatPill kind="failure" label={`فشل إجمالي`} count={failureTotal} />
              {failureBuckets.map((b) => (
                <StatPill key={b.status} kind="failure" label={statusLabel(b.status)} count={b.count} />
              ))}
            </>
          )}
          {neutralCount > 0 && (
            <StatPill kind="neutral" label="أخرى/مكررة" count={neutralCount} />
          )}
        </div>
      )}
    </div>
  );
}

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
  const [deliveryAlerts, setDeliveryAlerts] = useState([]);
  const [deliveryThreshold, setDeliveryThreshold] = useState(3);
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState('');
  const [statsWindowHours, setStatsWindowHours] = useState(24);
  const [reprocessRowId, setReprocessRowId] = useState(null);
  const [reprocessTenantSlug, setReprocessTenantSlug] = useState('');
  const [reprocessMonths, setReprocessMonths] = useState('');
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessResult, setReprocessResult] = useState(null);

  const reloadDeliveryAlerts = useCallback(async () => {
    try {
      const res = await axios.get('/super/payment/delivery-alerts', auth());
      setDeliveryAlerts(Array.isArray(res.data?.alerts) ? res.data.alerts : []);
      if (typeof res.data?.threshold === 'number') setDeliveryThreshold(res.data.threshold);
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate('/super/login', { replace: true });
      }
      // Silent on other errors — banner is a best-effort signal.
    }
  }, [navigate]);

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
      reloadDeliveryAlerts();
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

  const reloadStats = useCallback(async (
    windowHours = statsWindowHours,
    providerFilter = eventProvider,
  ) => {
    setStatsLoading(true);
    setStatsErr('');
    try {
      const params = { window_seconds: Math.max(1, parseInt(windowHours, 10) || 24) * 3600 };
      if (providerFilter && providerFilter !== 'all') params.provider = providerFilter;
      const res = await axios.get('/super/payment/events/stats', { ...auth(), params });
      setStats(res.data || null);
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate('/super/login', { replace: true });
        return;
      }
      setStatsErr(e?.response?.data?.detail || 'تعذر تحميل ملخص الأحداث');
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [statsWindowHours, eventProvider, navigate]);

  useEffect(() => { reloadStats(statsWindowHours, eventProvider); }, [reloadStats, statsWindowHours, eventProvider]);

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
  useEffect(() => { reloadDeliveryAlerts(); }, [reloadDeliveryAlerts]);

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

  const handleReprocess = async (ev) => {
    const rowId = ev.row_id;
    if (!rowId) { setEventsErr('هذا الحدث لا يملك row_id (حدث قديم لا يمكن إعادة معالجته)'); return; }
    setReprocessing(true);
    setReprocessResult(null);
    try {
      const body = {};
      if (reprocessTenantSlug.trim()) body.tenant_slug = reprocessTenantSlug.trim();
      if (reprocessMonths && parseInt(reprocessMonths, 10) > 0) body.months = parseInt(reprocessMonths, 10);
      const res = await axios.post(`/super/payment/events/${rowId}/reprocess`, body, auth());
      setReprocessResult({ ok: true, ...res.data });
      reloadEvents(eventStatus, eventProvider, eventOutcome);
      reloadStats(statsWindowHours, eventProvider);
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || 'تعذرت إعادة المعالجة';
      setReprocessResult({ ok: false, error: detail });
    } finally {
      setReprocessing(false);
    }
  };

  const openReprocess = (ev, idx) => {
    if (reprocessRowId === idx) {
      setReprocessRowId(null);
      setReprocessTenantSlug('');
      setReprocessMonths('');
      setReprocessResult(null);
    } else {
      setReprocessRowId(idx);
      setReprocessTenantSlug(ev.tenant_slug || '');
      setReprocessMonths('');
      setReprocessResult(null);
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

        {deliveryAlerts.length > 0 && (
          <div style={{ background: '#fef2f2', color: '#7f1d1d', border: '1px solid #fecaca', padding: 14, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 15 }}>
              🚨 توقّف وصول الـ webhooks
            </div>
            {deliveryAlerts.map((a, i) => (
              <div key={i} style={{ marginTop: i ? 8 : 0, lineHeight: 1.7 }}>
                المزود <b>{a.provider || '—'}</b> سجّل <b>{a.streak}</b> محاولة فاشلة متتالية
                (الحد: {a.threshold || deliveryThreshold}) منذ {fmt(a.since)}.
                <div style={{ fontSize: 13, color: '#991b1b', marginTop: 2 }}>
                  آخر حالة: <code style={{ fontFamily: 'monospace' }}>{a.last_status || '—'}</code>
                  {a.last_reason ? <> · {a.last_reason}</> : null}
                  {a.last_tenant_slug ? <> · أكاديمية: {a.last_tenant_slug}</> : null}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: '#991b1b', marginTop: 8 }}>
              سيختفي هذا التنبيه تلقائياً بمجرد تسجيل أول عملية ناجحة.
            </div>
          </div>
        )}
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
                onClick={() => { reloadEvents(eventStatus, eventProvider, eventOutcome); reloadStats(statsWindowHours, eventProvider); }}
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
          <WebhookStatsStrip
            stats={stats}
            loading={statsLoading}
            err={statsErr}
            windowHours={statsWindowHours}
            onWindowChange={setStatsWindowHours}
          />
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
                    <th style={{ padding: '8px 10px', fontWeight: 700, color: '#334155' }}>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev, i) => {
                    const c = STATUS_COLORS[ev.status] || { bg: '#f1f5f9', fg: '#475569' };
                    const oc = OUTCOME_COLORS[ev.outcome] || { bg: '#f1f5f9', fg: '#475569' };
                    const isOpen = expandedEvent === i;
                    const isReprocessOpen = reprocessRowId === i;
                    const snap = ev.payload_snapshot;
                    const hasDetails = !!(snap || ev.signature_header || ev.http_status);
                    const canReprocess = REPROCESS_ELIGIBLE_STATUSES.includes(ev.status) && !!ev.row_id;
                    let snapshotText = '';
                    if (snap) {
                      if (snap.preview) {
                        snapshotText = snap.preview;
                      } else if (snap.data !== undefined && snap.data !== null) {
                        try { snapshotText = JSON.stringify(snap.data, null, 2); }
                        catch (e) { snapshotText = String(snap.data); }
                      }
                    }
                    return (
                      <React.Fragment key={i}>
                        <tr style={{ borderTop: '1px solid #e2e8f0', cursor: hasDetails ? 'pointer' : 'default' }}
                            onClick={() => hasDetails && setExpandedEvent(isOpen ? null : i)}>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#0f172a' }}>
                            {hasDetails && (
                              <span style={{ display: 'inline-block', width: 14, color: '#64748b', marginLeft: 4 }}>
                                {isOpen ? '▾' : '▸'}
                              </span>
                            )}
                            {fmt(ev.received_at)}
                          </td>
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
                          <td style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                            {canReprocess && (
                              <button
                                onClick={() => openReprocess(ev, i)}
                                style={{
                                  padding: '4px 10px',
                                  background: isReprocessOpen ? '#e0e7ff' : '#f1f5f9',
                                  color: isReprocessOpen ? '#3730a3' : '#475569',
                                  border: `1px solid ${isReprocessOpen ? '#a5b4fc' : '#cbd5e1'}`,
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                                title="إعادة تشغيل هذا الحدث الفاشل عبر نفس مسار المعالجة"
                              >
                                ↺ إعادة معالجة
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && hasDetails && (
                          <tr style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                            <td colSpan={8} style={{ padding: '12px 16px' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 10, fontSize: 12, color: '#475569' }}>
                                <div>
                                  <span style={{ color: '#64748b' }}>كود الاستجابة HTTP: </span>
                                  <code style={{ fontFamily: 'monospace', background: '#fff', padding: '1px 6px', borderRadius: 4, color: '#0f172a' }}>
                                    {ev.http_status != null ? ev.http_status : '—'}
                                  </code>
                                </div>
                                <div>
                                  <span style={{ color: '#64748b' }}>اسم رأس التوقيع: </span>
                                  <code style={{ fontFamily: 'monospace', background: '#fff', padding: '1px 6px', borderRadius: 4, color: '#0f172a' }}>
                                    {ev.signature_header || '—'}
                                  </code>
                                  <span style={{ color: '#94a3b8', marginRight: 6 }}>(القيمة لا تُحفظ)</span>
                                </div>
                                {snap && typeof snap.size_bytes === 'number' && (
                                  <div>
                                    <span style={{ color: '#64748b' }}>حجم الحمولة: </span>
                                    <code style={{ fontFamily: 'monospace', background: '#fff', padding: '1px 6px', borderRadius: 4, color: '#0f172a' }}>
                                      {snap.size_bytes} B
                                    </code>
                                    {snap.truncated && (
                                      <span style={{ color: '#92400e', marginRight: 6, fontWeight: 600 }}>· مقتطعة</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {snap ? (
                                <pre dir="ltr" style={{
                                  background: '#0f172a',
                                  color: '#e2e8f0',
                                  padding: 12,
                                  borderRadius: 8,
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                  overflowX: 'auto',
                                  maxHeight: 360,
                                  margin: 0,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  textAlign: 'left',
                                }}>{snapshotText || '(empty)'}</pre>
                              ) : (
                                <div style={{ fontSize: 13, color: '#64748b' }}>
                                  لم يُحفظ نسخة من الحمولة لهذا الحدث (حدث قبل تفعيل التشخيص أو لم يصل أي محتوى).
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                                ملاحظة: الحقول الحساسة (أرقام البطاقات، CVV، الأسرار) محذوفة تلقائياً قبل الحفظ.
                              </div>
                            </td>
                          </tr>
                        )}
                        {isReprocessOpen && canReprocess && (
                          <tr style={{ background: '#eff6ff', borderTop: '1px solid #bfdbfe' }}>
                            <td colSpan={8} style={{ padding: '14px 16px' }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a8a', marginBottom: 10 }}>
                                ↺ إعادة معالجة الحدث
                                {ev.status === 'tenant_not_found' && (
                                  <span style={{ fontSize: 12, fontWeight: 400, color: '#3b82f6', marginRight: 8 }}>
                                    — أدخل slug الأكاديمية الصحيح ثم اضغط إعادة المعالجة
                                  </span>
                                )}
                                {ev.status === 'error' && (
                                  <span style={{ fontSize: 12, fontWeight: 400, color: '#3b82f6', marginRight: 8 }}>
                                    — سيُعاد تشغيل الحدث المخزَّن عبر نفس مسار المعالجة
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                                <div>
                                  <label style={{ display: 'block', fontSize: 12, color: '#1e3a8a', marginBottom: 4, fontWeight: 600 }}>
                                    slug الأكاديمية
                                    {ev.status === 'tenant_not_found' ? ' (مطلوب)' : ' (اختياري — لتصحيح الأكاديمية)'}
                                  </label>
                                  <input
                                    type="text"
                                    value={reprocessTenantSlug}
                                    onChange={(e) => setReprocessTenantSlug(e.target.value)}
                                    placeholder="مثال: my-academy"
                                    dir="ltr"
                                    style={{ padding: '6px 10px', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 13, width: 200, fontFamily: 'monospace' }}
                                  />
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: 12, color: '#1e3a8a', marginBottom: 4, fontWeight: 600 }}>
                                    شهور التجديد (اختياري — إذا لم تُحفظ في الحمولة)
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    max="120"
                                    value={reprocessMonths}
                                    onChange={(e) => setReprocessMonths(e.target.value)}
                                    placeholder="0"
                                    dir="ltr"
                                    style={{ padding: '6px 10px', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 13, width: 100 }}
                                  />
                                </div>
                                <button
                                  onClick={() => handleReprocess(ev)}
                                  disabled={reprocessing || (ev.status === 'tenant_not_found' && !reprocessTenantSlug.trim())}
                                  style={{
                                    padding: '6px 16px',
                                    background: '#2563eb',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 6,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: (reprocessing || (ev.status === 'tenant_not_found' && !reprocessTenantSlug.trim())) ? 'not-allowed' : 'pointer',
                                    opacity: (reprocessing || (ev.status === 'tenant_not_found' && !reprocessTenantSlug.trim())) ? 0.6 : 1,
                                  }}
                                >
                                  {reprocessing ? 'جارٍ المعالجة...' : '↺ إعادة المعالجة'}
                                </button>
                                <button
                                  onClick={() => { setReprocessRowId(null); setReprocessResult(null); }}
                                  style={{ padding: '6px 12px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                                >
                                  إلغاء
                                </button>
                              </div>
                              {reprocessResult && (
                                <div style={{
                                  marginTop: 12,
                                  padding: '10px 14px',
                                  borderRadius: 8,
                                  fontSize: 13,
                                  background: reprocessResult.ok ? '#dcfce7' : '#fef2f2',
                                  color: reprocessResult.ok ? '#166534' : '#b91c1c',
                                  border: `1px solid ${reprocessResult.ok ? '#86efac' : '#fecaca'}`,
                                }}>
                                  {reprocessResult.ok ? (
                                    <>
                                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                                        {reprocessResult.status === 'renewed' ? '✓ تم التجديد بنجاح' :
                                         reprocessResult.status === 'recorded' ? '✓ تم تسجيل فشل الدفع' :
                                         reprocessResult.status === 'duplicate' ? '⟳ الحدث مُعالَج مسبقاً' :
                                         '✓ تمت إعادة المعالجة'}
                                      </div>
                                      {reprocessResult.tenant_slug && (
                                        <div style={{ fontSize: 12 }}>الأكاديمية: <b>{reprocessResult.tenant_slug}</b></div>
                                      )}
                                      {reprocessResult.renewal_id && (
                                        <div style={{ fontSize: 12, fontFamily: 'monospace', opacity: 0.8 }}>renewal_id: {reprocessResult.renewal_id}</div>
                                      )}
                                      {reprocessResult.detail && (
                                        <div style={{ fontSize: 12, marginTop: 4 }}>{reprocessResult.detail}</div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ fontWeight: 700, marginBottom: 4 }}>✗ تعذرت إعادة المعالجة</div>
                                      <div>{reprocessResult.error}</div>
                                    </>
                                  )}
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 10, lineHeight: 1.6 }}>
                                ملاحظة: تمر إعادة المعالجة عبر نفس مسار إلغاء التكرار — لا يمكن تطبيق نفس الحدث مرتين.
                                النتيجة تُسجَّل كحدث جديد مرتبط بالأصل.
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
