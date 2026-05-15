import React, { useCallback, useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { useLanguage } from '../contexts/LanguageContext';
import { notificationsSettingsAPI } from '../services/api';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCcw, Mail, MessageCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';

const STATUS_OPTIONS = ['', 'pending', 'retrying', 'delivered', 'exhausted'];

const fmtDate = (iso, isAr) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(isAr ? 'ar-SA' : undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return iso; }
};

const StatusBadge = ({ status, isAr }) => {
  const map = {
    pending:   { cls: 'bg-slate-100 text-slate-700', icon: Clock,        ar: 'قيد الانتظار', en: 'Pending' },
    retrying:  { cls: 'bg-amber-100 text-amber-800', icon: RefreshCcw,   ar: 'إعادة المحاولة', en: 'Retrying' },
    delivered: { cls: 'bg-green-100 text-green-700', icon: CheckCircle2, ar: 'تم التسليم',   en: 'Delivered' },
    exhausted: { cls: 'bg-red-100 text-red-700',     icon: XCircle,      ar: 'فشل نهائي',    en: 'Exhausted' },
  };
  const m = map[status] || map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${m.cls}`}>
      <Icon className="w-3 h-3" />
      {isAr ? m.ar : m.en}
    </span>
  );
};

const ChannelDot = ({ delivered, label }) => (
  <span
    className={`inline-flex items-center gap-1 text-xs ${delivered ? 'text-green-700' : 'text-slate-400'}`}
    title={label}
  >
    <span className={`w-2 h-2 rounded-full ${delivered ? 'bg-green-500' : 'bg-slate-300'}`} />
    {label}
  </span>
);

export default function OpsAlertsPage() {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [retryingId, setRetryingId] = useState(null);

  const t = (ar, en) => (isAr ? ar : en);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (statusFilter) params.delivery_status = statusFilter;
      const res = await notificationsSettingsAPI.listOpsAlerts(params);
      setItems(res.data?.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('تعذر تحميل التنبيهات', 'Failed to load alerts'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, isAr]);

  useEffect(() => { load(); }, [load]);

  const onRetry = async (id) => {
    setRetryingId(id);
    try {
      await notificationsSettingsAPI.retryOpsAlert(id);
      toast.success(t('تمت إعادة جدولة التنبيه', 'Alert re-queued for delivery'));
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('تعذر إعادة المحاولة', 'Retry failed'));
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Layout title={t('تنبيهات النظام', 'System alerts')}>
      <div className="p-4 space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              {t('تنبيهات النظام', 'System alerts')}
            </h1>
            <p className="text-sm text-slate-500">
              {t(
                'حالة تسليم تنبيهات الأعطال عبر البريد والواتساب — يمكنك إعادة محاولة التنبيهات الفاشلة.',
                "Delivery status of ops alerts over email & WhatsApp — re-queue failed ones manually.",
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-white"
              data-testid="ops-alerts-status-filter"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s === '' ? t('كل الحالات', 'All statuses')
                    : s === 'pending' ? t('قيد الانتظار', 'Pending')
                    : s === 'retrying' ? t('إعادة المحاولة', 'Retrying')
                    : s === 'delivered' ? t('تم التسليم', 'Delivered')
                    : t('فشل نهائي', 'Exhausted')}
                </option>
              ))}
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1"
              data-testid="ops-alerts-refresh"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              {t('تحديث', 'Refresh')}
            </button>
          </div>
        </div>

        <div className="bg-white rounded shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start">{t('الوقت', 'Created')}</th>
                <th className="px-3 py-2 text-start">{t('النوع', 'Kind')}</th>
                <th className="px-3 py-2 text-start">{t('العنوان', 'Title')}</th>
                <th className="px-3 py-2 text-start">{t('الحالة', 'Status')}</th>
                <th className="px-3 py-2 text-start">{t('القنوات', 'Channels')}</th>
                <th className="px-3 py-2 text-start">{t('المحاولات', 'Attempts')}</th>
                <th className="px-3 py-2 text-start">{t('آخر خطأ', 'Last error')}</th>
                <th className="px-3 py-2 text-start">{t('إجراء', 'Action')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-6 text-slate-400">{t('جارٍ التحميل…', 'Loading…')}</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="text-center py-6 text-slate-400">{t('لا توجد تنبيهات', 'No alerts')}</td></tr>
              )}
              {!loading && items.map((row) => (
                <tr key={row.id} className="border-t align-top" data-testid={`ops-alert-row-${row.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">
                    {fmtDate(row.created_at, isAr)}
                    {row.last_attempt_at && (
                      <div className="text-[11px] text-slate-400">
                        {t('آخر محاولة:', 'Last try:')} {fmtDate(row.last_attempt_at, isAr)}
                      </div>
                    )}
                    {row.next_attempt_at && row.delivery_status === 'retrying' && (
                      <div className="text-[11px] text-amber-600">
                        {t('المحاولة التالية:', 'Next try:')} {fmtDate(row.next_attempt_at, isAr)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">{row.kind || '—'}</code>
                    {row.severity && (
                      <div className="text-[11px] text-slate-500 mt-0.5">{row.severity}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-xs">
                    <div className="font-medium truncate">{row.title || '—'}</div>
                    {row.body && (
                      <div className="text-xs text-slate-500 line-clamp-2" title={row.body}>{row.body}</div>
                    )}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={row.delivery_status} isAr={isAr} /></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <ChannelDot delivered={!!row.delivered_email} label={<><Mail className="inline w-3 h-3 me-1" />{t('بريد', 'Email')}</>} />
                      <ChannelDot delivered={!!row.delivered_whatsapp} label={<><MessageCircle className="inline w-3 h-3 me-1" />{t('واتساب', 'WhatsApp')}</>} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">{row.attempts ?? 0}</td>
                  <td className="px-3 py-2 max-w-xs">
                    {row.last_error ? (
                      <code className="text-[11px] text-red-700 break-all" title={row.last_error}>
                        {row.last_error}
                      </code>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onRetry(row.id)}
                      disabled={retryingId === row.id}
                      className="px-2.5 py-1 rounded bg-orange-600 text-white text-xs hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-1"
                      data-testid={`ops-alert-retry-${row.id}`}
                    >
                      <RefreshCcw className={`w-3 h-3 ${retryingId === row.id ? 'animate-spin' : ''}`} />
                      {t('إعادة المحاولة', 'Retry')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
