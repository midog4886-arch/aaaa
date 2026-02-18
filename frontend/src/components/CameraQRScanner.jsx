import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import {
  Camera, Check, X, User, Clock, Activity,
  Loader2, Calendar, Phone, SwitchCamera
} from 'lucide-react';
import { attendanceAPI } from '../services/api';

const CameraQRScanner = ({ open, onClose, language = 'ar' }) => {
  const t = (ar, en) => language === 'ar' ? ar : en;

  const [scanning, setScanning] = useState(false);
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const scannerRef = useRef(null);
  const containerRef = useRef(null);

  const extractMemberCode = (scannedData) => {
    if (!scannedData) return null;
    let data = scannedData.trim();
    if (/^\d+$/.test(data)) return data;
    try {
      const parsed = JSON.parse(data);
      if (parsed.code) return parsed.code.toString();
      if (parsed.member_code) return parsed.member_code.toString();
    } catch (e) {}
    const numberMatch = data.match(/(\d{3,6})/);
    if (numberMatch) return numberMatch[1];
    return null;
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
      const response = await fetch(`/api/public/member-card/${memberCode}`);
      if (!response.ok) throw new Error('Member not found');
      const data = await response.json();

      const allActivities = data.activities || [];
      const activeActivities = allActivities.filter(a => a.status === 'active');
      const expiredActivities = allActivities.filter(a => a.status === 'expired');

      setMemberData({ ...data, activeActivities, expiredActivities });
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
    setLastResult(null);
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
      setLastResult(null);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    stopScanner();
    setMemberData(null);
    setLastResult(null);
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
    setCheckingIn(true);

    try {
      const res = await attendanceAPI.qrCheckin(
        memberData.member_code || memberData.id,
        activityId,
        force
      );

      if (res.data.status === 'already_checked_in') {
        setLastResult({
          success: false,
          alreadyCheckedIn: true,
          activityName,
          message: t('مسجل مسبقاً اليوم', 'Already checked in today')
        });
      } else if (res.data.status === 'wrong_day') {
        const scheduleDays = res.data.schedule_days || [];
        setLastResult({
          success: false,
          wrongDay: true,
          activityId,
          activityName,
          scheduleDays,
          today: res.data.today,
          message: res.data.message || t('هذا ليس موعدك اليوم!', 'This is not your scheduled day!')
        });
      } else {
        setLastResult({
          success: true,
          activityName,
          message: t('تم تسجيل الحضور بنجاح', 'Check-in successful')
        });
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
      setLastResult({
        success: false,
        activityName,
        message: errorMsg
      });
    } finally {
      setCheckingIn(false);
    }
  }, [memberData, t]);

  const handleScanAgain = useCallback(() => {
    setMemberData(null);
    setLastResult(null);
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

        {memberData && !memberData.error && (
          <div className="space-y-4">
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

            {lastResult && (
              <div className={`p-3 rounded-xl border-2 ${
                lastResult.success
                  ? 'bg-green-50 border-green-300'
                  : lastResult.wrongDay
                    ? 'bg-yellow-50 border-yellow-400'
                    : lastResult.alreadyCheckedIn
                      ? 'bg-orange-50 border-orange-300'
                      : 'bg-red-50 border-red-300'
              }`}>
                <div className="flex items-center gap-3">
                  {lastResult.success ? (
                    <Check className="w-6 h-6 text-green-500" />
                  ) : lastResult.wrongDay ? (
                    <Clock className="w-6 h-6 text-yellow-500" />
                  ) : (
                    <X className="w-6 h-6 text-red-500" />
                  )}
                  <div className="flex-1">
                    <p className={`font-bold text-sm ${
                      lastResult.success ? 'text-green-700'
                        : lastResult.wrongDay ? 'text-yellow-700'
                        : 'text-red-700'
                    }`}>
                      {lastResult.wrongDay ? `⚠️ ${lastResult.message}` : lastResult.message}
                    </p>
                    <p className="text-xs text-gray-500">{lastResult.activityName}</p>
                  </div>
                </div>
                {lastResult.wrongDay && (
                  <div className="mt-2 pt-2 border-t border-yellow-300">
                    <p className="text-xs text-yellow-800 mb-2 font-medium">
                      {t('مواعيدك:', 'Your days:')} {lastResult.scheduleDays?.join(' - ')}
                    </p>
                    <Button
                      onClick={() => handleCheckin(lastResult.activityId, lastResult.activityName, true)}
                      disabled={checkingIn}
                      variant="outline"
                      size="sm"
                      className="w-full border-yellow-400 text-yellow-800 hover:bg-yellow-100 gap-2"
                    >
                      {checkingIn ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      {t('تسجيل حضور رغم ذلك', 'Check-in anyway')}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {memberData.activeActivities?.length > 0 ? (
              <div>
                <h3 className="font-bold text-sm text-gray-700 mb-2 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-600" />
                  {t('الاشتراكات النشطة', 'Active Subscriptions')}
                </h3>
                <div className="space-y-2">
                  {memberData.activeActivities.map((act, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border-2 ${
                        act.recorded_today
                          ? 'bg-green-50 border-green-300'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold">{act.activity_name}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {t('ينتهي:', 'Expires:')} {act.end_date || '-'}
                          </p>
                        </div>
                        {act.recorded_today ? (
                          <Badge className="bg-green-100 text-green-700 gap-1">
                            <Check className="w-3 h-3" />
                            {t('مسجل', 'Done')}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                            disabled={checkingIn}
                            className="bg-gradient-to-r from-green-500 to-blue-500 gap-1"
                          >
                            {checkingIn ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            {t('تسجيل', 'Check-in')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-4 bg-orange-50 rounded-xl">
                <X className="w-10 h-10 mx-auto text-orange-500 mb-1" />
                <p className="font-bold text-orange-700 text-sm">
                  {t('لا توجد اشتراكات نشطة', 'No active subscriptions')}
                </p>
              </div>
            )}

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
