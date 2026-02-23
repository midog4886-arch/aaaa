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
  const [checkingIn, setCheckingIn] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  
  // Scanner buffer
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const timeoutRef = useRef(null);
  const isProcessingRef = useRef(false); // Lock to prevent multiple dialogs
  const lastScannedCodeRef = useRef(''); // Track last scanned code
  const scanLockTimeRef = useRef(0); // Timestamp lock

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
  // Now QR codes contain just the member code number (e.g., "2620")
  const extractMemberCode = (scannedData) => {
    if (!scannedData) return null;
    
    let data = scannedData.trim();
    
    // If it's just a number, return it directly
    if (/^\d+$/.test(data)) {
      return data;
    }
    
    // Legacy support: Try to extract from old JSON format
    try {
      const parsed = JSON.parse(data);
      if (parsed.code) return parsed.code.toString();
      if (parsed.member_code) return parsed.member_code.toString();
    } catch (e) {
      // Not JSON
    }
    
    // Extract any number sequence
    const numberMatch = data.match(/(\d{3,6})/);
    if (numberMatch) return numberMatch[1];
    
    return null;
  };

  // Fetch member data and show dialog
  const handleScan = useCallback(async (scannedData) => {
    if (!scannedData) return;
    
    const now = Date.now();
    
    // Extract member code from scanned data
    const memberCode = extractMemberCode(scannedData);
    
    if (!memberCode) return;
    
    // STRICT LOCK: Block if already processing or if scanned within last 2 seconds
    if (isProcessingRef.current) {
      console.log('🚫 Scan blocked - already processing');
      bufferRef.current = '';
      return;
    }
    
    // Block rapid successive scans (within 2 seconds)
    if (now - scanLockTimeRef.current < 2000) {
      console.log('🚫 Scan blocked - too fast');
      bufferRef.current = '';
      return;
    }
    
    // Lock immediately with timestamp
    isProcessingRef.current = true;
    scanLockTimeRef.current = now;
    lastScannedCodeRef.current = memberCode;
    
    // Close any existing dialog FIRST and wait
    setShowMemberDialog(false);
    setMemberData(null);
    setLastResult(null);
    
    // Wait for dialog to fully close
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Double-check lock is still ours
    if (lastScannedCodeRef.current !== memberCode) {
      isProcessingRef.current = false;
      return;
    }
    
    playSound('scan');
    setLoading(true);
    setShowMemberDialog(true);
    
    try {
      const API_URL = '';
      const response = await fetch(`${API_URL}/api/public/member-card/${memberCode}`);
      
      if (!response.ok) {
        throw new Error('Member not found');
      }
      
      const data = await response.json();
      
      // Separate active and expired activities
      const allActivities = data.activities || [];
      const activeActivities = allActivities.filter(a => a.status === 'active');
      const expiredActivities = allActivities.filter(a => a.status === 'expired');
      
      const mData = {
        ...data,
        activeActivities,
        expiredActivities
      };
      setMemberData(mData);
      
      if (activeActivities.length === 0) {
        playSound('error');
      } else {
        const unrecorded = activeActivities.filter(a => !a.recorded_today);
        if (unrecorded.length > 0) {
          const act = unrecorded[0];
          setCheckingIn(true);
          try {
            const token = localStorage.getItem('token');
            const memberCode2 = data.member_code || data.id;
            const checkinUrl = `/api/attendance/qr-checkin?member_code=${encodeURIComponent(memberCode2)}&activity_id=${encodeURIComponent(act.activity_id)}`;
            const checkinRes = await fetch(checkinUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const checkinData = await checkinRes.json();
            
            if (checkinData.status === 'success') {
              playSound(checkinData.session_quota_warning ? 'error' : 'success');
              const quotaWarn = checkinData.session_quota_warning;
              setLastResult({
                success: true,
                activityName: act.activity_name,
                message: t('✅ تم تسجيل الحضور بنجاح', '✅ Check-in successful'),
                sessionQuotaWarning: quotaWarn || null
              });
              setMemberData(prev => ({
                ...prev,
                activeActivities: prev.activeActivities.map(a =>
                  a.activity_id === act.activity_id ? { ...a, recorded_today: true } : a
                )
              }));
            } else if (checkinData.status === 'wrong_day') {
              playSound('error');
              setLastResult({
                success: false,
                wrongDay: true,
                activityId: act.activity_id,
                activityName: act.activity_name,
                scheduleDays: checkinData.schedule_days || [],
                today: checkinData.today,
                message: checkinData.message || t('هذا ليس موعدك اليوم!', 'This is not your scheduled day!')
              });
            } else if (checkinData.status === 'already_checked_in') {
              playSound('error');
              setLastResult({
                success: false,
                alreadyCheckedIn: true,
                activityName: act.activity_name,
                message: t('⚠️ مسجل مسبقاً اليوم', '⚠️ Already checked in today')
              });
            }
          } catch (e) {
            console.log('Auto check-in failed:', e);
          } finally {
            setCheckingIn(false);
          }
        }
      }
      
    } catch (error) {
      playSound('error');
      setMemberData({
        error: true,
        message: t('⚠️ رقم العضوية غير موجود', '⚠️ Member ID not found'),
        memberCode
      });
    } finally {
      setLoading(false);
      // Keep lock active while dialog is open - unlock only when dialog closes
    }
  }, [playSound, t]);

  // Close dialog handler - UNLOCK here
  const handleCloseDialog = useCallback(() => {
    setShowMemberDialog(false);
    setMemberData(null);
    setLastResult(null);
    
    // Unlock after dialog closes with delay to prevent immediate re-scan
    setTimeout(() => {
      isProcessingRef.current = false;
      lastScannedCodeRef.current = '';
    }, 300);
  }, []);

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
        playSound('error');
        setLastResult({
          success: false,
          alreadyCheckedIn: true,
          activityName,
          message: t('⚠️ مسجل مسبقاً اليوم', '⚠️ Already checked in today')
        });
      } else if (res.data.status === 'wrong_day') {
        playSound('error');
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
        const quotaWarn = res.data.session_quota_warning;
        playSound(quotaWarn ? 'error' : 'success');
        setLastResult({
          success: true,
          activityName,
          message: t('✅ تم تسجيل الحضور بنجاح', '✅ Check-in successful'),
          sessionQuotaWarning: quotaWarn || null
        });
        
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
      setLastResult({
        success: false,
        activityName,
        message: `❌ ${errorMsg}`
      });
    } finally {
      setCheckingIn(false);
    }
  }, [memberData, playSound, t]);

  // Keyboard listener - ALWAYS ACTIVE
  useEffect(() => {
    if (!enabled) return;
    
    const handleKeyDown = (e) => {
      // Ignore if typing in input/textarea/select
      const tagName = e.target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || e.target.isContentEditable) {
        return;
      }
      
      // Block scanning if already processing (prevents multiple dialogs)
      if (isProcessingRef.current) {
        e.preventDefault();
        bufferRef.current = '';
        return;
      }
      
      const now = Date.now();
      
      // Reset buffer if too much time passed (manual typing vs scanner)
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
        
        // Auto-process after brief pause
        timeoutRef.current = setTimeout(() => {
          // Double-check we're not processing before auto-scan
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
      {/* Scanner Status Indicator - Always visible floating button */}
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
      
      {/* Pulse animation style */}
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
              {/* Member Header - Gradient Banner */}
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
                {/* Result Banner */}
                {lastResult && (
                  <div className={`rounded-xl shadow-md overflow-hidden ${
                    lastResult.success && lastResult.sessionQuotaWarning
                      ? 'bg-amber-50 ring-2 ring-amber-300'
                      : lastResult.success 
                      ? 'bg-green-50 ring-2 ring-green-300' 
                      : lastResult.wrongDay
                        ? 'bg-yellow-50 ring-2 ring-yellow-300'
                        : lastResult.alreadyCheckedIn 
                          ? 'bg-orange-50 ring-2 ring-orange-300'
                          : 'bg-red-50 ring-2 ring-red-300'
                  }`}>
                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                          lastResult.success && lastResult.sessionQuotaWarning ? 'bg-amber-200'
                            : lastResult.success ? 'bg-green-200' 
                            : lastResult.wrongDay ? 'bg-yellow-200'
                            : 'bg-red-200'
                        }`}>
                          {lastResult.success && lastResult.sessionQuotaWarning ? (
                            <AlertTriangle className="w-6 h-6 text-amber-600" />
                          ) : lastResult.success ? (
                            <Check className="w-6 h-6 text-green-600" />
                          ) : lastResult.wrongDay ? (
                            <Clock className="w-6 h-6 text-yellow-600" />
                          ) : (
                            <X className="w-6 h-6 text-red-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold text-base ${
                            lastResult.success && lastResult.sessionQuotaWarning ? 'text-amber-800'
                              : lastResult.success ? 'text-green-800' 
                              : lastResult.wrongDay ? 'text-yellow-800'
                              : 'text-red-800'
                          }`}>
                            {lastResult.wrongDay ? lastResult.message : lastResult.message}
                          </p>
                          <p className="text-sm text-gray-500 truncate">{lastResult.activityName}</p>
                        </div>
                      </div>
                    </div>
                    {lastResult.sessionQuotaWarning && (
                      <div className="px-4 pb-4">
                        <div className="bg-amber-100/80 p-3 rounded-lg border border-amber-200">
                          <p className="text-amber-900 font-bold text-sm mb-2">
                            {lastResult.sessionQuotaWarning.message}
                          </p>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-white/60 rounded-md p-1.5">
                              <p className="text-lg font-bold text-amber-700">{lastResult.sessionQuotaWarning.used}</p>
                              <p className="text-[10px] text-amber-600">{t('مستخدم', 'Used')}</p>
                            </div>
                            <div className="bg-white/60 rounded-md p-1.5">
                              <p className="text-lg font-bold text-amber-700">{lastResult.sessionQuotaWarning.total}</p>
                              <p className="text-[10px] text-amber-600">{t('الإجمالي', 'Total')}</p>
                            </div>
                            <div className="bg-white/60 rounded-md p-1.5">
                              <p className="text-lg font-bold text-amber-700">{lastResult.sessionQuotaWarning.remaining ?? 0}</p>
                              <p className="text-[10px] text-amber-600">{t('متبقي', 'Left')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {lastResult.wrongDay && (
                      <div className="px-4 pb-4">
                        <div className="bg-yellow-100/80 p-3 rounded-lg border border-yellow-200 mb-3">
                          <p className="text-sm text-yellow-800 font-medium">
                            {t('مواعيدك:', 'Your days:')} {lastResult.scheduleDays?.join(' - ')}
                          </p>
                        </div>
                        <Button
                          onClick={() => handleCheckin(lastResult.activityId, lastResult.activityName, true)}
                          disabled={checkingIn}
                          variant="outline"
                          className="w-full border-yellow-400 text-yellow-800 hover:bg-yellow-100 gap-2 h-11 rounded-lg"
                        >
                          {checkingIn ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          {t('تسجيل حضور رغم ذلك', 'Check-in anyway')}
                        </Button>
                      </div>
                    )}
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
                    <div className="space-y-2">
                      {memberData.activeActivities.map((act, idx) => (
                        <div 
                          key={idx}
                          className={`p-3.5 rounded-xl border-2 transition-all ${
                            act.recorded_today 
                              ? 'bg-green-50 border-green-200' 
                              : 'bg-white border-gray-100 hover:border-blue-300 hover:shadow-sm'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-base truncate">{act.activity_name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {act.end_date || '-'}
                                </span>
                              </div>
                            </div>
                            {act.recorded_today ? (
                              <div className="flex items-center gap-1.5 bg-green-100 text-green-700 px-3 py-1.5 rounded-full flex-shrink-0">
                                <Check className="w-4 h-4" />
                                <span className="font-bold text-sm">{t('تم', 'Done')}</span>
                              </div>
                            ) : (
                              <Button
                                onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                                disabled={checkingIn}
                                size="sm"
                                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 gap-1.5 rounded-full px-5 shadow-sm flex-shrink-0"
                              >
                                {checkingIn ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4" />
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
