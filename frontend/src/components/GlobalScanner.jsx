/**
 * Global QR Scanner Component
 * مكون المسح العام - يعمل تلقائياً في جميع الصفحات
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { 
  Scan, Check, X, User, Clock, Activity, 
  Volume2, VolumeX, Loader2, Calendar, Phone, AlertTriangle
} from 'lucide-react';
import { attendanceAPI } from '../services/api';

const GlobalScanner = ({ enabled = true, language = 'ar' }) => {
  const t = (ar, en) => language === 'ar' ? ar : en;
  
  // States
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showMemberDialog, setShowMemberDialog] = useState(false);
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Per-activity states: { [activityId]: { status: 'idle'|'loading'|'wrong_day'|'recorded'|'error', scheduleDays, message } }
  const [activityStates, setActivityStates] = useState({});
  
  // Scanner buffer
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const timeoutRef = useRef(null);
  const isProcessingRef = useRef(false);
  const lastScannedCodeRef = useRef('');
  const scanLockTimeRef = useRef(0);

  // Load sound setting
  useEffect(() => {
    const savedSound = localStorage.getItem('globalScanner_sound');
    if (savedSound !== null) setSoundEnabled(savedSound === 'true');
  }, []);

  // Save sound setting
  useEffect(() => {
    localStorage.setItem('globalScanner_sound', soundEnabled.toString());
  }, [soundEnabled]);

  // Play sound
  const playSound = useCallback((type) => {
    if (!soundEnabled) return;
    
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      if (type === 'success') {
        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.3;
        oscillator.start();
        setTimeout(() => oscillator.frequency.value = 1000, 100);
        setTimeout(() => oscillator.stop(), 200);
      } else if (type === 'error') {
        oscillator.frequency.value = 300;
        gainNode.gain.value = 0.3;
        oscillator.start();
        setTimeout(() => oscillator.stop(), 400);
      } else if (type === 'scan') {
        oscillator.frequency.value = 600;
        gainNode.gain.value = 0.2;
        oscillator.start();
        setTimeout(() => oscillator.stop(), 100);
      }
    } catch (e) {
      console.log('Audio not supported');
    }
  }, [soundEnabled]);

  // Extract member code from QR data
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

  // Fetch member data and show dialog; auto check-in when member has exactly one active unrecorded activity
  const handleScan = useCallback(async (scannedData) => {
    if (!scannedData) return;
    
    const now = Date.now();
    const memberCode = extractMemberCode(scannedData);
    
    if (!memberCode) return;
    
    if (isProcessingRef.current) {
      bufferRef.current = '';
      return;
    }
    
    if (now - scanLockTimeRef.current < 2000) {
      bufferRef.current = '';
      return;
    }
    
    isProcessingRef.current = true;
    scanLockTimeRef.current = now;
    lastScannedCodeRef.current = memberCode;
    
    setShowMemberDialog(false);
    setMemberData(null);
    setActivityStates({});
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    if (lastScannedCodeRef.current !== memberCode) {
      isProcessingRef.current = false;
      return;
    }
    
    playSound('scan');
    setLoading(true);
    setShowMemberDialog(true);
    
    let memberLookupErrorMsg = null;
    try {
      const API_URL = '';
      const response = await fetch(`${API_URL}/api/public/member-card/${memberCode}`);
      
      if (!response.ok) {
        // Capture server-provided error (e.g. 409 duplicate across branches) before trying coach lookup
        try {
          const errBody = await response.clone().json();
          const detail = errBody?.detail;
          if (typeof detail === 'string') memberLookupErrorMsg = detail;
          else if (detail?.msg) memberLookupErrorMsg = detail.msg;
          else if (detail?.message) memberLookupErrorMsg = detail.message;
        } catch (_) {}
        // Not a member — try coach lookup
        const coachRes = await fetch(`/api/coach-attendance/qr-status-by-code/${memberCode}`);
        if (coachRes.ok) {
          // It's a coach — auto check-in/out then close dialog
          setLoading(false);
          setShowMemberDialog(false);
          setMemberData(null);
          try {
            const checkInRes = await fetch(`/api/coach-attendance/qr-checkin-by-code/${memberCode}`, { method: 'POST' });
            if (checkInRes.ok) {
              const cData = await checkInRes.json();
              if (cData.action === 'checked_in') {
                playSound('success');
                toast.success(`✅ ${cData.coach_name} — تم تسجيل الحضور`);
              } else if (cData.action === 'checked_out') {
                playSound('success');
                toast.success(`✅ ${cData.coach_name} — تم تسجيل الانصراف`);
              } else {
                playSound('scan');
                toast.info(`${cData.coach_name} — ${cData.message || 'تم المسح'}`);
              }
            }
          } catch (_) {}
          setTimeout(() => {
            isProcessingRef.current = false;
            lastScannedCodeRef.current = '';
          }, 300);
          return;
        }
        throw new Error('Member not found');
      }
      
      const data = await response.json();
      
      const allActivities = data.activities || [];
      const activeActivities = allActivities.filter(a => a.status === 'active');
      const expiredActivities = allActivities.filter(a => a.status === 'expired');
      
      // Initialize activity states
      const initStates = {};
      activeActivities.forEach(a => {
        initStates[a.activity_id] = { status: a.recorded_today ? 'recorded' : 'idle' };
      });
      setActivityStates(initStates);
      
      const mData = { ...data, activeActivities, expiredActivities };
      setMemberData(mData);
      
      if (activeActivities.length === 0) {
        playSound('error');
        setLoading(false);
      } else if (activeActivities.length === 1 && !activeActivities[0].recorded_today) {
        // Auto check-in when member has exactly one unrecorded active activity
        const act = activeActivities[0];
        setActivityStates({ [act.activity_id]: { status: 'loading' } });
        setLoading(false);
        try {
          const res = await attendanceAPI.qrCheckin(
            mData.member_code || mData.id,
            act.activity_id,
            false
          );
          if (res.data.status === 'already_checked_in') {
            playSound('error');
            setActivityStates({ [act.activity_id]: { status: 'recorded', message: t('مسجل مسبقاً اليوم ✓', 'Already checked in today ✓') } });
            setMemberData(prev => ({ ...prev, activeActivities: prev.activeActivities.map(a => a.activity_id === act.activity_id ? { ...a, recorded_today: true } : a) }));
          } else if (res.data.status === 'wrong_day') {
            playSound('error');
            setActivityStates({ [act.activity_id]: { status: 'wrong_day', scheduleDays: res.data.schedule_days || [], today: res.data.today, message: res.data.message || t('هذا ليس موعدك اليوم!', 'This is not your scheduled day!') } });
          } else {
            const quotaWarn = res.data.session_quota_warning;
            const wrongDayWarn = res.data.wrong_day_warning;
            playSound(quotaWarn ? 'error' : 'success');
            setActivityStates({ [act.activity_id]: { status: 'recorded', sessionQuotaWarning: quotaWarn || null, wrongDayWarning: wrongDayWarn || null, message: t('✅ تم تسجيل الحضور', '✅ Checked in') } });
            setMemberData(prev => ({ ...prev, activeActivities: prev.activeActivities.map(a => a.activity_id === act.activity_id ? { ...a, recorded_today: true } : a) }));
          }
        } catch (checkinError) {
          playSound('error');
          const rawErr = checkinError.response?.data?.detail;
          const errorMsg = typeof rawErr === 'string' ? rawErr : (rawErr?.msg || rawErr?.message || t('خطأ في التسجيل', 'Check-in error'));
          setActivityStates({ [act.activity_id]: { status: 'error', message: `❌ ${errorMsg}` } });
        }
      } else {
        setLoading(false);
      }
      
    } catch (error) {
      playSound('error');
      setMemberData({
        error: true,
        message: memberLookupErrorMsg
          ? `⚠️ ${memberLookupErrorMsg}`
          : t('⚠️ رقم العضوية غير موجود', '⚠️ Member ID not found'),
        memberCode
      });
      setLoading(false);
    }
  }, [playSound, t, attendanceAPI]);

  // Close dialog handler
  const handleCloseDialog = useCallback(() => {
    setShowMemberDialog(false);
    setMemberData(null);
    setActivityStates({});
    
    setTimeout(() => {
      isProcessingRef.current = false;
      lastScannedCodeRef.current = '';
    }, 300);
  }, []);

  // Auto-close after all active activities are recorded (no wrong-day or error pending)
  useEffect(() => {
    if (!showMemberDialog || !memberData || memberData.error || loading) return;
    const activeActivities = memberData.activeActivities || [];
    if (activeActivities.length === 0) return;

    const allRecorded = activeActivities.every(act => {
      const state = activityStates[act.activity_id];
      return (state && state.status === 'recorded') || act.recorded_today;
    });
    const hasWrongDay = Object.values(activityStates).some(s => s && s.status === 'wrong_day');
    const hasError = Object.values(activityStates).some(s => s && s.status === 'error');

    if (allRecorded && !hasWrongDay && !hasError) {
      const timer = setTimeout(() => {
        handleCloseDialog();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [activityStates, memberData, loading, showMemberDialog, handleCloseDialog]);

  // Handle check-in for a specific activity (with optional force override)
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
        playSound('error');
        setActivityStates(prev => ({
          ...prev,
          [activityId]: { status: 'recorded', message: t('مسجل مسبقاً اليوم ✓', 'Already checked in today ✓') }
        }));
        // Also mark in memberData
        setMemberData(prev => ({
          ...prev,
          activeActivities: prev.activeActivities.map(a =>
            a.activity_id === activityId ? { ...a, recorded_today: true } : a
          )
        }));
      } else if (res.data.status === 'wrong_day') {
        playSound('error');
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
        playSound(quotaWarn ? 'error' : 'success');
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
      playSound('error');
      const rawErr = error.response?.data?.detail;
      const errorMsg = typeof rawErr === 'string' ? rawErr : (rawErr?.msg || rawErr?.message || t('خطأ في التسجيل', 'Check-in error'));
      setActivityStates(prev => ({
        ...prev,
        [activityId]: { status: 'error', message: `❌ ${errorMsg}` }
      }));
    }
  }, [memberData, playSound, t]);

  // Keyboard listener - ALWAYS ACTIVE
  useEffect(() => {
    if (!enabled) return;
    
    const handleKeyDown = (e) => {
      const tagName = e.target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || e.target.isContentEditable) {
        return;
      }
      
      if (isProcessingRef.current) {
        e.preventDefault();
        bufferRef.current = '';
        return;
      }
      
      const now = Date.now();
      
      if (now - lastKeyTimeRef.current > 100 && bufferRef.current.length > 0) {
        bufferRef.current = '';
      }
      
      lastKeyTimeRef.current = now;
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      if (e.key === 'Enter') {
        const scannedCode = bufferRef.current.trim();
        if (scannedCode.length >= 3) {
          handleScan(scannedCode);
        }
        bufferRef.current = '';
        e.preventDefault();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        bufferRef.current += e.key;
        
        timeoutRef.current = setTimeout(() => {
          if (!isProcessingRef.current) {
            const code = bufferRef.current.trim();
            if (code.length >= 3) {
              handleScan(code);
            }
          }
          bufferRef.current = '';
        }, 50);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, handleScan]);

  if (!enabled) return null;

  return (
    <>
      {/* Scanner Status Indicator */}
      <div 
        style={{
          position: 'fixed',
          bottom: '30px',
          right: '30px',
          zIndex: 99999,
        }}
      >
        <button 
          onClick={() => setSoundEnabled(!soundEnabled)}
          style={{
            width: '70px',
            height: '70px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            border: '4px solid white',
            boxShadow: '0 4px 25px rgba(34, 197, 94, 0.6), 0 0 0 4px rgba(34, 197, 94, 0.2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'pulse 2s infinite',
          }}
          title={soundEnabled ? t('المسح نشط - اضغط لإيقاف الصوت', 'Scanner Active - Click to mute') : t('المسح نشط - اضغط لتفعيل الصوت', 'Scanner Active - Click to unmute')}
        >
          <Scan style={{ width: '32px', height: '32px', color: 'white' }} />
        </button>
        <div 
          style={{
            position: 'absolute',
            bottom: '-30px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1f2937',
            color: 'white',
            fontSize: '12px',
            padding: '6px 12px',
            borderRadius: '15px',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
            fontWeight: 'bold',
          }}
        >
          {soundEnabled ? '🔊' : '🔇'} {t('ماسح QR', 'QR Scanner')}
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 4px 25px rgba(34, 197, 94, 0.6); }
          50% { transform: scale(1.05); box-shadow: 0 4px 35px rgba(34, 197, 94, 0.8); }
        }
      `}</style>

      {/* Member Dialog */}
      <Dialog open={showMemberDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl">
          {loading ? (
            <div className="py-16 text-center">
              <div className="relative w-20 h-20 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full border-4 border-blue-100"></div>
                <Loader2 className="w-20 h-20 animate-spin text-blue-500" />
              </div>
              <p className="text-lg font-medium text-gray-500">{t('جاري البحث...', 'Searching...')}</p>
            </div>
          ) : memberData?.error ? (
            <div className="py-10 text-center px-6">
              <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center mb-4 shadow-inner">
                <X className="w-12 h-12 text-red-500" />
              </div>
              <p className="text-xl font-bold text-red-600 mb-1">{memberData.message}</p>
              {memberData.memberCode && (
                <p className="text-gray-400 text-sm font-mono">#{memberData.memberCode}</p>
              )}
            </div>
          ) : memberData ? (
            <div>
              {/* Member Header */}
              <div className="relative bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 px-6 pt-6 pb-10 text-center">
                <button
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="absolute top-3 left-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors"
                  title={soundEnabled ? t('إيقاف الصوت', 'Mute') : t('تفعيل الصوت', 'Unmute')}
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <div className="w-20 h-20 mx-auto rounded-full bg-white/20 backdrop-blur-sm border-3 border-white/40 flex items-center justify-center mb-3 shadow-lg">
                  <User className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">{memberData.name_ar || memberData.name}</h2>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1 bg-white/15 text-white/90 text-xs px-3 py-1 rounded-full backdrop-blur-sm">
                    <User className="w-3 h-3" />
                    #{memberData.member_code}
                  </span>
                  {memberData.phone && (
                    <span className="inline-flex items-center gap-1 bg-white/15 text-white/90 text-xs px-3 py-1 rounded-full backdrop-blur-sm" dir="ltr">
                      <Phone className="w-3 h-3" />
                      {memberData.phone}
                    </span>
                  )}
                </div>
              </div>

              {/* Content Area */}
              <div className="px-5 pb-5 -mt-5 space-y-4">

                {/* Member notes (admin-only) — shown in red as an alert */}
                {memberData.notes && memberData.notes.trim() && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3.5 flex items-start gap-2 shadow-sm">
                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-red-700 font-bold text-sm mb-1">
                        {t('ملاحظة هامة', 'Important note')}
                      </p>
                      <p className="text-red-800 text-sm whitespace-pre-wrap break-words">
                        {memberData.notes}
                      </p>
                    </div>
                  </div>
                )}

                {/* Active Activities */}
                {memberData.activeActivities?.length > 0 ? (
                  <div>
                    <h3 className="font-bold text-gray-700 mb-2.5 text-sm flex items-center gap-2">
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
                                ? 'bg-green-50 border-green-200'
                                : isWrongDay
                                ? 'bg-yellow-50 border-yellow-300'
                                : isError
                                ? 'bg-red-50 border-red-200'
                                : 'bg-white border-gray-100 hover:border-blue-300 hover:shadow-sm'
                            }`}
                          >
                            <div className="p-3.5 flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-base truncate">{act.activity_name}</p>
                                <div className="flex flex-col gap-1 mt-1">
                                  {act.schedule ? (
                                    <span className="text-xs text-gray-600 flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-blue-500 flex-shrink-0" />
                                      <span className="truncate" title={act.schedule}>{act.schedule}</span>
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-400 flex items-center gap-1">
                                      <Clock className="w-3 h-3 flex-shrink-0" />
                                      {t('لا يوجد جدول', 'No schedule')}
                                    </span>
                                  )}
                                  <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <Calendar className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                    <span>{t('ينتهي:', 'Ends:')} {act.end_date || '-'}</span>
                                  </span>
                                </div>
                              </div>
                              {isRecorded ? (
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center gap-1.5 bg-green-100 text-green-700 px-3 py-1.5 rounded-full flex-shrink-0">
                                    <Check className="w-4 h-4" />
                                    <span className="font-bold text-sm">{t('تم', 'Done')}</span>
                                  </div>
                                  {state.message && (
                                    <span className="text-xs text-green-600">{state.message}</span>
                                  )}
                                </div>
                              ) : isWrongDay ? (
                                <div className="flex items-center gap-1.5 bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full flex-shrink-0">
                                  <Clock className="w-4 h-4" />
                                  <span className="font-bold text-sm">{t('يوم خاطئ', 'Wrong day')}</span>
                                </div>
                              ) : isError ? (
                                <Button
                                  onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                                  size="sm"
                                  variant="outline"
                                  className="border-red-300 text-red-600 hover:bg-red-50 gap-1.5 rounded-full px-4 flex-shrink-0"
                                >
                                  {t('إعادة', 'Retry')}
                                </Button>
                              ) : (
                                <Button
                                  onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                                  disabled={isLoading}
                                  size="sm"
                                  className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 gap-1.5 rounded-full px-5 shadow-sm flex-shrink-0"
                                >
                                  {isLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Check className="w-4 h-4" />
                                  )}
                                  {t('تسجيل', 'Check-in')}
                                </Button>
                              )}
                            </div>

                            {/* Wrong Day Inline Warning */}
                            {isWrongDay && (
                              <div className="px-3.5 pb-3.5 space-y-2">
                                <div className="bg-yellow-100/80 p-3 rounded-lg border border-yellow-200">
                                  <p className="text-yellow-800 font-bold text-sm mb-1">
                                    ⚠️ {state.message}
                                  </p>
                                  <p className="text-xs text-yellow-700">
                                    {t('مواعيدك:', 'Your days:')} <span className="font-semibold">{state.scheduleDays?.join(' - ')}</span>
                                  </p>
                                </div>
                                <Button
                                  onClick={() => handleCheckin(act.activity_id, act.activity_name, true)}
                                  disabled={isLoading}
                                  variant="outline"
                                  className="w-full border-yellow-400 text-yellow-800 hover:bg-yellow-100 gap-2 h-10 rounded-lg"
                                >
                                  {isLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Check className="w-4 h-4" />
                                  )}
                                  {t('تسجيل حضور رغم ذلك', 'Check-in anyway')}
                                </Button>
                              </div>
                            )}

                            {/* Error message */}
                            {isError && (
                              <div className="px-3.5 pb-3.5">
                                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{state.message}</p>
                              </div>
                            )}

                            {/* Wrong-day informational notice (check-in still saved) */}
                            {isRecorded && state.wrongDayWarning && (
                              <div className="px-3.5 pb-3.5">
                                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                                  <p className="text-yellow-800 font-bold text-sm mb-1">
                                    {state.wrongDayWarning.message}
                                  </p>
                                  <p className="text-xs text-yellow-700">
                                    {t('مواعيدك:', 'Your days:')} <span className="font-semibold">{state.wrongDayWarning.schedule_days?.join(' - ')}</span>
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Session Quota */}
                            {isRecorded && state.sessionQuotaWarning && (
                              <div className="px-3.5 pb-3.5">
                                <div className="bg-amber-100/80 p-3 rounded-lg border border-amber-200">
                                  {state.sessionQuotaWarning.message && (
                                    <p className="text-amber-900 font-bold text-sm mb-2">
                                      {state.sessionQuotaWarning.message}
                                    </p>
                                  )}
                                  <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="bg-white/60 rounded-md p-1.5">
                                      <p className="text-lg font-bold text-amber-700">{state.sessionQuotaWarning.used}</p>
                                      <p className="text-[10px] text-amber-600">{t('مستخدم', 'Used')}</p>
                                    </div>
                                    <div className="bg-white/60 rounded-md p-1.5">
                                      <p className="text-lg font-bold text-amber-700">{state.sessionQuotaWarning.total}</p>
                                      <p className="text-[10px] text-amber-600">{t('الإجمالي', 'Total')}</p>
                                    </div>
                                    <div className="bg-white/60 rounded-md p-1.5">
                                      <p className="text-lg font-bold text-amber-700">{state.sessionQuotaWarning.remaining ?? 0}</p>
                                      <p className="text-[10px] text-amber-600">{t('متبقي', 'Left')}</p>
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
                  <div className="text-center py-6 bg-orange-50 rounded-xl border border-orange-100">
                    <AlertTriangle className="w-10 h-10 mx-auto text-orange-400 mb-2" />
                    <p className="font-bold text-orange-700 text-sm">
                      {t('لا توجد اشتراكات نشطة', 'No active subscriptions')}
                    </p>
                  </div>
                )}

                {/* Expired Activities */}
                {memberData.expiredActivities?.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-400 mb-2 text-xs flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {t('اشتراكات منتهية', 'Expired Subscriptions')}
                    </h3>
                    <div className="space-y-1.5">
                      {memberData.expiredActivities.map((act, idx) => (
                        <div key={idx} className="p-2.5 bg-gray-50 rounded-lg text-sm flex justify-between items-center border border-gray-100">
                          <span className="text-gray-500 truncate">{act.activity_name}</span>
                          <Badge className="bg-red-50 text-red-500 border-red-100 text-[10px] px-2 flex-shrink-0">
                            {t('منتهي', 'Expired')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GlobalScanner;
