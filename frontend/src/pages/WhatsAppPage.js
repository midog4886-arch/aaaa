import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { whatsappAPI } from '../services/api';
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Send,
  Settings,
  Loader2,
  Wifi,
  WifiOff,
  PhoneCall,
  Bell,
  Eye,
  Users,
  History,
  Clock,
} from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'ص' : 'م';
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00 ${ampm}` };
});

export default function WhatsAppPage() {
  const { language } = useLanguage();
  const t = (ar, en) => language === 'ar' ? ar : en;
  const isRTL = language === 'ar';

  const [status, setStatus] = useState({ connected: false, qr: null, connecting: false });
  const [settings, setSettings] = useState({
    enabled: false,
    days_before: 3,
    message_template: 'مرحباً {name}،\nنذكركم بأن اشتراككم في نشاط {activity} سينتهي بعد {days} يوم/أيام.\nيرجى التواصل معنا للتجديد. 🏆',
    send_hour: 9,
  });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [targetInfo, setTargetInfo] = useState({ count: 0, target_date: '', loading: false });
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const intervalRef = useRef(null);

  const loadStatus = async () => {
    try {
      const res = await whatsappAPI.getStatus();
      setStatus(res.data);
    } catch {
      setStatus({ connected: false, qr: null, connecting: false });
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await whatsappAPI.getSettings();
      setSettings(res.data);
    } catch { }
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await whatsappAPI.getLogs(30);
      setLogs(res.data || []);
    } catch { }
    finally { setLoadingLogs(false); }
  };

  const loadTargetCount = async () => {
    setTargetInfo(p => ({ ...p, loading: true }));
    try {
      const res = await whatsappAPI.getTargetCount();
      setTargetInfo({ ...res.data, loading: false });
    } catch {
      setTargetInfo(p => ({ ...p, loading: false }));
    }
  };

  useEffect(() => {
    loadStatus();
    loadSettings();
    loadLogs();
    loadTargetCount();
    intervalRef.current = setInterval(() => {
      if (!status.connected) loadStatus();
    }, 30000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (status.connected) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else {
      if (!intervalRef.current) {
        intervalRef.current = setInterval(loadStatus, 30000);
      }
    }
  }, [status.connected]);

  const handleToggleEnabled = () => {
    if (settings.enabled) {
      if (!window.confirm(t('هل تريد إيقاف التذكيرات التلقائية؟', 'Disable automatic reminders?'))) return;
    }
    setSettings(s => ({ ...s, enabled: !s.enabled }));
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await whatsappAPI.updateSettings(settings);
      toast.success(t('تم حفظ الإعدادات', 'Settings saved'));
      loadTargetCount();
    } catch {
      toast.error(t('فشل حفظ الإعدادات', 'Failed to save settings'));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) {
      toast.error(t('أدخل رقم الهاتف', 'Enter phone number'));
      return;
    }
    setSendingTest(true);
    try {
      await whatsappAPI.sendTest(testPhone.trim());
      toast.success(t('تم إرسال الرسالة التجريبية ✓', 'Test message sent ✓'));
    } catch (err) {
      toast.error(err.response?.data?.detail || t('فشل الإرسال', 'Send failed'));
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendNow = async () => {
    if (!window.confirm(t(
      `سيتم إرسال تذكير لـ ${targetInfo.count} عضو. هل تريد المتابعة؟`,
      `Will send to ${targetInfo.count} members. Continue?`
    ))) return;
    setSendingNow(true);
    try {
      await whatsappAPI.sendNow();
      toast.success(t('جاري إرسال التذكيرات...', 'Sending reminders...'));
      setTimeout(() => { loadLogs(); }, 5000);
    } catch (err) {
      toast.error(err.response?.data?.detail || t('فشل الإرسال', 'Send failed'));
    } finally {
      setSendingNow(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(t('هل تريد فصل الحساب وحذف الجلسة؟', 'Disconnect and clear session?'))) return;
    setDisconnecting(true);
    try {
      await whatsappAPI.disconnect();
      toast.success(t('تم الفصل. سيتم توليد QR جديد...', 'Disconnected. New QR will appear...'));
      setTimeout(() => {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        loadStatus();
        intervalRef.current = setInterval(loadStatus, 30000);
      }, 3000);
    } catch {
      toast.error(t('فشل الفصل', 'Disconnect failed'));
    } finally {
      setDisconnecting(false);
    }
  };

  const messagePreview = settings.message_template
    .replace('{name}', t('أحمد محمد', 'Ahmed Mohammed'))
    .replace('{activity}', t('كرة القدم', 'Football'))
    .replace('{days}', settings.days_before);

  const lastLog = logs[0];

  return (
    <Layout title={t('واتساب', 'WhatsApp')}>
      <div className="p-6 space-y-6 max-w-3xl mx-auto" dir={isRTL ? 'rtl' : 'ltr'}>

        {/* ── Connection Status Card ── */}
        <div className={`rounded-2xl border-2 p-6 ${status.connected ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {status.connected
                ? <Wifi className="w-6 h-6 text-green-600" />
                : <WifiOff className="w-6 h-6 text-orange-500" />
              }
              <div>
                <h2 className="text-lg font-bold">
                  {status.connected ? t('متصل بواتساب ✓', 'Connected to WhatsApp ✓') : t('غير متصل', 'Not Connected')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {status.connected
                    ? t('الخدمة تعمل وجاهزة للإرسال', 'Service is running and ready to send')
                    : status.connecting
                      ? t('جارٍ الاتصال...', 'Connecting...')
                      : t('امسح QR بهاتفك للربط', 'Scan QR with your phone to connect')
                  }
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadStatus} disabled={loadingStatus}>
                <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
              </Button>
              {status.connected && (
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting} className="text-red-600 border-red-200 hover:bg-red-50">
                  {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  <span className="ms-1">{t('فصل', 'Disconnect')}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Last send info */}
          {lastLog && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3 mt-2">
              <Clock className="w-3 h-3 shrink-0" />
              <span>
                {t('آخر إرسال:', 'Last send:')} {lastLog.member_name} — {new Date(lastLog.timestamp).toLocaleString(isRTL ? 'ar-SA' : 'en-US')}
                {' '}{lastLog.success ? '✓' : '✗'}
              </span>
            </div>
          )}

          {/* QR Code */}
          {!status.connected && status.qr && (
            <div className="text-center py-4">
              <p className="text-sm font-medium mb-3 text-orange-700">
                {t('افتح واتساب ← المزيد ← الأجهزة المرتبطة ← ربط جهاز ← امسح الكود', 'Open WhatsApp → Linked Devices → Link a Device → Scan code')}
              </p>
              <img src={status.qr} alt="WhatsApp QR Code" className="mx-auto w-56 h-56 rounded-xl border-4 border-white shadow-lg" />
              <p className="text-xs text-muted-foreground mt-3">{t('يتجدد الكود تلقائياً كل 30 ثانية', 'Code refreshes every 30 seconds')}</p>
            </div>
          )}

          {!status.connected && !status.qr && !loadingStatus && (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t('جارٍ تشغيل خدمة واتساب...', 'Starting WhatsApp service...')}</p>
            </div>
          )}
        </div>

        {/* ── Settings Card ── */}
        <div className="rounded-2xl border p-6 bg-card space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">{t('إعدادات التذكيرات التلقائية', 'Automatic Reminder Settings')}</h2>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-muted">
            <div>
              <p className="font-medium">{t('تفعيل التذكيرات التلقائية', 'Enable Automatic Reminders')}</p>
              <p className="text-sm text-muted-foreground">
                {t(`يُرسل يومياً الساعة ${HOURS[settings.send_hour]?.label}`, `Sent daily at ${HOURS[settings.send_hour]?.label}`)}
              </p>
            </div>
            <button
              onClick={handleToggleEnabled}
              className={`relative w-12 h-6 rounded-full transition-colors ${settings.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.enabled ? (isRTL ? 'right-1' : 'translate-x-6') : (isRTL ? 'right-7' : 'translate-x-1')}`} />
            </button>
          </div>

          {/* Days before */}
          <div>
            <label className="block text-sm font-medium mb-2">
              {t('إرسال التذكير قبل انتهاء الاشتراك بـ (أيام)', 'Send reminder N days before expiry')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={30}
                value={settings.days_before}
                onChange={e => setSettings(s => ({ ...s, days_before: parseInt(e.target.value) || 3 }))}
                className="border rounded-lg px-3 py-2 w-24 text-center focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {/* Target count badge */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                <Users className="w-4 h-4 text-blue-600" />
                {targetInfo.loading
                  ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  : <span className="text-sm font-semibold text-blue-700">
                      {targetInfo.count} {t('عضو سيتلقى التذكير', 'members targeted')}
                    </span>
                }
                <Button variant="ghost" size="sm" className="h-6 px-1" onClick={loadTargetCount}>
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
            </div>
            {targetInfo.target_date && (
              <p className="text-xs text-muted-foreground mt-1">
                {t(`الاشتراكات المنتهية بتاريخ: ${targetInfo.target_date}`, `Subscriptions expiring on: ${targetInfo.target_date}`)}
              </p>
            )}
          </div>

          {/* Send hour - dropdown */}
          <div>
            <label className="block text-sm font-medium mb-2">
              {t('ساعة الإرسال اليومي', 'Daily Send Time')}
            </label>
            <select
              value={settings.send_hour}
              onChange={e => setSettings(s => ({ ...s, send_hour: parseInt(e.target.value) }))}
              className="border rounded-lg px-3 py-2 w-40 focus:outline-none focus:ring-2 focus:ring-primary bg-background"
            >
              {HOURS.map(h => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>

          {/* Message template */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('نص الرسالة', 'Message Template')}
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              {t('المتغيرات: {name} الاسم، {activity} النشاط، {days} الأيام', 'Variables: {name} name, {activity} activity, {days} days')}
            </p>
            <textarea
              value={settings.message_template}
              onChange={e => setSettings(s => ({ ...s, message_template: e.target.value }))}
              rows={5}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              dir="auto"
            />
            {/* Preview toggle */}
            <button
              onClick={() => setShowPreview(p => !p)}
              className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
            >
              <Eye className="w-3 h-3" />
              {showPreview ? t('إخفاء المعاينة', 'Hide preview') : t('معاينة الرسالة', 'Preview message')}
            </button>
            {showPreview && (
              <div className="mt-2 p-4 rounded-xl bg-green-50 border border-green-200 text-sm whitespace-pre-wrap" dir="auto">
                <p className="text-xs font-semibold text-green-700 mb-2">{t('معاينة كيف ستبدو الرسالة:', 'Message preview:')}</p>
                {messagePreview}
              </div>
            )}
          </div>

          <Button onClick={handleSaveSettings} disabled={savingSettings} className="w-full">
            {savingSettings ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Settings className="w-4 h-4 me-2" />}
            {t('حفظ الإعدادات', 'Save Settings')}
          </Button>
        </div>

        {/* ── Test & Manual Send Card ── */}
        <div className="rounded-2xl border p-6 bg-card space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <PhoneCall className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">{t('اختبار وإرسال يدوي', 'Test & Manual Send')}</h2>
          </div>

          {/* Test send */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('إرسال رسالة تجريبية لرقم محدد', 'Send test message to specific number')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('رقم الهاتف (مثال: 0501234567)', 'Phone number (e.g. 0501234567)')}
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                dir="ltr"
              />
              <Button onClick={handleSendTest} disabled={sendingTest || !status.connected} variant="outline">
                {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span className="ms-1">{t('إرسال', 'Send')}</span>
              </Button>
            </div>
            {!status.connected && (
              <p className="text-xs text-orange-600 mt-1">{t('يجب الاتصال بواتساب أولاً', 'Connect to WhatsApp first')}</p>
            )}
          </div>

          {/* Manual trigger */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium">{t('إرسال التذكيرات الآن', 'Send Reminders Now')}</p>
              {targetInfo.count > 0 && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                  {targetInfo.count} {t('عضو', 'members')}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t(
                `سيُرسل تذكيراً لكل عضو ينتهي اشتراكه بعد ${settings.days_before} يوم بفاصل دقيقة بين كل رسالة`,
                `Will send to all members expiring in ${settings.days_before} days, 1 min apart`
              )}
            </p>
            <Button
              onClick={handleSendNow}
              disabled={sendingNow || !status.connected}
              className="w-full"
              variant="outline"
            >
              {sendingNow ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <MessageSquare className="w-4 h-4 me-2" />}
              {t('إرسال التذكيرات الآن', 'Send Reminders Now')}
            </Button>
          </div>
        </div>

        {/* ── Send Log Card ── */}
        <div className="rounded-2xl border p-6 bg-card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold">{t('سجل الإرسال', 'Send History')}</h2>
              {logs.length > 0 && (
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{logs.length}</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { loadLogs(); setShowLogs(true); }} disabled={loadingLogs}>
                <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowLogs(p => !p)}>
                {showLogs ? t('إخفاء', 'Hide') : t('عرض', 'Show')}
              </Button>
            </div>
          </div>

          {showLogs && (
            <>
              {loadingLogs ? (
                <div className="text-center py-6"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
              ) : logs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('لا توجد رسائل مُرسلة بعد', 'No messages sent yet')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-start py-2 pe-4 font-medium text-muted-foreground">{t('الوقت', 'Time')}</th>
                        <th className="text-start py-2 pe-4 font-medium text-muted-foreground">{t('العضو', 'Member')}</th>
                        <th className="text-start py-2 pe-4 font-medium text-muted-foreground">{t('النشاط', 'Activity')}</th>
                        <th className="text-center py-2 font-medium text-muted-foreground">{t('الحالة', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-2 pe-4 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString(isRTL ? 'ar-SA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="py-2 pe-4 font-medium">{log.member_name}</td>
                          <td className="py-2 pe-4 text-muted-foreground">{log.activities}</td>
                          <td className="py-2 text-center">
                            {log.success
                              ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="w-3.5 h-3.5" />{t('نجح', 'Sent')}</span>
                              : <span className="inline-flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" />{t('فشل', 'Failed')}</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!showLogs && logs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(`${logs.length} رسالة في السجل — آخرها: ${new Date(logs[0].timestamp).toLocaleString(isRTL ? 'ar-SA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}`, `${logs.length} entries — latest: ${new Date(logs[0].timestamp).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`)}
            </p>
          )}
        </div>

      </div>
    </Layout>
  );
}
