import React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { tenantAPI, notificationsSettingsAPI, billingAPI, tenantDataAPI } from '../services/api';
import {
  Languages,
  Moon,
  Sun,
  Trophy,
  Info,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  CreditCard,
  Mail,
  FileText,
  XCircle,
  Repeat,
  ArrowUpCircle,
  Download,
  ShieldAlert,
} from 'lucide-react';

export const SettingsPage = () => {
  const { t, language, toggleLanguage } = useLanguage();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [resetting, setResetting] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(() => {
    return document.documentElement.classList.contains('dark');
  });
  const [dailyChecksHour, setDailyChecksHour] = React.useState(7);
  const [dailyChecksMinute, setDailyChecksMinute] = React.useState(0);
  const [dailyChecksDefault, setDailyChecksDefault] = React.useState(7);
  const [dailyChecksDefaultMinute, setDailyChecksDefaultMinute] = React.useState(0);
  const [dailyChecksLoading, setDailyChecksLoading] = React.useState(false);
  const [dailyChecksSaving, setDailyChecksSaving] = React.useState(false);
  const [dailyChecksStatus, setDailyChecksStatus] = React.useState(null);
  const [dailyChecksRunning, setDailyChecksRunning] = React.useState(false);
  const [opsAlertsEmailEnabled, setOpsAlertsEmailEnabled] = React.useState(true);
  const [opsAlertsWhatsappEnabled, setOpsAlertsWhatsappEnabled] = React.useState(true);
  const [opsAlertsEmailConfigured, setOpsAlertsEmailConfigured] = React.useState(true);
  const [opsAlertsWhatsappConfigured, setOpsAlertsWhatsappConfigured] = React.useState(true);
  const [opsAlertsLoading, setOpsAlertsLoading] = React.useState(false);
  const [opsAlertsSaving, setOpsAlertsSaving] = React.useState(false);
  const [opsAlertsTestSending, setOpsAlertsTestSending] = React.useState(false);
  const [opsAlertsTestResult, setOpsAlertsTestResult] = React.useState(null);
  const [billing, setBilling] = React.useState(null);
  const [billingLoading, setBillingLoading] = React.useState(false);
  const [invoices, setInvoices] = React.useState([]);
  const [invoicesLoading, setInvoicesLoading] = React.useState(false);
  const [contactEditing, setContactEditing] = React.useState(false);
  const [contactSaving, setContactSaving] = React.useState(false);
  const [contactOwner, setContactOwner] = React.useState('');
  const [contactBilling, setContactBilling] = React.useState('');
  const [emailLog, setEmailLog] = React.useState([]);
  const [emailLogLoading, setEmailLogLoading] = React.useState(false);
  const [testEmailSending, setTestEmailSending] = React.useState(false);
  const [emailLogStatus, setEmailLogStatus] = React.useState('');
  const [emailLogKind, setEmailLogKind] = React.useState('');
  const [emailLogSearch, setEmailLogSearch] = React.useState('');
  const [emailLogSearchInput, setEmailLogSearchInput] = React.useState('');
  const [emailLogLimit, setEmailLogLimit] = React.useState(20);
  const ALL_DAYS = React.useMemo(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], []);
  const [dailyChecksDays, setDailyChecksDays] = React.useState(ALL_DAYS);
  const DAY_LABELS = React.useMemo(() => ({
    en: { Sun: 'Sun', Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat' },
    ar: { Sun: 'الأحد', Mon: 'الإثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة', Sat: 'السبت' },
  }), []);

  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setBillingLoading(true);
    setInvoicesLoading(true);
    billingAPI.get()
      .then((res) => {
        if (cancelled) return;
        setBilling(res.data || null);
        setContactOwner(res.data?.owner_email || '');
        setContactBilling(res.data?.billing_email || '');
      })
      .catch(() => { if (!cancelled) setBilling(null); })
      .finally(() => { if (!cancelled) setBillingLoading(false); });
    billingAPI.invoices()
      .then((res) => { if (!cancelled) setInvoices(res.data?.items || []); })
      .catch(() => { if (!cancelled) setInvoices([]); })
      .finally(() => { if (!cancelled) setInvoicesLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  const reloadEmailLog = React.useCallback(async () => {
    setEmailLogLoading(true);
    try {
      const params = {};
      if (emailLogStatus) params.status = emailLogStatus;
      if (emailLogKind) params.kind = emailLogKind;
      if (emailLogSearch) params.q = emailLogSearch;
      if (emailLogLimit && emailLogLimit !== 20) params.limit = emailLogLimit;
      const res = await billingAPI.emailLog(params);
      setEmailLog(res.data?.items || []);
    } catch {
      // keep previous list
    } finally {
      setEmailLogLoading(false);
    }
  }, [emailLogStatus, emailLogKind, emailLogSearch, emailLogLimit]);

  React.useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    setEmailLogLoading(true);
    const params = {};
    if (emailLogStatus) params.status = emailLogStatus;
    if (emailLogKind) params.kind = emailLogKind;
    if (emailLogSearch) params.q = emailLogSearch;
    if (emailLogLimit && emailLogLimit !== 20) params.limit = emailLogLimit;
    billingAPI.emailLog(params)
      .then((res) => { if (!cancelled) setEmailLog(res.data?.items || []); })
      .catch(() => { if (!cancelled) setEmailLog([]); })
      .finally(() => { if (!cancelled) setEmailLogLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, emailLogStatus, emailLogKind, emailLogSearch, emailLogLimit]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setEmailLogSearch(emailLogSearchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [emailLogSearchInput]);

  const handleSendTestWelcome = async () => {
    setTestEmailSending(true);
    try {
      const res = await billingAPI.sendTestWelcome();
      const status = res?.data?.result?.status;
      const to = res?.data?.to || '';
      if (status === 'sent') {
        toast.success(language === 'ar'
          ? `تم إرسال الإيميل التجريبي إلى ${to}`
          : `Test email sent to ${to}`);
      } else if (status === 'skipped') {
        const reason = res?.data?.result?.error || '';
        toast.info(language === 'ar'
          ? `لم يتم الإرسال${reason ? ': ' + reason : ''}`
          : `Not sent${reason ? ': ' + reason : ''}`);
      } else {
        toast.error(language === 'ar'
          ? `فشل الإرسال: ${res?.data?.result?.error || ''}`
          : `Send failed: ${res?.data?.result?.error || ''}`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar'
        ? 'تعذر إرسال الإيميل التجريبي'
        : 'Failed to send test email'));
    } finally {
      setTestEmailSending(false);
      reloadEmailLog();
    }
  };

  const formatEmailLogTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB', {
        dateStyle: 'short', timeStyle: 'short',
      });
    } catch { return iso; }
  };

  const EMAIL_KIND_LABELS = {
    welcome: { ar: 'ترحيب', en: 'Welcome' },
    trial_ending: { ar: 'انتهاء التجربة', en: 'Trial ending' },
    payment_success: { ar: 'دفعة ناجحة', en: 'Payment success' },
    payment_failed: { ar: 'فشل الدفع', en: 'Payment failed' },
    suspended: { ar: 'تعليق', en: 'Suspended' },
    cancelled: { ar: 'إلغاء', en: 'Cancelled' },
    email_confirmation: { ar: 'تأكيد البريد', en: 'Email confirmation' },
  };
  const labelForKind = (kind) => {
    const entry = EMAIL_KIND_LABELS[kind];
    if (!entry) return kind || '—';
    return language === 'ar' ? entry.ar : entry.en;
  };
  const renderEmailStatusBadge = (status) => {
    const map = {
      sent: { ar: 'تم الإرسال', en: 'Sent', cls: 'bg-green-100 text-green-700' },
      failed: { ar: 'فشل', en: 'Failed', cls: 'bg-red-100 text-red-700' },
      skipped: { ar: 'متجاهَل', en: 'Skipped', cls: 'bg-slate-100 text-slate-700' },
    };
    const entry = map[status] || { ar: status || '—', en: status || '—', cls: 'bg-slate-100 text-slate-700' };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${entry.cls}`}>
        {language === 'ar' ? entry.ar : entry.en}
      </span>
    );
  };

  const buildMailto = (subjectAr, subjectEn, bodyAr, bodyEn) => {
    const subject = encodeURIComponent(language === 'ar' ? subjectAr : subjectEn);
    const slug = billing?.slug || '';
    const planLabel = language === 'ar' ? (billing?.plan_name_ar || billing?.plan) : (billing?.plan_name_en || billing?.plan);
    const sigAr = `\n\n---\nالأكاديمية: ${slug}\nالخطة الحالية: ${planLabel || '—'}`;
    const sigEn = `\n\n---\nAcademy: ${slug}\nCurrent plan: ${planLabel || '—'}`;
    const body = encodeURIComponent((language === 'ar' ? bodyAr : bodyEn) + (language === 'ar' ? sigAr : sigEn));
    return `mailto:billing@championsacademy.app?subject=${subject}&body=${body}`;
  };

  const formatInvoiceDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' });
    } catch { return iso; }
  };

  const printInvoice = (inv) => {
    const isAr = language === 'ar';
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    const planName = isAr ? inv.plan_name_ar : inv.plan_name_en;
    const cycle = inv.cycle === 'yearly' ? (isAr ? 'سنوي' : 'Yearly') : (isAr ? 'شهري' : 'Monthly');
    const status = inv.status === 'paid' ? (isAr ? 'مدفوعة' : 'Paid') : inv.status;
    const html = `<!doctype html><html dir="${isAr ? 'rtl' : 'ltr'}" lang="${isAr ? 'ar' : 'en'}"><head><meta charset="utf-8"><title>${isAr ? 'فاتورة' : 'Invoice'} ${inv.id}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif;padding:40px;color:#0f172a}h1{margin:0 0 6px}h2{margin:24px 0 8px;font-size:18px;border-bottom:2px solid #f1f5f9;padding-bottom:6px}table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:8px 4px;border-bottom:1px solid #e2e8f0;font-size:14px}.right{text-align:${isAr ? 'left' : 'right'};font-weight:bold}.total{font-size:22px;color:#0f172a}.muted{color:#64748b;font-size:13px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.brand .logo{width:48px;height:48px;border-radius:12px;background:#f97316;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:24px}@media print{body{padding:20px}}</style></head><body>
<div class="brand"><div class="logo">★</div><div><div style="font-weight:bold">${isAr ? 'منصة الأبطال للأكاديميات' : 'Champions Academy Platform'}</div><div class="muted">${isAr ? 'إيصال اشتراك' : 'Subscription receipt'}</div></div></div>
<h1>${isAr ? 'إيصال رقم' : 'Receipt #'} ${inv.id}</h1>
<div class="muted">${isAr ? 'تاريخ الإصدار:' : 'Issued:'} ${formatInvoiceDate(inv.issued_at)}</div>
<h2>${isAr ? 'تفاصيل الأكاديمية' : 'Academy details'}</h2>
<table><tr><td class="muted">${isAr ? 'الأكاديمية' : 'Academy'}</td><td class="right">${billing?.name || billing?.slug || ''}</td></tr><tr><td class="muted">${isAr ? 'البريد الإلكتروني' : 'Email'}</td><td class="right">${billing?.owner_email || ''}</td></tr></table>
<h2>${isAr ? 'تفاصيل الاشتراك' : 'Subscription details'}</h2>
<table><tr><td class="muted">${isAr ? 'الخطة' : 'Plan'}</td><td class="right">${planName || ''}</td></tr><tr><td class="muted">${isAr ? 'الدورة' : 'Cycle'}</td><td class="right">${cycle}</td></tr>${inv.period_start ? `<tr><td class="muted">${isAr ? 'الفترة' : 'Period'}</td><td class="right">${formatInvoiceDate(inv.period_start)} → ${formatInvoiceDate(inv.period_end)}</td></tr>` : ''}<tr><td class="muted">${isAr ? 'طريقة الدفع' : 'Method'}</td><td class="right">${inv.method}</td></tr><tr><td class="muted">${isAr ? 'الحالة' : 'Status'}</td><td class="right">${status}</td></tr></table>
<h2>${isAr ? 'الإجمالي' : 'Total'}</h2>
<table><tr><td class="muted">${isAr ? 'المبلغ' : 'Amount'}</td><td class="right total">${inv.amount != null ? `${inv.amount} ${isAr ? 'ر.س' : 'SAR'}` : '—'}</td></tr></table>
<p class="muted" style="margin-top:32px">${isAr ? 'هذا إيصال إلكتروني للاشتراك في خدمات منصة الأبطال للأكاديميات.' : 'This is an electronic receipt for subscription to the Champions Academy Platform services.'}</p>
<script>window.onload=()=>{setTimeout(()=>window.print(),300)};</script>
</body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const fetchDailyChecksStatus = React.useCallback(async () => {
    try {
      const res = await notificationsSettingsAPI.getDailyChecksStatus();
      setDailyChecksStatus(res.data || null);
    } catch {
      setDailyChecksStatus(null);
    }
  }, []);

  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setDailyChecksLoading(true);
    notificationsSettingsAPI.getDailyChecks()
      .then((res) => {
        if (cancelled) return;
        const data = res.data || {};
        if (typeof data.hour === 'number') setDailyChecksHour(data.hour);
        if (typeof data.minute === 'number') setDailyChecksMinute(data.minute);
        if (typeof data.default_hour === 'number') setDailyChecksDefault(data.default_hour);
        if (typeof data.default_minute === 'number') setDailyChecksDefaultMinute(data.default_minute);
        if (Array.isArray(data.days_of_week) && data.days_of_week.length > 0) {
          setDailyChecksDays(data.days_of_week);
        }
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => { if (!cancelled) setDailyChecksLoading(false); });
    fetchDailyChecksStatus();
    setOpsAlertsLoading(true);
    notificationsSettingsAPI.getOpsAlertsSettings()
      .then((res) => {
        if (cancelled) return;
        const data = res.data || {};
        if (typeof data.email_enabled === 'boolean') setOpsAlertsEmailEnabled(data.email_enabled);
        if (typeof data.whatsapp_enabled === 'boolean') setOpsAlertsWhatsappEnabled(data.whatsapp_enabled);
        if (typeof data.email_destination_configured === 'boolean') setOpsAlertsEmailConfigured(data.email_destination_configured);
        if (typeof data.whatsapp_destination_configured === 'boolean') setOpsAlertsWhatsappConfigured(data.whatsapp_destination_configured);
      })
      .catch(() => { /* keep defaults (both ON) */ })
      .finally(() => { if (!cancelled) setOpsAlertsLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, fetchDailyChecksStatus]);

  const opsAlertsSaveSeq = React.useRef(0);
  const handleSaveOpsAlertsSetting = async (field, value) => {
    const mySeq = ++opsAlertsSaveSeq.current;
    const prevEmail = opsAlertsEmailEnabled;
    const prevWhatsapp = opsAlertsWhatsappEnabled;
    if (field === 'email_enabled') setOpsAlertsEmailEnabled(value);
    if (field === 'whatsapp_enabled') setOpsAlertsWhatsappEnabled(value);
    setOpsAlertsSaving(true);
    try {
      const res = await notificationsSettingsAPI.updateOpsAlertsSettings({ [field]: value });
      if (mySeq !== opsAlertsSaveSeq.current) return;
      const data = res?.data || {};
      if (typeof data.email_enabled === 'boolean') setOpsAlertsEmailEnabled(data.email_enabled);
      if (typeof data.whatsapp_enabled === 'boolean') setOpsAlertsWhatsappEnabled(data.whatsapp_enabled);
      toast.success(language === 'ar' ? 'تم حفظ إعدادات قنوات التنبيهات' : 'Alert channels saved');
    } catch (e) {
      if (mySeq !== opsAlertsSaveSeq.current) return;
      setOpsAlertsEmailEnabled(prevEmail);
      setOpsAlertsWhatsappEnabled(prevWhatsapp);
      toast.error(e?.response?.data?.detail || (language === 'ar'
        ? 'تعذر حفظ الإعداد'
        : 'Failed to save setting'));
    } finally {
      if (mySeq === opsAlertsSaveSeq.current) setOpsAlertsSaving(false);
    }
  };

  const handleSendTestOpsAlert = async () => {
    setOpsAlertsTestSending(true);
    setOpsAlertsTestResult(null);
    try {
      const res = await notificationsSettingsAPI.sendTestOpsAlert();
      const data = res?.data || {};
      setOpsAlertsTestResult(data);
      const channels = data.channels || {};
      const attempted = [];
      if (channels.email?.will_attempt) attempted.push(language === 'ar' ? 'البريد' : 'Email');
      if (channels.whatsapp?.will_attempt) attempted.push(language === 'ar' ? 'واتساب' : 'WhatsApp');
      if (attempted.length > 0) {
        toast.success(language === 'ar'
          ? `تم إرسال تنبيه تجريبي عبر: ${attempted.join('، ')}`
          : `Test alert queued via: ${attempted.join(', ')}`);
      } else {
        toast.info(language === 'ar'
          ? 'تم تسجيل التنبيه التجريبي، لكن لا توجد قناة مفعّلة ومهيّأة لإرساله.'
          : 'Test alert recorded, but no channel is enabled and configured to deliver it.');
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar'
        ? 'تعذر إرسال التنبيه التجريبي'
        : 'Failed to send test alert'));
    } finally {
      setOpsAlertsTestSending(false);
    }
  };

  const handleRunDailyChecksNow = async () => {
    setDailyChecksRunning(true);
    try {
      const res = await notificationsSettingsAPI.runDailyChecksNow();
      const data = res?.data || {};
      const renewals = data.renewals_created ?? 0;
      const ads = data.ads_flagged ?? 0;
      if (data.success) {
        toast.success(language === 'ar'
          ? `اكتمل الفحص: ${renewals} تجديد، ${ads} إعلان`
          : `Run finished: ${renewals} renewal(s), ${ads} ad(s)`);
      } else {
        toast.error(language === 'ar'
          ? `اكتمل الفحص مع وجود أخطاء (${(data.errors || []).length})`
          : `Run finished with errors (${(data.errors || []).length})`);
      }
      await fetchDailyChecksStatus();
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar'
        ? 'تعذر تشغيل الفحص'
        : 'Failed to run checks'));
    } finally {
      setDailyChecksRunning(false);
    }
  };

  const formatLastRun = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString(language === 'ar' ? 'ar-SA' : undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  const dailyChecksSaveSeq = React.useRef(0);
  const handleSaveDailyChecksSettings = async (nextHour, nextMinute, nextDays) => {
    const mySeq = ++dailyChecksSaveSeq.current;
    setDailyChecksSaving(true);
    try {
      const daysArg = nextDays === undefined ? dailyChecksDays : nextDays;
      const res = await notificationsSettingsAPI.updateDailyChecks(nextHour, nextMinute, daysArg);
      // Drop stale responses from rapid toggles so an older request can't
      // overwrite the latest selection the user just made.
      if (mySeq !== dailyChecksSaveSeq.current) return;
      if (typeof res?.data?.hour === 'number') setDailyChecksHour(res.data.hour);
      if (typeof res?.data?.minute === 'number') setDailyChecksMinute(res.data.minute);
      if (Array.isArray(res?.data?.days_of_week) && res.data.days_of_week.length > 0) {
        setDailyChecksDays(res.data.days_of_week);
      }
      toast.success(language === 'ar'
        ? 'تم حفظ إعدادات التنبيهات اليومية'
        : 'Daily alerts settings saved');
    } catch (e) {
      if (mySeq !== dailyChecksSaveSeq.current) return;
      toast.error(e?.response?.data?.detail || (language === 'ar'
        ? 'تعذر حفظ الإعداد'
        : 'Failed to save setting'));
    } finally {
      if (mySeq === dailyChecksSaveSeq.current) setDailyChecksSaving(false);
    }
  };

  const handleSaveDailyChecksTime = (nextHour, nextMinute) =>
    handleSaveDailyChecksSettings(nextHour, nextMinute, undefined);

  const toggleDailyChecksDay = (day) => {
    const isOn = dailyChecksDays.includes(day);
    const next = isOn
      ? dailyChecksDays.filter((d) => d !== day)
      : ALL_DAYS.filter((d) => dailyChecksDays.includes(d) || d === day);
    if (next.length === 0) {
      toast.error(language === 'ar'
        ? 'يجب اختيار يوم واحد على الأقل'
        : 'At least one day must be selected');
      return;
    }
    setDailyChecksDays(next);
    handleSaveDailyChecksSettings(dailyChecksHour, dailyChecksMinute, next);
  };


  const formatTime = (h, m = 0) => {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const handleRestartOnboarding = async () => {
    const ok = window.confirm(language === 'ar'
      ? 'هل تريد تشغيل معالج الإعداد مرة أخرى؟'
      : 'Run the setup wizard again?');
    if (!ok) return;
    setResetting(true);
    try {
      await tenantAPI.resetOnboarding();
      navigate('/admin/onboarding');
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar' ? 'تعذر تشغيل المعالج' : 'Failed to start wizard'));
    } finally {
      setResetting(false);
    }
  };

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark');
    setDarkMode(!darkMode);
    localStorage.setItem('theme', !darkMode ? 'dark' : 'light');
  };

  React.useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      setDarkMode(true);
    }
  }, []);

  const PendingEmailRow = ({ language, role, email, expiresAt, onResent, onCancelled }) => {
    const [busy, setBusy] = React.useState(false);
    const [cancelBusy, setCancelBusy] = React.useState(false);
    const expiresTxt = expiresAt
      ? new Date(expiresAt).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB')
      : '';
    const expired = (() => {
      if (!expiresAt) return false;
      const t = Date.parse(expiresAt);
      return Number.isFinite(t) && t < Date.now();
    })();
    const containerCls = expired
      ? 'flex flex-wrap items-center gap-2 text-xs bg-red-50 border border-red-200 text-red-900 rounded px-2 py-1'
      : 'flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded px-2 py-1';
    const onResend = async () => {
      setBusy(true);
      try {
        const res = await billingAPI.resendConfirmation(role);
        toast.success(language === 'ar'
          ? 'أُعيد إرسال رابط التأكيد.'
          : 'Confirmation link re-sent.');
        if (onResent) onResent(res?.data || {});
      } catch (e) {
        toast.error(e?.response?.data?.detail || (language === 'ar' ? 'تعذر إعادة الإرسال' : 'Failed to resend'));
      } finally {
        setBusy(false);
      }
    };
    const onCancel = async () => {
      const confirmMsg = language === 'ar'
        ? 'هل تريد إلغاء طلب تأكيد البريد الجديد؟ سيبقى البريد الحالي كما هو.'
        : 'Cancel the pending email confirmation? The current email will remain in place.';
      if (typeof window !== 'undefined' && window.confirm && !window.confirm(confirmMsg)) return;
      setCancelBusy(true);
      try {
        await billingAPI.cancelPendingEmail(role);
        toast.success(language === 'ar'
          ? 'تم إلغاء طلب تأكيد البريد.'
          : 'Pending email confirmation cancelled.');
        if (onCancelled) onCancelled();
      } catch (e) {
        toast.error(e?.response?.data?.detail || (language === 'ar' ? 'تعذر إلغاء الطلب' : 'Failed to cancel request'));
      } finally {
        setCancelBusy(false);
      }
    };
    return (
      <div
        className={containerCls}
        data-testid={`billing-pending-${role}-email`}
      >
        <Clock className="w-3 h-3" />
        <span>
          {expired
            ? (language === 'ar' ? 'طلب تأكيد منتهي - أعد المحاولة:' : 'Confirmation expired – please retry:')
            : (language === 'ar' ? 'قيد التأكيد:' : 'Pending confirmation:')}{' '}
          <span className="font-medium">{email}</span>
        </span>
        {expiresTxt && (
          <span className="text-[11px] opacity-80">
            {expired
              ? (language === 'ar' ? `انتهى في ${expiresTxt}` : `expired ${expiresTxt}`)
              : (language === 'ar' ? `صالح حتى ${expiresTxt}` : `expires ${expiresTxt}`)}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px] ms-auto"
          onClick={onResend}
          disabled={busy || cancelBusy}
          data-testid={`billing-pending-${role}-resend-btn`}
        >
          {busy
            ? (language === 'ar' ? 'جارٍ الإرسال...' : 'Sending...')
            : (language === 'ar' ? 'إعادة إرسال التأكيد' : 'Resend confirmation')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px] border-red-300 text-red-700 hover:bg-red-100"
          onClick={onCancel}
          disabled={busy || cancelBusy}
          data-testid={`billing-pending-${role}-cancel-btn`}
        >
          {cancelBusy
            ? (language === 'ar' ? 'جارٍ الإلغاء...' : 'Cancelling...')
            : (language === 'ar' ? 'إلغاء طلب التأكيد' : 'Cancel confirmation')}
        </Button>
      </div>
    );
  };

  const handleSaveBillingContact = async () => {
    const owner = (contactOwner || '').trim();
    if (!owner || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) {
      toast.error(language === 'ar' ? 'بريد المالك غير صالح' : 'Invalid owner email');
      return;
    }
    const bill = (contactBilling || '').trim();
    if (bill && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bill)) {
      toast.error(language === 'ar' ? 'بريد الفوترة غير صالح' : 'Invalid billing email');
      return;
    }
    setContactSaving(true);
    try {
      const res = await billingAPI.updateContact({ owner_email: owner, billing_email: bill });
      const data = res?.data || {};
      setBilling((prev) => prev ? {
        ...prev,
        owner_email: data.owner_email || '',
        billing_email: data.billing_email || '',
        pending_owner_email: data.pending_owner_email || '',
        pending_owner_email_expires_at: data.pending_owner_email_expires_at || '',
        pending_billing_email: data.pending_billing_email || '',
        pending_billing_email_expires_at: data.pending_billing_email_expires_at || '',
      } : prev);
      setContactOwner(data.owner_email || '');
      setContactBilling(data.billing_email || '');
      setContactEditing(false);
      if (data.owner_email_changed || (data.billing_email_changed && data.pending_billing_email)) {
        toast.success(language === 'ar'
          ? 'أُرسلت رسالة تأكيد إلى العنوان الجديد. لن يصبح فعّالاً قبل النقر على الرابط.'
          : 'A confirmation email was sent to the new address. It will not take effect until you click the link.');
      } else {
        toast.success(language === 'ar' ? 'تم حفظ بيانات الاتصال' : 'Contact details saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar' ? 'تعذر حفظ البريد' : 'Failed to save email'));
    } finally {
      setContactSaving(false);
    }
  };

  const onDownloadTenantData = () => {
    const msg = language === 'ar'
      ? 'سيتم تنزيل نسخة كاملة من بيانات أكاديميتك بصيغة ZIP. قد يستغرق ذلك بعض الوقت. هل تريد المتابعة؟'
      : 'A full ZIP archive of your academy data will be downloaded. This may take a moment. Continue?';
    if (!window.confirm(msg)) return;
    window.open(tenantDataAPI.exportUrl(), '_blank');
  };

  return (
    <Layout title={t('settings')}>
      <div className="space-y-6 max-w-2xl" data-testid="settings-page">
        {isAdmin && (
          <Card data-testid="tenant-data-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="w-5 h-5 text-primary" />
                {language === 'ar' ? 'بياناتي (تصدير وحذف)' : 'My data (export & delete)'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {language === 'ar'
                  ? 'يمكنك تنزيل نسخة كاملة من جميع بيانات أكاديميتك في أي وقت. للحذف الدائم، يجب التواصل مع فريق الدعم — سيتم تنفيذ الحذف بعد فترة سماح 7 أيام.'
                  : 'You may download a full archive of your academy data at any time. To permanently delete your academy, contact support — deletion is finalized after a 7-day grace period.'}
              </p>
              <Button onClick={onDownloadTenantData} data-testid="tenant-data-export-btn">
                <Download className="w-4 h-4 me-2" />
                {language === 'ar' ? 'تنزيل بيانات الأكاديمية (ZIP)' : 'Download my data (ZIP)'}
              </Button>
              <div className="pt-3 border-t">
                <a href={buildMailto(
                  'طلب حذف الأكاديمية نهائياً', 'Request permanent academy deletion',
                  'مرحباً، أرغب في حذف أكاديميتي وجميع بياناتها نهائياً. أرجو تأكيد فترة السماح (7 أيام) ومتطلبات التحقق.',
                  'Hi, I would like to permanently delete my academy and all its data. Please confirm the 7-day grace period and verification requirements.'
                )}>
                  <Button variant="outline" className="w-full text-red-700 border-red-200 hover:bg-red-50" data-testid="tenant-delete-request-btn">
                    <ShieldAlert className="w-4 h-4 me-2" />
                    {language === 'ar' ? 'طلب حذف الأكاديمية نهائياً' : 'Request permanent deletion'}
                  </Button>
                </a>
                <p className="text-xs text-muted-foreground mt-2">
                  {language === 'ar'
                    ? 'يتم تنفيذ الحذف يدوياً بواسطة فريقنا بعد التحقق وفترة سماح 7 أيام يمكنك إلغاؤها خلالها.'
                    : 'Deletion is processed manually by our team after verification and a 7-day grace period during which you can cancel.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {isAdmin && (
          <Card data-testid="billing-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                {language === 'ar' ? 'الاشتراك والفوترة' : 'Subscription & Billing'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {billingLoading ? (
                <p className="text-sm text-muted-foreground">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
              ) : !billing ? (
                <p className="text-sm text-muted-foreground">{language === 'ar' ? 'لا تتوفر معلومات الاشتراك.' : 'No billing info available.'}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{language === 'ar' ? 'الخطة الحالية' : 'Current plan'}</p>
                      <p className="font-bold text-lg">{language === 'ar' ? (billing.plan_name_ar || billing.plan) : (billing.plan_name_en || billing.plan)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{language === 'ar' ? 'الحالة' : 'Status'}</p>
                      <p className="font-bold text-lg">
                        {billing.is_trial && (language === 'ar' ? 'تجربة مجانية' : 'Free trial')}
                        {!billing.is_trial && billing.status === 'active' && (language === 'ar' ? 'نشط' : 'Active')}
                        {billing.status === 'expired' && (language === 'ar' ? 'منتهي' : 'Expired')}
                        {billing.status === 'suspended' && (language === 'ar' ? 'معلّق' : 'Suspended')}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{language === 'ar' ? 'الأيام المتبقية' : 'Days remaining'}</p>
                      <p className={`font-bold text-lg ${billing.days_remaining <= 7 ? 'text-red-600' : ''}`}>
                        {billing.days_remaining != null ? billing.days_remaining : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{language === 'ar' ? 'تاريخ الانتهاء' : 'End date'}</p>
                      <p className="font-medium">{billing.end_at ? new Date(billing.end_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-GB') : '—'}</p>
                    </div>
                  </div>
                  <div className="pt-3 border-t" data-testid="billing-contact-section">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold flex items-center gap-2">
                        <Mail className="w-4 h-4 text-primary" />
                        {language === 'ar' ? 'بريد الإشعارات' : 'Notification email'}
                      </h4>
                      {!contactEditing && (
                        <Button size="sm" variant="outline" onClick={() => setContactEditing(true)} data-testid="billing-contact-edit-btn">
                          {language === 'ar' ? 'تعديل' : 'Edit'}
                        </Button>
                      )}
                    </div>
                    {!contactEditing ? (
                      <div className="space-y-1 text-sm">
                        <div className="flex flex-wrap gap-x-2">
                          <span className="text-muted-foreground">{language === 'ar' ? 'بريد المالك:' : 'Owner email:'}</span>
                          <span className="font-medium" data-testid="billing-owner-email">{billing.owner_email || '—'}</span>
                        </div>
                        {billing.pending_owner_email && (
                          <PendingEmailRow
                            language={language}
                            role="owner"
                            email={billing.pending_owner_email}
                            expiresAt={billing.pending_owner_email_expires_at}
                            onResent={(data) => setBilling((prev) => prev ? {
                              ...prev,
                              pending_owner_email_expires_at: data?.expires_at || prev.pending_owner_email_expires_at,
                            } : prev)}
                            onCancelled={() => setBilling((prev) => prev ? {
                              ...prev,
                              pending_owner_email: '',
                              pending_owner_email_expires_at: '',
                            } : prev)}
                          />
                        )}
                        <div className="flex flex-wrap gap-x-2">
                          <span className="text-muted-foreground">{language === 'ar' ? 'بريد الفوترة (اختياري):' : 'Billing email (optional):'}</span>
                          <span className="font-medium" data-testid="billing-billing-email">{billing.billing_email || '—'}</span>
                        </div>
                        {billing.pending_billing_email && (
                          <PendingEmailRow
                            language={language}
                            role="billing"
                            email={billing.pending_billing_email}
                            expiresAt={billing.pending_billing_email_expires_at}
                            onResent={(data) => setBilling((prev) => prev ? {
                              ...prev,
                              pending_billing_email_expires_at: data?.expires_at || prev.pending_billing_email_expires_at,
                            } : prev)}
                            onCancelled={() => setBilling((prev) => prev ? {
                              ...prev,
                              pending_billing_email: '',
                              pending_billing_email_expires_at: '',
                            } : prev)}
                          />
                        )}
                        <p className="text-xs text-muted-foreground pt-1">
                          {language === 'ar'
                            ? 'تُرسل رسائل الترحيب والتذكير والتعليق إلى بريد المالك. تُرسل رسائل الدفع إلى بريد الفوترة إن وُجد، وإلا فإلى بريد المالك. لا يُعتمد أي بريد جديد قبل تأكيده عبر الرابط المرسل إليه.'
                            : 'Welcome, reminder, and suspension emails go to the owner address. Payment emails go to the billing address if set, otherwise the owner address. New addresses only take effect after the recipient confirms via the emailed link.'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs">{language === 'ar' ? 'بريد المالك (للإشعارات)' : 'Owner email (notifications)'}</Label>
                          <input
                            type="email"
                            className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-background"
                            value={contactOwner}
                            onChange={(e) => setContactOwner(e.target.value)}
                            placeholder="owner@academy.com"
                            data-testid="billing-owner-email-input"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">{language === 'ar' ? 'بريد الفوترة (اختياري)' : 'Billing email (optional)'}</Label>
                          <input
                            type="email"
                            className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-background"
                            value={contactBilling}
                            onChange={(e) => setContactBilling(e.target.value)}
                            placeholder="billing@academy.com"
                            data-testid="billing-billing-email-input"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {language === 'ar'
                            ? 'عند تغيير بريد المالك، سنرسل رسالة تأكيد إلى العنوان الجديد للتحقق من وصولها.'
                            : 'When the owner email changes, a confirmation email will be sent to the new address to verify reachability.'}
                        </p>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" onClick={handleSaveBillingContact} disabled={contactSaving} data-testid="billing-contact-save-btn">
                            {contactSaving ? (language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ' : 'Save')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => {
                            setContactOwner(billing.owner_email || '');
                            setContactBilling(billing.billing_email || '');
                            setContactEditing(false);
                          }} disabled={contactSaving} data-testid="billing-contact-cancel-btn">
                            {language === 'ar' ? 'إلغاء' : 'Cancel'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="pt-3 border-t" data-testid="billing-email-log-section">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold flex items-center gap-2">
                        <Mail className="w-4 h-4 text-primary" />
                        {language === 'ar' ? 'سجل آخر الإيميلات' : 'Recent emails'}
                      </h4>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={reloadEmailLog}
                          disabled={emailLogLoading}
                          data-testid="billing-email-log-refresh-btn"
                        >
                          <RefreshCw className={`w-4 h-4 me-1 ${emailLogLoading ? 'animate-spin' : ''}`} />
                          {language === 'ar' ? 'تحديث' : 'Refresh'}
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSendTestWelcome}
                          disabled={testEmailSending}
                          data-testid="billing-email-log-test-btn"
                        >
                          {testEmailSending
                            ? (language === 'ar' ? 'جارٍ الإرسال...' : 'Sending...')
                            : (language === 'ar' ? 'إرسال إيميل ترحيبي تجريبي' : 'Send test welcome email')}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="billing-email-log-filters">
                      <select
                        value={emailLogStatus}
                        onChange={(e) => setEmailLogStatus(e.target.value)}
                        className="text-sm border rounded-md px-2 py-1 bg-background"
                        data-testid="billing-email-log-status-filter"
                      >
                        <option value="">{language === 'ar' ? 'كل الحالات' : 'All statuses'}</option>
                        <option value="sent">{language === 'ar' ? 'تم الإرسال' : 'Sent'}</option>
                        <option value="failed">{language === 'ar' ? 'فشل' : 'Failed'}</option>
                        <option value="skipped">{language === 'ar' ? 'متجاهَل' : 'Skipped'}</option>
                      </select>
                      <select
                        value={emailLogKind}
                        onChange={(e) => setEmailLogKind(e.target.value)}
                        className="text-sm border rounded-md px-2 py-1 bg-background"
                        data-testid="billing-email-log-kind-filter"
                      >
                        <option value="">{language === 'ar' ? 'كل الأنواع' : 'All types'}</option>
                        {Object.keys(EMAIL_KIND_LABELS).map((k) => (
                          <option key={k} value={k}>{labelForKind(k)}</option>
                        ))}
                      </select>
                      <Input
                        type="search"
                        value={emailLogSearchInput}
                        onChange={(e) => setEmailLogSearchInput(e.target.value)}
                        placeholder={language === 'ar' ? 'بحث بالمستلم...' : 'Search by recipient...'}
                        className="h-8 text-sm w-48"
                        data-testid="billing-email-log-search-input"
                      />
                      <select
                        value={emailLogLimit}
                        onChange={(e) => setEmailLogLimit(parseInt(e.target.value, 10) || 20)}
                        className="text-sm border rounded-md px-2 py-1 bg-background"
                        data-testid="billing-email-log-limit-filter"
                      >
                        <option value={20}>{language === 'ar' ? '20 سجل' : '20 rows'}</option>
                        <option value={50}>{language === 'ar' ? '50 سجل' : '50 rows'}</option>
                        <option value={100}>{language === 'ar' ? '100 سجل' : '100 rows'}</option>
                        <option value={200}>{language === 'ar' ? '200 سجل' : '200 rows'}</option>
                      </select>
                      {(emailLogStatus || emailLogKind || emailLogSearch || emailLogSearchInput) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEmailLogStatus('');
                            setEmailLogKind('');
                            setEmailLogSearch('');
                            setEmailLogSearchInput('');
                          }}
                          data-testid="billing-email-log-clear-filters-btn"
                        >
                          {language === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}
                        </Button>
                      )}
                    </div>
                    {emailLogLoading && emailLog.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
                    ) : emailLog.length === 0 ? (
                      <p className="text-sm text-muted-foreground" data-testid="billing-email-log-empty">
                        {language === 'ar'
                          ? 'لا توجد إيميلات مسجّلة بعد. ستظهر هنا بعد أول إرسال.'
                          : 'No emails logged yet. They will appear here after the first send.'}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" data-testid="billing-email-log-table">
                          <thead>
                            <tr className="text-start text-muted-foreground border-b">
                              <th className="py-2 text-start">{language === 'ar' ? 'الوقت' : 'Time'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'النوع' : 'Type'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'إلى' : 'To'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'الموضوع' : 'Subject'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {emailLog.map((row) => (
                              <tr key={row.id || `${row.sent_at}-${row.to}`} className="border-b last:border-0 align-top" data-testid={`billing-email-log-row-${row.id || row.sent_at}`}>
                                <td className="py-2 whitespace-nowrap">{formatEmailLogTime(row.sent_at)}</td>
                                <td className="py-2">{labelForKind(row.kind)}</td>
                                <td className="py-2 break-all">{row.to || '—'}</td>
                                <td className="py-2">
                                  <div className="max-w-[24rem] truncate" title={row.subject || ''}>{row.subject || '—'}</div>
                                  {row.status === 'failed' && row.error && (
                                    <div className="text-xs text-red-600 mt-0.5 max-w-[24rem] break-words" title={row.error}>{row.error}</div>
                                  )}
                                </td>
                                <td className="py-2">{renderEmailStatusBadge(row.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground pt-2" data-testid="billing-email-log-footer">
                      {language === 'ar'
                        ? `يعرض آخر ${emailLogLimit} إيميل تم محاولة إرساله من المنصة لأكاديميتك (ترحيب، تذكير، فوترة...).`
                        : `Showing the last ${emailLogLimit} emails the platform attempted to send for your academy (welcome, reminders, billing, ...).`}
                    </p>
                  </div>
                  <div className="pt-3 border-t grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <a href={buildMailto(
                      'طلب تجديد الاشتراك', 'Renew subscription request',
                      'مرحباً، أرغب في تجديد اشتراك أكاديميتي.', 'Hi, I would like to renew my academy subscription.'
                    )}>
                      <Button className="w-full" data-testid="billing-renew-btn">
                        <Repeat className="w-4 h-4 me-2" />
                        {language === 'ar' ? 'تجديد الاشتراك' : 'Renew subscription'}
                      </Button>
                    </a>
                    <a href={buildMailto(
                      'طلب تغيير الخطة', 'Change plan request',
                      'مرحباً، أرغب في الترقية أو تغيير خطتي الحالية. يرجى تزويدي بالتفاصيل.',
                      'Hi, I would like to upgrade or change my current plan. Please send me the details.'
                    )}>
                      <Button className="w-full" variant="outline" data-testid="billing-change-plan-btn">
                        <ArrowUpCircle className="w-4 h-4 me-2" />
                        {language === 'ar' ? 'تغيير الخطة' : 'Change plan'}
                      </Button>
                    </a>
                    <a href={buildMailto(
                      'تحديث طريقة الدفع', 'Update payment method',
                      'مرحباً، أرغب في تحديث طريقة الدفع الخاصة باشتراكي.',
                      'Hi, I would like to update the payment method for my subscription.'
                    )}>
                      <Button className="w-full" variant="outline" data-testid="billing-update-card-btn">
                        <CreditCard className="w-4 h-4 me-2" />
                        {language === 'ar' ? 'تحديث طريقة الدفع' : 'Update payment method'}
                      </Button>
                    </a>
                    <a href={buildMailto(
                      'طلب إلغاء الاشتراك', 'Cancel subscription request',
                      'مرحباً، أرغب في إلغاء اشتراكي. يرجى التواصل معي لتأكيد التفاصيل.',
                      'Hi, I would like to cancel my subscription. Please contact me to confirm the details.'
                    )}>
                      <Button className="w-full" variant="outline" data-testid="billing-cancel-btn">
                        <XCircle className="w-4 h-4 me-2" />
                        {language === 'ar' ? 'إلغاء الاشتراك' : 'Cancel subscription'}
                      </Button>
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {language === 'ar'
                      ? 'الدفع الإلكتروني المباشر سيكون متاحاً قريباً. حالياً، يتم التجديد وتغيير الخطة عبر فريق الفوترة.'
                      : 'Direct online payment is coming soon. For now, renewals and plan changes go through our billing team.'}
                  </p>

                  <div className="pt-4 border-t" data-testid="billing-invoices">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        {language === 'ar' ? 'سجل الفواتير' : 'Invoice history'}
                      </h4>
                    </div>
                    {invoicesLoading ? (
                      <p className="text-sm text-muted-foreground">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}</p>
                    ) : invoices.length === 0 ? (
                      <p className="text-sm text-muted-foreground" data-testid="billing-no-invoices">
                        {language === 'ar'
                          ? 'لا توجد فواتير سابقة. ستظهر هنا بعد أول تجديد مدفوع.'
                          : 'No invoices yet. They will appear here after your first paid renewal.'}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-start text-muted-foreground border-b">
                              <th className="py-2 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'الخطة' : 'Plan'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                              <th className="py-2 text-start">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                              <th className="py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map((inv) => (
                              <tr key={inv.id} className="border-b last:border-0">
                                <td className="py-2">{formatInvoiceDate(inv.issued_at)}</td>
                                <td className="py-2">{language === 'ar' ? inv.plan_name_ar : inv.plan_name_en} <span className="text-xs text-muted-foreground">({inv.cycle === 'yearly' ? (language === 'ar' ? 'سنوي' : 'yearly') : (language === 'ar' ? 'شهري' : 'monthly')})</span></td>
                                <td className="py-2 font-semibold">{inv.amount != null ? `${inv.amount} ${language === 'ar' ? 'ر.س' : 'SAR'}` : '—'}</td>
                                <td className="py-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                                    {inv.status === 'paid' ? (language === 'ar' ? 'مدفوعة' : 'Paid') : inv.status}
                                  </span>
                                </td>
                                <td className="py-2 text-end">
                                  <Button size="sm" variant="ghost" onClick={() => printInvoice(inv)} data-testid={`billing-print-${inv.id}`}>
                                    {language === 'ar' ? 'طباعة' : 'Print'}
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Academy Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              {language === 'ar' ? 'معلومات الأكاديمية' : 'Academy Information'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center">
                <Trophy className="w-8 h-8 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-xl font-bold">{t('academy_name')}</h3>
                <p className="text-muted-foreground">Champions Performance Academy</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'العملة' : 'Currency'}
                </p>
                <p className="font-medium">{t('currency')} ({t('sar')})</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'الأنشطة' : 'Activities'}
                </p>
                <p className="font-medium">
                  {language === 'ar' 
                    ? 'السباحة، كرة القدم، الكاراتيه، الجمباز'
                    : 'Swimming, Football, Karate, Gymnastics'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Language Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="w-5 h-5 text-primary" />
              {t('language')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {language === 'ar' ? 'لغة الواجهة' : 'Interface Language'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' 
                    ? 'اختر اللغة المفضلة للواجهة'
                    : 'Select your preferred interface language'}
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={toggleLanguage}
                data-testid="toggle-language-btn"
              >
                {language === 'ar' ? 'English' : 'العربية'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Theme Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {darkMode ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-primary" />}
              {t('theme')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {language === 'ar' ? 'الوضع الداكن' : 'Dark Mode'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' 
                    ? 'تفعيل أو تعطيل الوضع الداكن'
                    : 'Enable or disable dark mode'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <Switch
                  checked={darkMode}
                  onCheckedChange={toggleDarkMode}
                  data-testid="toggle-theme-btn"
                />
                <Moon className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Daily renewal & ad-expiry alerts — admin only */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                {language === 'ar'
                  ? 'وقت التنبيهات اليومية'
                  : 'Daily Alerts Time'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {language === 'ar'
                      ? 'وقت تشغيل تنبيهات التجديد وانتهاء الإعلانات'
                      : 'When renewal & ad-expiry alerts are sent'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar'
                      ? `يتم تنفيذ الفحص بتوقيت الرياض (الافتراضي ${formatTime(dailyChecksDefault, dailyChecksDefaultMinute)} كل الأيام).`
                      : `Runs in Asia/Riyadh time (default ${formatTime(dailyChecksDefault, dailyChecksDefaultMinute)} every day).`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="daily-checks-time" className="sr-only">
                    {language === 'ar' ? 'الوقت' : 'Time'}
                  </Label>
                  <input
                    id="daily-checks-time"
                    type="time"
                    data-testid="daily-checks-time-input"
                    className="border rounded-md px-3 py-2 bg-background text-foreground"
                    value={formatTime(dailyChecksHour, dailyChecksMinute)}
                    disabled={dailyChecksLoading || dailyChecksSaving}
                    onChange={(e) => {
                      const v = e.target.value || '';
                      const [hStr, mStr] = v.split(':');
                      const nextH = parseInt(hStr, 10);
                      const nextM = parseInt(mStr, 10);
                      if (!Number.isNaN(nextH) && !Number.isNaN(nextM)
                          && nextH >= 0 && nextH <= 23
                          && nextM >= 0 && nextM <= 59) {
                        setDailyChecksHour(nextH);
                        setDailyChecksMinute(nextM);
                        handleSaveDailyChecksTime(nextH, nextM);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Days-of-week selector */}
              <div className="mt-4 pt-4 border-t" data-testid="daily-checks-days">
                <p className="font-medium">
                  {language === 'ar' ? 'أيام تشغيل التنبيهات' : 'Days the alerts run on'}
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  {language === 'ar'
                    ? 'اختر الأيام التي يجب أن تعمل بها التنبيهات (الافتراضي: كل الأيام).'
                    : 'Pick which days the checks should run (default: every day).'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {ALL_DAYS.map((day) => {
                    const selected = dailyChecksDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDailyChecksDay(day)}
                        disabled={dailyChecksLoading || dailyChecksSaving}
                        data-testid={`daily-checks-day-${day.toLowerCase()}`}
                        aria-pressed={selected}
                        className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                          selected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-foreground border-input hover:bg-accent'
                        } disabled:opacity-50`}
                      >
                        {DAY_LABELS[language === 'ar' ? 'ar' : 'en'][day]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Last-run status + Run now */}
              <div
                className="mt-4 pt-4 border-t flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                data-testid="daily-checks-status"
              >
                <div className="flex items-start gap-2">
                  {dailyChecksStatus?.has_run ? (
                    dailyChecksStatus.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    )
                  ) : (
                    <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                  )}
                  <div>
                    {dailyChecksStatus?.has_run ? (
                      <>
                        <p className="font-medium" data-testid="daily-checks-last-run">
                          {language === 'ar' ? 'آخر تشغيل: ' : 'Last run: '}
                          {formatLastRun(dailyChecksStatus.last_run_at)}
                          {dailyChecksStatus.trigger === 'manual' && (
                            <span className="ms-2 text-xs text-muted-foreground">
                              {language === 'ar' ? '(يدوي)' : '(manual)'}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {dailyChecksStatus.success ? (
                            language === 'ar'
                              ? `نجح: ${dailyChecksStatus.renewals_created ?? 0} تجديد، ${dailyChecksStatus.ads_flagged ?? 0} إعلان`
                              : `Success: ${dailyChecksStatus.renewals_created ?? 0} renewal(s), ${dailyChecksStatus.ads_flagged ?? 0} ad(s)`
                          ) : (
                            language === 'ar'
                              ? `فشل (${dailyChecksStatus.error_count ?? 0} خطأ)`
                              : `Failed (${dailyChecksStatus.error_count ?? 0} error(s))`
                          )}
                        </p>
                        {!dailyChecksStatus.success && Array.isArray(dailyChecksStatus.errors) && dailyChecksStatus.errors.length > 0 && (
                          <details className="mt-1 text-xs text-red-600 max-w-md">
                            <summary className="cursor-pointer">
                              {language === 'ar' ? 'عرض الأخطاء' : 'Show errors'}
                            </summary>
                            <ul className="list-disc ms-5 mt-1 space-y-0.5">
                              {dailyChecksStatus.errors.slice(0, 5).map((err, i) => (
                                <li key={i} className="break-words">{err}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {language === 'ar'
                          ? 'لم يتم تشغيل الفحص بعد'
                          : 'Has not run yet'}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunDailyChecksNow}
                  disabled={dailyChecksRunning}
                  data-testid="run-daily-checks-now-btn"
                >
                  <RefreshCw className={`w-4 h-4 me-2 ${dailyChecksRunning ? 'animate-spin' : ''}`} />
                  {dailyChecksRunning
                    ? (language === 'ar' ? 'جاري التشغيل...' : 'Running...')
                    : (language === 'ar' ? 'تشغيل الآن' : 'Run now')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ops alert delivery channels — admin only */}
        {isAdmin && (
          <Card data-testid="ops-alerts-channels-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-primary" />
                {language === 'ar'
                  ? 'قنوات تنبيهات التشغيل'
                  : 'Ops Alert Channels'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {language === 'ar'
                  ? 'تحكم في القنوات التي تُرسَل عبرها تنبيهات التشغيل (أعطال الفحص اليومي، فشل الإرسال، إلخ).'
                  : 'Choose which transports outbound ops alerts (daily-check failures, delivery errors, etc.) are sent over.'}
              </p>
              <div className={`flex items-center justify-between gap-3 pt-2 border-t ${opsAlertsEmailConfigured ? '' : 'opacity-60'}`}>
                <div>
                  <Label htmlFor="ops-alerts-email-toggle" className="font-medium">
                    {language === 'ar'
                      ? 'إرسال تنبيهات التشغيل بالبريد الإلكتروني'
                      : 'Send ops alerts by email'}
                  </Label>
                  <div className="mt-1">
                    {opsAlertsEmailConfigured ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700"
                        data-testid="ops-alerts-email-configured-badge"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {language === 'ar' ? 'مهيّأ' : 'Configured'}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                        data-testid="ops-alerts-email-unconfigured-badge"
                      >
                        <AlertCircle className="w-3 h-3" />
                        {language === 'ar' ? 'غير مهيّأ' : 'Not configured'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {opsAlertsEmailConfigured
                      ? (language === 'ar'
                          ? 'يتطلب ضبط متغير البيئة OPS_ALERT_EMAIL_TO حتى يصبح للمفتاح أثر.'
                          : 'Requires the OPS_ALERT_EMAIL_TO env var to be configured for the toggle to have any effect.')
                      : (language === 'ar'
                          ? 'لن يصل أي بريد حتى يضبط مسؤول الخادم متغير البيئة OPS_ALERT_EMAIL_TO.'
                          : 'No email will be sent until a server admin sets the OPS_ALERT_EMAIL_TO env var.')}
                  </p>
                </div>
                <Switch
                  id="ops-alerts-email-toggle"
                  data-testid="ops-alerts-email-toggle"
                  checked={opsAlertsEmailEnabled}
                  disabled={opsAlertsLoading || opsAlertsSaving}
                  onCheckedChange={(v) => handleSaveOpsAlertsSetting('email_enabled', !!v)}
                />
              </div>
              <div className={`flex items-center justify-between gap-3 pt-3 border-t ${opsAlertsWhatsappConfigured ? '' : 'opacity-60'}`}>
                <div>
                  <Label htmlFor="ops-alerts-whatsapp-toggle" className="font-medium">
                    {language === 'ar'
                      ? 'إرسال تنبيهات التشغيل عبر واتساب'
                      : 'Send ops alerts by WhatsApp'}
                  </Label>
                  <div className="mt-1">
                    {opsAlertsWhatsappConfigured ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700"
                        data-testid="ops-alerts-whatsapp-configured-badge"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {language === 'ar' ? 'مهيّأ' : 'Configured'}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                        data-testid="ops-alerts-whatsapp-unconfigured-badge"
                      >
                        <AlertCircle className="w-3 h-3" />
                        {language === 'ar' ? 'غير مهيّأ' : 'Not configured'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {opsAlertsWhatsappConfigured
                      ? (language === 'ar'
                          ? 'يتطلب ضبط متغير البيئة OPS_ALERT_WHATSAPP_TO حتى يصبح للمفتاح أثر.'
                          : 'Requires the OPS_ALERT_WHATSAPP_TO env var to be configured for the toggle to have any effect.')
                      : (language === 'ar'
                          ? 'لن تصل أي رسالة واتساب حتى يضبط مسؤول الخادم متغير البيئة OPS_ALERT_WHATSAPP_TO.'
                          : 'No WhatsApp message will be sent until a server admin sets the OPS_ALERT_WHATSAPP_TO env var.')}
                  </p>
                </div>
                <Switch
                  id="ops-alerts-whatsapp-toggle"
                  data-testid="ops-alerts-whatsapp-toggle"
                  checked={opsAlertsWhatsappEnabled}
                  disabled={opsAlertsLoading || opsAlertsSaving}
                  onCheckedChange={(v) => handleSaveOpsAlertsSetting('whatsapp_enabled', !!v)}
                />
              </div>
              <div className="pt-3 border-t space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium">
                      {language === 'ar' ? 'إرسال تنبيه تجريبي' : 'Send a test alert'}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {language === 'ar'
                        ? 'يُرسل تنبيهًا تجريبيًا واضحًا عبر القنوات المفعّلة والمهيّأة فقط، ويظهر في سجل تنبيهات النظام.'
                        : 'Sends a clearly-labelled test alert through the enabled & configured channels only. It will also appear in the Ops Alerts history page.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendTestOpsAlert}
                    disabled={opsAlertsLoading || opsAlertsSaving || opsAlertsTestSending}
                    data-testid="ops-alerts-send-test-btn"
                  >
                    {opsAlertsTestSending
                      ? (language === 'ar' ? 'جارٍ الإرسال...' : 'Sending...')
                      : (language === 'ar' ? 'إرسال تنبيه تجريبي' : 'Send test alert')}
                  </Button>
                </div>
                {opsAlertsTestResult && (
                  <div
                    className="text-xs rounded border bg-slate-50 p-2 space-y-1"
                    data-testid="ops-alerts-test-result"
                  >
                    {(() => {
                      const ch = opsAlertsTestResult.channels || {};
                      const renderRow = (key, label) => {
                        const c = ch[key] || {};
                        let cls, text;
                        if (c.will_attempt) {
                          cls = 'bg-green-100 text-green-700';
                          text = language === 'ar' ? 'سيُحاول الإرسال' : 'Will attempt';
                        } else if (!c.configured) {
                          cls = 'bg-amber-100 text-amber-700';
                          text = language === 'ar' ? 'تم التخطي — غير مهيّأ' : 'Skipped — not configured';
                        } else {
                          cls = 'bg-slate-200 text-slate-700';
                          text = language === 'ar' ? 'تم التخطي — مُعطَّل' : 'Skipped — disabled';
                        }
                        return (
                          <div className="flex items-center justify-between gap-2" key={key}>
                            <span>{label}</span>
                            <span className={`px-2 py-0.5 rounded-full ${cls}`}>{text}</span>
                          </div>
                        );
                      };
                      return (
                        <>
                          {renderRow('email', language === 'ar' ? 'البريد الإلكتروني' : 'Email')}
                          {renderRow('whatsapp', language === 'ar' ? 'واتساب' : 'WhatsApp')}
                          {!opsAlertsTestResult.any_channel_will_attempt && (
                            <p className="text-amber-700 mt-1">
                              {language === 'ar'
                                ? 'لم تُحاول أي قناة. تم تسجيل التنبيه فقط في السجل الداخلي.'
                                : 'No channel was attempted. The alert is only recorded in the in-app log.'}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Onboarding restart — admin only */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                {language === 'ar' ? 'معالج إعداد الأكاديمية' : 'Setup Wizard'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {language === 'ar' ? 'تشغيل المعالج مرة أخرى' : 'Restart setup wizard'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar'
                      ? 'يساعدك على ضبط الهوية والفرع والمدرب الأول.'
                      : 'Helps you re-configure branding, branch, and first coach.'}
                  </p>
                </div>
                <Button variant="outline" onClick={handleRestartOnboarding} disabled={resetting} data-testid="restart-onboarding-btn">
                  {language === 'ar' ? 'تشغيل المعالج' : 'Run wizard'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              {language === 'ar' ? 'عن النظام' : 'About'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {language === 'ar' 
                ? 'نظام إدارة شركة اداء الابطال العالمية للرياضة - نسخة 1.0'
                : 'Champions Performance Academy Management System - Version 1.0'}
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default SettingsPage;
