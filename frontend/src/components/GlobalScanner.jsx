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
  Volume2, VolumeX, Loader2, Calendar, Phone
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

  // Fetch member data and show dialog - AUTO CHECK-IN if subscription is active
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
      const API_URL = process.env.REACT_APP_BACKEND_URL;
      const response = await fetch(`${API_URL}/api/public/member-card/${memberCode}`);
      
      if (!response.ok) {
        throw new Error('Member not found');
      }
      
      const data = await response.json();
      
      // Separate active and expired activities
      const allActivities = data.activities || [];
      const activeActivities = allActivities.filter(a => a.status === 'active');
      const expiredActivities = allActivities.filter(a => a.status === 'expired');
      
      // Update member data first
      const updatedMemberData = {
        ...data,
        activeActivities,
        expiredActivities
      };
      setMemberData(updatedMemberData);
      setLoading(false);
      
      // AUTO CHECK-IN: If member has active subscriptions, auto check-in
      if (activeActivities.length > 0) {
        // Find first activity that is not already recorded today
        const activityToCheckin = activeActivities.find(a => !a.recorded_today);
        
        if (activityToCheckin) {
          // Auto check-in for the first unrecorded active activity
          setCheckingIn(true);
          try {
            const checkinRes = await attendanceAPI.qrCheckin(
              data.member_code || data.id, 
              activityToCheckin.activity_id
            );
            
            if (checkinRes.data.status === 'already_checked_in') {
              playSound('error');
              setLastResult({
                success: false,
                alreadyCheckedIn: true,
                activityName: activityToCheckin.activity_name,
                message: t('⚠️ مسجل مسبقاً اليوم', '⚠️ Already checked in today')
              });
            } else {
              playSound('success');
              setLastResult({
                success: true,
                activityName: activityToCheckin.activity_name,
                message: t('✅ تم تسجيل الحضور تلقائياً', '✅ Auto check-in successful')
              });
              
              // Update activity status in member data
              setMemberData(prev => ({
                ...prev,
                activeActivities: prev.activeActivities.map(a =>
                  a.activity_id === activityToCheckin.activity_id ? { ...a, recorded_today: true } : a
                )
              }));
            }
          } catch (error) {
            playSound('error');
            let errorMsg = error.response?.data?.detail || t('خطأ في التسجيل التلقائي', 'Auto check-in error');
            // Ensure errorMsg is a string
            if (typeof errorMsg === 'object') {
              errorMsg = errorMsg.msg || errorMsg.message || JSON.stringify(errorMsg);
            }
            setLastResult({
              success: false,
              activityName: activityToCheckin.activity_name,
              message: `❌ ${String(errorMsg)}`
            });
          } finally {
            setCheckingIn(false);
          }
        } else {
          // All activities already recorded today
          playSound('success');
          setLastResult({
            success: true,
            alreadyCheckedIn: true,
            activityName: activeActivities[0]?.activity_name,
            message: t('✅ جميع الأنشطة مسجلة اليوم', '✅ All activities recorded today')
          });
        }
      } else {
        // No active subscriptions
        playSound('error');
      }
      
    } catch (error) {
      playSound('error');
      setMemberData({
        error: true,
        message: t('⚠️ رقم العضوية غير موجود', '⚠️ Member ID not found'),
        memberCode
      });
      setLoading(false);
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

  // Handle check-in for specific activity
  const handleCheckin = useCallback(async (activityId, activityName) => {
    if (!memberData || !activityId) return;
    
    setCheckingIn(true);
    
    try {
      const res = await attendanceAPI.qrCheckin(
        memberData.member_code || memberData.id, 
        activityId
      );
      
      if (res.data.status === 'already_checked_in') {
        playSound('error');
        setLastResult({
          success: false,
          alreadyCheckedIn: true,
          activityName,
          message: t('⚠️ مسجل مسبقاً اليوم', '⚠️ Already checked in today')
        });
      } else {
        playSound('success');
        setLastResult({
          success: true,
          activityName,
          message: t('✅ تم تسجيل الحضور بنجاح', '✅ Check-in successful')
        });
        
        // Update activity status in member data
        setMemberData(prev => ({
          ...prev,
          activeActivities: prev.activeActivities.map(a =>
            a.activity_id === activityId ? { ...a, recorded_today: true } : a
          )
        }));
      }
    } catch (error) {
      playSound('error');
      const errorMsg = error.response?.data?.detail || t('خطأ في التسجيل', 'Check-in error');
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
        <DialogContent className="max-w-lg">
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-16 h-16 mx-auto animate-spin text-blue-500" />
              <p className="mt-4 text-lg text-gray-600">{t('جاري البحث...', 'Searching...')}</p>
            </div>
          ) : memberData?.error ? (
            // Error State
            <div className="py-8 text-center">
              <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
                <X className="w-10 h-10 text-red-500" />
              </div>
              <p className="text-xl font-bold text-red-600">{memberData.message}</p>
              {memberData.memberCode && (
                <p className="text-gray-500 mt-2">#{memberData.memberCode}</p>
              )}
            </div>
          ) : memberData ? (
            // Member Found
            <div className="space-y-6">
              {/* Member Header */}
              <div className="text-center border-b pb-4">
                <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center mb-3">
                  <User className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800">{memberData.name_ar || memberData.name}</h2>
                <div className="flex items-center justify-center gap-4 mt-2 text-sm text-gray-500">
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

              {/* Sound Toggle */}
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  {t('الصوت', 'Sound')}
                </span>
                <Button
                  variant={soundEnabled ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                >
                  {soundEnabled ? t('مفعّل', 'On') : t('مغلق', 'Off')}
                </Button>
              </div>

              {/* Last Result */}
              {lastResult && (
                <div className={`p-4 rounded-xl border-2 ${
                  lastResult.success 
                    ? 'bg-green-50 border-green-300' 
                    : lastResult.alreadyCheckedIn 
                      ? 'bg-orange-50 border-orange-300'
                      : 'bg-red-50 border-red-300'
                }`}>
                  <div className="flex items-center gap-3">
                    {lastResult.success ? (
                      <Check className="w-8 h-8 text-green-500" />
                    ) : (
                      <X className="w-8 h-8 text-red-500" />
                    )}
                    <div>
                      <p className={`font-bold ${
                        lastResult.success ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {lastResult.message}
                      </p>
                      <p className="text-sm text-gray-500">{lastResult.activityName}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Active Activities */}
              {memberData.activeActivities?.length > 0 ? (
                <div>
                  <h3 className="font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-600" />
                    {t('الاشتراكات النشطة', 'Active Subscriptions')}
                  </h3>
                  <div className="space-y-2">
                    {memberData.activeActivities.map((act, idx) => (
                      <div 
                        key={idx}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          act.recorded_today 
                            ? 'bg-green-50 border-green-300' 
                            : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold text-lg">{act.activity_name}</p>
                            <p className="text-sm text-gray-500 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {t('ينتهي:', 'Expires:')} {act.end_date || '-'}
                            </p>
                          </div>
                          {act.recorded_today ? (
                            <div className="flex items-center gap-2 text-green-600">
                              <Check className="w-6 h-6" />
                              <span className="font-bold">{t('مسجل ✓', 'Recorded ✓')}</span>
                            </div>
                          ) : (
                            <Button
                              onClick={() => handleCheckin(act.activity_id, act.activity_name)}
                              disabled={checkingIn}
                              className="bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 gap-2"
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
                <div className="text-center py-6 bg-orange-50 rounded-xl">
                  <X className="w-12 h-12 mx-auto text-orange-500 mb-2" />
                  <p className="font-bold text-orange-700">
                    {t('⚠️ لا توجد اشتراكات نشطة', '⚠️ No active subscriptions')}
                  </p>
                </div>
              )}

              {/* Expired Activities */}
              {memberData.expiredActivities?.length > 0 && (
                <div>
                  <h3 className="font-bold text-gray-500 mb-2 text-sm">
                    {t('اشتراكات منتهية', 'Expired Subscriptions')}
                  </h3>
                  <div className="space-y-1">
                    {memberData.expiredActivities.map((act, idx) => (
                      <div key={idx} className="p-2 bg-red-50 rounded-lg text-sm flex justify-between items-center">
                        <span className="text-red-700">{act.activity_name}</span>
                        <Badge variant="destructive" className="text-xs">
                          {t('منتهي', 'Expired')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GlobalScanner;
