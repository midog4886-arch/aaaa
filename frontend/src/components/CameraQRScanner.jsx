import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import {
  Camera, Check, X, User, Clock, Activity,
  Loader2, Calendar, Phone, SwitchCamera, AlertTriangle
} from 'lucide-react';
import { attendanceAPI } from '../services/api';

const CameraQRScanner = ({ open, onClose, language = 'ar' }) => {
  const t = (ar, en) => language === 'ar' ? ar : en;

  const [scanning, setScanning] = useState(false);
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Per-activity states: { [activityId]: { status, scheduleDays, message, sessionQuotaWarning } }
  const [activityStates, setActivityStates] = useState({});
  const [facingMode, setFacingMode] = useState('environment');
  const scannerRef = useRef(null);
  const containerRef = useRef(null);

  const extractMemberCode = (scannedData) => {
    if (!scannedData) return null;
    let data = scannedData.trim();
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        if (parsed.code) return parsed.code.toString();
        if (parsed.member_code) return parsed.member_code.toString();
        if (parsed.member_id) return parsed.member_id.toString();
        if (parsed.id) return parsed.id.toString();
        return null;
      }
      return String(parsed);
    } catch (e) {}
    return data;
  };

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (e) {}
      try {
        scannerRef.current.clear();
      } catch (e) {}
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  const handleScanSuccess = useCallback(async (decodedText) => {
    const memberCode = extractMemberCode(decodedText);
    if (!memberCode) return;

    await stopScanner();
    setLoading(true);

    try {
      const branchId = localStorage.getItem('selectedBranchId') || '';
      const lookupUrl = `/api/public/member-card/${encodeURIComponent(memberCode)}${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''}`;
      const response = await fetch(lookupUrl);
      if (response.ok) {
        const data = await response.json();
        const allActivities = data.activities || [];
        const activeActivities = allActivities.filter(a => a.status === 'active');
        const expiredActivities = allActivities.filter(a => a.status === 'expired');
        const initStates = {};
        activeActivities.forEach(a => {
          initStates[a.activity_id] = { status: a.recorded_today ? 'recorded' : 'idle' };
        });
        setActivityStates(initStates);
        setMemberData({ ...data, activeActivities, expiredActivities });
      } else {
        // Capture server-provided error detail (e.g. 409 duplicate suffix across branches)
        let serverErrorMsg = null;
        try {
          const errBody = await response.clone().json();
          const detail = errBody?.detail;
          if (typeof detail === 'string') serverErrorMsg = detail;
          else if (detail?.msg) serverErrorMsg = detail.msg;
          else if (detail?.message) serverErrorMsg = detail.message;
        } catch (_) {}

        const coachRes = await fetch(`/api/coach-attendance/qr-checkin-by-code/${memberCode}`, { method: 'POST' });
        if (coachRes.ok) {
          const coachData = await coachRes.json();
          setMemberData({ isCoach: true, ...coachData });
        } else {
          setMemberData({
            error: true,
            message: serverErrorMsg
              ? `⚠️ ${serverErrorMsg}`
              : t('رقم العضوية غير موجود', 'Member ID not found'),
            memberCode
          });
        }
      }
    } catch (error) {
      setMemberData({
        error: true,
        message: t('رقم العضوية غير موجود', 'Member ID not found'),
        memberCode
      });
    } finally {
      setLoading(false);
    }
  }, [stopScanner, t]);

  const startScanner = useCallback(async () => {
    setMemberData(null);
    setActivityStates({});
    setLoading(false);

    await stopScanner();

    await new Promise(resolve => setTimeout(resolve, 300));

    const containerId = 'camera-qr-reader';
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          handleScanSuccess(decodedText);
        },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      console.error('Camera error:', err);
      toast.error(t('لا يمكن فتح الكاميرا. تأكد من إعطاء الإذن.', 'Cannot open camera. Please grant permission.'));
    }
  }, [facingMode, handleScanSuccess, stopScanner, t]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => startScanner(), 500);
      return () => clearTimeout(timer);
    } else {
      stopScanner();
      setMemberData(null);
      setActivityStates({});
    }
  }, [open]);

  const handleClose = useCallback(() => {
    stopScanner();
    setMemberData(null);
    setActivityStates({});
    onClose();
  }, [stopScanner, onClose]);

  const handleSwitchCamera = useCallback(() => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    stopScanner().then(() => {
      setTimeout(() => startScanner(), 300);
    });
  }, [stopScanner, startScanner]);

  const handleCheckin = useCallback(async (activityId, activityName, force = false) => {
    if (!memberData || !activityId) return;

    setActivityStates(prev => ({
      ...prev,
      [activityId]: { ...prev[activityId], status: 'loading' }
    }));

    try {
      const res = await attendanceAPI.qrCheckin(
        memberData.member_code || memberData.id,
        activityId,
        force
      );

      if (res.data.status === 'already_checked_in') {
        setActivityStates(prev => ({
          ...prev,
          [activityId]: { status: 'recorded', message: t('مسجل مسبقاً اليوم ✓', 'Already checked in today ✓') }
        }));
        setMemberData(prev => ({
          ...prev,
          activeActivities: prev.activeActivities.map(a =>
            a.activity_id === activityId ? { ...a, recorded_today: true } : a
          )
        }));
      } else if (res.data.status === 'wrong_day') {
        const scheduleDays = res.data.schedule_days || [];
        setActivityStates(prev => ({
          ...prev,
          [activityId]: {
            status: 'wrong_day',
            scheduleDays,
            today: res.data.today,
            message: res.data.message || t('هذا ليس موعدك اليوم!', 'This is not your scheduled day!')
          }
        }));
      } else {
        const quotaWarn = res.data.session_quota_warning;
        const wrongDayWarn = res.data.wrong_day_warning;
        setActivityStates(prev => ({
          ...prev,
          [activityId]: {
            status: 'recorded',
            sessionQuotaWarning: quotaWarn || null,
            wrongDayWarning: wrongDayWarn || null,
            message: t('✅ تم تسجيل الحضور', '✅ Checked in')
          }
        }));
        setMemberData(prev => ({
          ...prev,
          activeActivities: prev.activeActivities.map(a =>
            a.activity_id === activityId ? { ...a, recorded_today: true } : a
          )
        }));
      }
    } catch (error) {
      const rawErr = error.response?.data?.detail;
      const errorMsg = typeof rawErr === 'string' ? rawErr : (rawErr?.msg || rawErr?.message || t('خطأ في التسجيل', 'Check-in error'));
      setActivityStates(prev => ({
        ...prev,
        [activityId]: { status: 'error', message: `❌ ${errorMsg}` }
      }));
    }
  }, [memberData, t]);

  const handleScanAgain = useCallback(() => {
    setMemberData(null);
    setActivityStates({});
    startScanner();
  }, [startScanner]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            {t('مسح QR بالكاميرا', 'Camera QR Scanner')}
          </DialogTitle>
        </DialogHeader>

        {!memberData && !loading && (
          <div className="space-y-3">
            <div
              id="camera-qr-reader"
              ref={containerRef}
              style={{ width: '100%', minHeight: '300px', borderRadius: '12px', overflow: 'hidden' }}
            />
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSwitchCamera}>
                <SwitchCamera className="w-4 h-4 me-2" />
                {t('تبديل الكاميرا', 'Switch Camera')}
              </Button>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              {t('وجّه الكاميرا نحو رمز QR الخاص بالعضو', 'Point camera at member QR code')}
            </p>
          </div>
        )}

        {loading && (
          <div className="py-12 text-center">
            <Loader2 className="w-16 h-16 mx-auto animate-spin text-blue-500" />
            <p className="mt-4 text-lg text-gray-600">{t('جاري البحث...', 'Searching...')}</p>
          </div>
        )}

        {memberData?.isCoach && (
          <div className="py-6 text-center space-y-4">
            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${memberData.action === 'checked_in' ? 'bg-green-100' : memberData.action === 'checked_out' ? 'bg-blue-100' : 'bg-amber-100'}`}>
              {memberData.action === 'checked_in' && <Check className="w-10 h-10 text-green-600" />}
              {memberData.action === 'checked_out' && <Clock className="w-10 h-10 text-blue-600" />}
              {memberData.action === 'already_out' && <AlertTriangle className="w-10 h-10 text-amber-600" />}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">{t('مدرب', 'Coach')}</p>
              <h2 className="text-xl font-bold">{memberData.coach_name}</h2>
              <Badge variant="outline" className="mt-1">#{memberData.employee_id}</Badge>
            </div>
            <p className={`text-base font-bold ${memberData.action === 'checked_in' ? 'text-green-700' : memberData.action === 'checked_out' ? 'text-blue-700' : 'text-amber-700'}`}>
              {memberData.message}
            </p>
            <div className="flex gap-3 justify-center text-sm">
              {memberData.check_in_time && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-green-600">{t('حضور', 'In')}</p>
                  <p className="font-bold text-green-700" dir="ltr">{memberData.check_in_time}</p>
                </div>
              )}
              {memberData.check_out_time && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-blue-600">{t('انصراف', 'Out')}</p>
                  <p className="font-bold text-blue-700" dir="ltr">{memberData.check_out_time}</p>
                </div>
              )}
              {memberData.total_hours != null && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-purple-600">{t('ساعات', 'Hours')}</p>
                  <p className="font-bold text-purple-700">{memberData.total_hours}</p>
                </div>
              )}
            </div>
            <Button onClick={handleScanAgain} className="gap-2">
              <Camera className="w-4 h-4" />
              {t('مسح آخر', 'Scan Another')}
            </Button>
          </div>
        )}

        {memberData?.error && (
          <div className="py-8 text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <X className="w-10 h-10 text-red-500" />
            </div>
            <p className="text-xl font-bold text-red-600">{memberData.message}</p>
            {memberData.memberCode && (
              <p className="text-gray-500">#{memberData.memberCode}</p>
            )}
            <Button onClick={handleScanAgain} className="gap-2">
              <Camera className="w-4 h-4" />
              {t('مسح مرة أخرى', 'Scan Again')}
            </Button>
          </div>
        )}

        {memberData && !memberData.error && !memberData.isCoach && (
          <div className="space-y-4">
            {/* Member Info */}
            <div className="text-center border-b pb-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center mb-3">
                <User className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-bold">{memberData.name_ar || memberData.name}</h2>
              <div className="flex items-center justify-center gap-3 mt-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="gap-1">
                  <User className="w-3 h-3" />
                  #{memberData.member_code}
                </Badge>
                {memberData.phone && (
                  <span className="flex items-center gap-1" dir="ltr">
                    <Phone className="w-3 h-3" />
                    {memberData.phone}
                  </span>
                )}
              </div>
            </div>

            {/* Member notes (admin-only) — shown in red as an alert */}
            {memberData.notes && memberData.notes.trim() && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-red-700 font-bold text-xs mb-1">
                    {t('ملاحظة هامة', 'Important note')}
                  </p>
                  <p className="text-red-800 text-sm whitespace-pre-wrap break-words">
                    {memberData.notes}
                  </p>
                </div>
              </div>
            )}

            {/* Active Activities - each with independent check-in */}
            {memberData.activeActivities?.length > 0 ? (
              <div>
                <h3 className="font-bold text-sm text-gray-700 mb-2 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-600" />
                  {t('الاشتراكات النشطة', 'Active Subscriptions')}
                  <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">{memberData.activeActivities.length}</span>
                </h3>
                <div className="space-y-3">
                  {memberData.activeActivities.map((act, idx) => {
                    const state = activityStates[act.activity_id] || { status: 'idle' };
                    const isRecorded = state.status === 'recorded' || act.recorded_today;
                    const isLoading = state.status === 'loading';
                    const isWrongDay = state.status === 'wrong_day';
                    const isError = state.status === 'error';

                    return (
                      <div
                        key={idx}
                        className={`rounded-xl border-2 overflow-hidden transition-all ${
                          isRecorded
                            ? 'bg-green-50 border-green-300'
                            : isWrongDay
                            ? 'bg-yellow-50 border-yellow-400'
                            : isError
                            ? 'bg-red-50 border-red-300'
                            : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className="p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-bold">{act.activity_name}</p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {t('ينتهي:', 'Expires:')} {act.end_date || '-'}
                            </p>
                            {act.schedule && (
                              <p className="text-xs text-blue-600 flex items-center gap-1 mt-0.5">
                                <Clock className="w-3 h-3" />
                                {act.schedule}
                              </p>
                            )}
                          </div>
                          {isRecorded ? (
                            <Badge className="bg-green-100 text-green-700 gap-1 flex-shrink-0">
                              <Check className="w-3 h-3" />
                              {t('مسجل', 'Done')}
                            </Badge>
                          ) : isWrongDay ? (
                            <Badge className="bg-yellow-100 text-yellow-700 gap-1 flex-shrink-0 border-yellow-300">
                              <Clock className="w-3 h-3" />
                              {t('يوم خاطئ', 'Wrong day')}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                              disabled={isLoading}
                              className="bg-gradient-to-r from-green-500 to-blue-500 gap-1 flex-shrink-0"
                            >
                              {isLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              {t('تسجيل', 'Check-in')}
                            </Button>
                          )}
                        </div>

                        {/* Wrong Day Inline Warning */}
                        {isWrongDay && (
                          <div className="px-3 pb-3 space-y-2">
                            <div className="bg-yellow-100 p-2.5 rounded-lg border border-yellow-200">
                              <p className="text-yellow-800 font-bold text-xs mb-1">⚠️ {state.message}</p>
                              <p className="text-xs text-yellow-700">
                                {t('مواعيدك:', 'Your days:')} <span className="font-semibold">{state.scheduleDays?.join(' - ')}</span>
                              </p>
                            </div>
                            <Button
                              onClick={() => handleCheckin(act.activity_id, act.activity_name, true)}
                              disabled={isLoading}
                              variant="outline"
                              size="sm"
                              className="w-full border-yellow-400 text-yellow-800 hover:bg-yellow-100 gap-2"
                            >
                              {isLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              {t('تسجيل حضور رغم ذلك', 'Check-in anyway')}
                            </Button>
                          </div>
                        )}

                        {/* Error message */}
                        {isError && (
                          <div className="px-3 pb-3">
                            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{state.message}</p>
                            <Button
                              onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                              size="sm"
                              variant="outline"
                              className="w-full mt-2 border-red-300 text-red-600 hover:bg-red-50 gap-1"
                            >
                              {t('إعادة المحاولة', 'Retry')}
                            </Button>
                          </div>
                        )}

                        {/* Wrong-day informational notice (check-in was still saved) */}
                        {isRecorded && state.wrongDayWarning && (
                          <div className="px-3 pb-3">
                            <div className="bg-yellow-50 p-2.5 rounded-lg border border-yellow-200">
                              <p className="text-yellow-800 font-bold text-xs mb-1">
                                {state.wrongDayWarning.message}
                              </p>
                              <p className="text-xs text-yellow-700">
                                {t('مواعيدك:', 'Your days:')} <span className="font-semibold">{state.wrongDayWarning.schedule_days?.join(' - ')}</span>
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Session Quota Warning */}
                        {isRecorded && state.sessionQuotaWarning && (
                          <div className="px-3 pb-3">
                            <div className="bg-amber-100/80 p-2.5 rounded-lg border border-amber-200">
                              <p className="text-amber-900 font-bold text-xs mb-2">
                                {state.sessionQuotaWarning.message}
                              </p>
                              <div className="grid grid-cols-3 gap-1.5 text-center">
                                <div className="bg-white/60 rounded-md p-1">
                                  <p className="text-base font-bold text-amber-700">{state.sessionQuotaWarning.used}</p>
                                  <p className="text-[9px] text-amber-600">{t('مستخدم', 'Used')}</p>
                                </div>
                                <div className="bg-white/60 rounded-md p-1">
                                  <p className="text-base font-bold text-amber-700">{state.sessionQuotaWarning.total}</p>
                                  <p className="text-[9px] text-amber-600">{t('الإجمالي', 'Total')}</p>
                                </div>
                                <div className="bg-white/60 rounded-md p-1">
                                  <p className="text-base font-bold text-amber-700">{state.sessionQuotaWarning.remaining ?? 0}</p>
                                  <p className="text-[9px] text-amber-600">{t('متبقي', 'Left')}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-4 bg-orange-50 rounded-xl">
                <AlertTriangle className="w-10 h-10 mx-auto text-orange-500 mb-1" />
                <p className="font-bold text-orange-700 text-sm">
                  {t('لا توجد اشتراكات نشطة', 'No active subscriptions')}
                </p>
              </div>
            )}

            {/* Expired Subscriptions */}
            {memberData.expiredActivities?.length > 0 && (
              <div>
                <h3 className="font-bold text-gray-500 mb-1 text-xs">
                  {t('اشتراكات منتهية', 'Expired Subscriptions')}
                </h3>
                <div className="space-y-1">
                  {memberData.expiredActivities.map((act, idx) => (
                    <div key={idx} className="p-2 bg-red-50 rounded-lg text-xs flex justify-between items-center">
                      <span className="text-red-700">{act.activity_name}</span>
                      <Badge variant="destructive" className="text-xs">
                        {t('منتهي', 'Expired')}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={handleScanAgain} variant="outline" className="w-full gap-2">
              <Camera className="w-4 h-4" />
              {t('مسح عضو آخر', 'Scan Another')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CameraQRScanner;
