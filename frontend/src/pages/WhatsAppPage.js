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
} from 'lucide-react';

export default function WhatsAppPage() {
  const { language } = useLanguage();
  const t = (ar, en) => language === 'ar' ? ar : en;

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

  useEffect(() => {
    loadStatus();
    loadSettings();
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
        intervalRef.current = setInterval(loadStatus, 15000);
      }
    }
  }, [status.connected]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await whatsappAPI.updateSettings(settings);
      toast.success(t('تم حفظ الإعدادات', 'Settings saved'));
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
    setSendingNow(true);
    try {
      await whatsappAPI.sendNow();
      toast.success(t('جاري إرسال التذكيرات...', 'Sending reminders...'));
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
        intervalRef.current = setInterval(loadStatus, 15000);
      }, 3000);
    } catch {
      toast.error(t('فشل الفصل', 'Disconnect failed'));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Layout title={t('واتساب', 'WhatsApp')}>
      <div className="p-6 space-y-6 max-w-3xl mx-auto" dir={language === 'ar' ? 'rtl' : 'ltr'}>

        {/* Connection Status Card */}
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

          {/* QR Code */}
          {!status.connected && status.qr && (
            <div className="text-center py-4">
              <p className="text-sm font-medium mb-3 text-orange-700">
                {t('افتح واتساب → المزيد → الأجهزة المرتبطة → ربط جهاز → امسح الكود', 'Open WhatsApp → Linked Devices → Link a Device → Scan code')}
              </p>
              <img
                src={status.qr}
                alt="WhatsApp QR Code"
                className="mx-auto w-56 h-56 rounded-xl border-4 border-white shadow-lg"
              />
              <p className="text-xs text-muted-foreground mt-3">
                {t('يتجدد الكود تلقائياً كل 15 ثانية', 'Code refreshes every 15 seconds')}
              </p>
            </div>
          )}

          {!status.connected && !status.qr && !loadingStatus && (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {t('جارٍ تشغيل خدمة واتساب...', 'Starting WhatsApp service...')}
              </p>
            </div>
          )}
        </div>

        {/* Settings Card */}
        <div className="rounded-2xl border p-6 bg-card space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">{t('إعدادات التذكيرات التلقائية', 'Automatic Reminder Settings')}</h2>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-muted">
            <div>
              <p className="font-medium">{t('تفعيل التذكيرات التلقائية', 'Enable Automatic Reminders')}</p>
              <p className="text-sm text-muted-foreground">{t('يُرسل يومياً الساعة 9 صباحاً', 'Sent daily at the configured hour')}</p>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${settings.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.enabled ? (language === 'ar' ? 'right-1' : 'translate-x-6') : (language === 'ar' ? 'right-7' : 'translate-x-1')}`} />
            </button>
          </div>

          {/* Days before */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('إرسال التذكير قبل انتهاء الاشتراك بـ (أيام)', 'Send reminder N days before expiry')}
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.days_before}
              onChange={e => setSettings(s => ({ ...s, days_before: parseInt(e.target.value) || 3 }))}
              className="border rounded-lg px-3 py-2 w-32 text-center focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Send hour */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('ساعة الإرسال اليومي (0-23)', 'Daily send hour (0-23)')}
            </label>
            <input
              type="number"
              min={0}
              max={23}
              value={settings.send_hour}
              onChange={e => setSettings(s => ({ ...s, send_hour: parseInt(e.target.value) || 9 }))}
              className="border rounded-lg px-3 py-2 w-32 text-center focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Message template */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('نص الرسالة', 'Message Template')}
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              {t('المتغيرات المتاحة: {name} اسم العضو، {activity} اسم النشاط، {days} عدد الأيام', 'Available variables: {name} member name, {activity} activity name, {days} days count')}
            </p>
            <textarea
              value={settings.message_template}
              onChange={e => setSettings(s => ({ ...s, message_template: e.target.value }))}
              rows={5}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              dir="auto"
            />
          </div>

          <Button onClick={handleSaveSettings} disabled={savingSettings} className="w-full">
            {savingSettings ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Settings className="w-4 h-4 me-2" />}
            {t('حفظ الإعدادات', 'Save Settings')}
          </Button>
        </div>

        {/* Test & Manual Send Card */}
        <div className="rounded-2xl border p-6 bg-card space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <PhoneCall className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">{t('اختبار وإرسال يدوي', 'Test & Manual Send')}</h2>
          </div>

          {/* Test send */}
          <div>
            <label className="block text-sm font-medium mb-2">{t('إرسال رسالة تجريبية', 'Send Test Message')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('رقم الهاتف (مثال: 0501234567)', 'Phone number (e.g. 0501234567)')}
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                dir="ltr"
              />
              <Button
                onClick={handleSendTest}
                disabled={sendingTest || !status.connected}
                variant="outline"
              >
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
            <p className="text-sm font-medium mb-1">{t('إرسال التذكيرات الآن', 'Send Reminders Now')}</p>
            <p className="text-xs text-muted-foreground mb-3">
              {t(`سيُرسل تذكيراً لكل عضو ينتهي اشتراكه بعد ${settings.days_before} يوم بفاصل دقيقة بين كل رسالة`, `Will send to all members with subscriptions expiring in ${settings.days_before} days, 1 min apart`)}
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

      </div>
    </Layout>
  );
}
