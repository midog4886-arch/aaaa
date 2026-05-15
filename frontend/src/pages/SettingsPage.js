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
import { tenantAPI, notificationsSettingsAPI } from '../services/api';
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
  RefreshCw
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
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => { if (!cancelled) setDailyChecksLoading(false); });
    fetchDailyChecksStatus();
    return () => { cancelled = true; };
  }, [isAdmin, fetchDailyChecksStatus]);

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

  const handleSaveDailyChecksTime = async (nextHour, nextMinute) => {
    setDailyChecksSaving(true);
    try {
      const res = await notificationsSettingsAPI.updateDailyChecks(nextHour, nextMinute);
      if (typeof res?.data?.hour === 'number') setDailyChecksHour(res.data.hour);
      if (typeof res?.data?.minute === 'number') setDailyChecksMinute(res.data.minute);
      toast.success(language === 'ar'
        ? 'تم حفظ وقت التنبيهات اليومية'
        : 'Daily alerts time saved');
    } catch (e) {
      toast.error(e?.response?.data?.detail || (language === 'ar'
        ? 'تعذر حفظ الإعداد'
        : 'Failed to save setting'));
    } finally {
      setDailyChecksSaving(false);
    }
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

  return (
    <Layout title={t('settings')}>
      <div className="space-y-6 max-w-2xl" data-testid="settings-page">
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
                      ? `يتم تنفيذ الفحص يومياً بتوقيت الرياض (الافتراضي ${formatTime(dailyChecksDefault, dailyChecksDefaultMinute)}).`
                      : `Runs daily in Asia/Riyadh time (default ${formatTime(dailyChecksDefault, dailyChecksDefaultMinute)}).`}
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
