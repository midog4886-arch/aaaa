/**
 * Global QR Scanner Component
 * مكون المسح العام - يعمل في جميع الصفحات
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import { 
  Scan, Check, X, User, Calendar, Clock, Activity, 
  Volume2, VolumeX, Settings, Loader2 
} from 'lucide-react';
import { attendanceAPI, activitiesAPI } from '../services/api';

const GlobalScanner = ({ enabled = true, language = 'ar' }) => {
  const t = (ar, en) => language === 'ar' ? ar : en;
  
  // States
  const [isActive, setIsActive] = useState(false);
  const [activities, setActivities] = useState([]);
  const [selectedActivityId, setSelectedActivityId] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Scanner buffer
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const timeoutRef = useRef(null);

  // Load activities
  useEffect(() => {
    const loadActivities = async () => {
      try {
        const res = await activitiesAPI.getAll();
        setActivities(res.data || []);
        
        // Load saved settings
        const savedActivityId = localStorage.getItem('globalScanner_activityId');
        const savedSound = localStorage.getItem('globalScanner_sound');
        const savedActive = localStorage.getItem('globalScanner_active');
        
        if (savedActivityId) setSelectedActivityId(savedActivityId);
        if (savedSound !== null) setSoundEnabled(savedSound === 'true');
        if (savedActive === 'true') setIsActive(true);
      } catch (error) {
        console.error('Failed to load activities');
      }
    };
    loadActivities();
  }, []);

  // Save settings
  useEffect(() => {
    localStorage.setItem('globalScanner_activityId', selectedActivityId);
    localStorage.setItem('globalScanner_sound', soundEnabled.toString());
    localStorage.setItem('globalScanner_active', isActive.toString());
  }, [selectedActivityId, soundEnabled, isActive]);

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

  // Handle check-in
  const handleCheckin = useCallback(async (memberCode) => {
    if (!memberCode || !selectedActivityId) {
      playSound('error');
      setScanResult({
        success: false,
        message: t('⚠️ يرجى اختيار النشاط أولاً', '⚠️ Please select an activity first'),
        memberCode
      });
      setShowResult(true);
      return;
    }
    
    playSound('scan');
    setLoading(true);
    setShowResult(true);
    setScanResult(null);
    
    try {
      const res = await attendanceAPI.qrCheckin(memberCode, selectedActivityId);
      
      const activityName = activities.find(a => a.id === selectedActivityId)?.name_ar || '';
      
      if (res.data.status === 'already_checked_in') {
        playSound('error');
        setScanResult({
          success: false,
          alreadyCheckedIn: true,
          memberName: res.data.member?.name || res.data.member_name || memberCode,
          memberCode: res.data.member?.member_code || memberCode,
          activityName,
          message: t('⚠️ مسجل مسبقاً اليوم', '⚠️ Already checked in today'),
          time: new Date().toLocaleTimeString('ar-SA')
        });
      } else {
        playSound('success');
        setScanResult({
          success: true,
          memberName: res.data.member_name || memberCode,
          memberCode: res.data.member_code || memberCode,
          activityName,
          message: t('✅ تم تسجيل الحضور بنجاح', '✅ Check-in successful'),
          time: new Date().toLocaleTimeString('ar-SA')
        });
      }
    } catch (error) {
      playSound('error');
      const errorMsg = error.response?.data?.detail || t('خطأ في التسجيل', 'Check-in error');
      setScanResult({
        success: false,
        memberCode,
        message: `❌ ${errorMsg}`,
        time: new Date().toLocaleTimeString('ar-SA')
      });
    } finally {
      setLoading(false);
    }
  }, [selectedActivityId, activities, playSound, t]);

  // Keyboard listener for scanner
  useEffect(() => {
    if (!isActive || !enabled) return;
    
    const handleKeyDown = (e) => {
      // Ignore if typing in input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      
      const now = Date.now();
      
      // Reset buffer if too much time passed (manual typing)
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
          handleCheckin(scannedCode);
        }
        bufferRef.current = '';
        e.preventDefault();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        bufferRef.current += e.key;
        
        // Auto-process after brief pause
        timeoutRef.current = setTimeout(() => {
          const code = bufferRef.current.trim();
          if (code.length >= 3) {
            handleCheckin(code);
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
  }, [isActive, enabled, handleCheckin]);

  // Auto-close result after delay
  useEffect(() => {
    if (showResult && scanResult && !loading) {
      const timer = setTimeout(() => {
        setShowResult(false);
        setScanResult(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [showResult, scanResult, loading]);

  if (!enabled) return null;

  return (
    <>
      {/* Scanner Status Indicator - Fixed Position */}
      <div className="fixed bottom-20 left-4 z-50 flex flex-col gap-2">
        {/* Settings Button */}
        <Button
          size="icon"
          variant="outline"
          onClick={() => setShowSettings(true)}
          className="w-12 h-12 rounded-full shadow-lg bg-white hover:bg-gray-50"
          title={t('إعدادات المسح', 'Scanner Settings')}
        >
          <Settings className="w-5 h-5" />
        </Button>
        
        {/* Scanner Status Button */}
        <Button
          size="icon"
          onClick={() => isActive ? setIsActive(false) : setShowSettings(true)}
          className={`w-12 h-12 rounded-full shadow-lg transition-all ${
            isActive 
              ? 'bg-green-500 hover:bg-green-600 animate-pulse' 
              : 'bg-gray-400 hover:bg-gray-500'
          }`}
          title={isActive ? t('إيقاف المسح', 'Stop Scanner') : t('تفعيل المسح', 'Activate Scanner')}
        >
          <Scan className="w-6 h-6 text-white" />
        </Button>
      </div>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Scan className="w-6 h-6" />
              {t('إعدادات المسح العام', 'Global Scanner Settings')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Activity Selection */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                {t('النشاط الافتراضي للتسجيل', 'Default Activity for Check-in')}
              </label>
              <Select value={selectedActivityId} onValueChange={setSelectedActivityId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('اختر النشاط', 'Select Activity')} />
                </SelectTrigger>
                <SelectContent>
                  {activities.map(activity => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {activity.name_ar || activity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sound Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3">
                {soundEnabled ? <Volume2 className="w-5 h-5 text-blue-600" /> : <VolumeX className="w-5 h-5 text-gray-400" />}
                <span className="font-medium">{t('صوت التنبيه', 'Alert Sound')}</span>
              </div>
              <Button
                variant={soundEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSoundEnabled(!soundEnabled)}
              >
                {soundEnabled ? t('مفعّل', 'On') : t('مغلق', 'Off')}
              </Button>
            </div>

            {/* Activation */}
            {!isActive ? (
              <Button
                onClick={() => {
                  if (selectedActivityId) {
                    setIsActive(true);
                    setShowSettings(false);
                    toast.success(t('تم تفعيل المسح العام', 'Global Scanner Activated'));
                  } else {
                    toast.error(t('يرجى اختيار النشاط أولاً', 'Please select an activity first'));
                  }
                }}
                disabled={!selectedActivityId}
                className="w-full py-6 text-lg gap-3 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600"
              >
                <Scan className="w-6 h-6" />
                {t('تفعيل المسح العام', 'Activate Global Scanner')}
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setIsActive(false);
                  setShowSettings(false);
                  toast.info(t('تم إيقاف المسح العام', 'Global Scanner Deactivated'));
                }}
                variant="destructive"
                className="w-full py-6 text-lg gap-3"
              >
                <X className="w-6 h-6" />
                {t('إيقاف المسح العام', 'Deactivate Global Scanner')}
              </Button>
            )}

            {/* Status */}
            {isActive && (
              <div className="flex items-center justify-center gap-2 p-3 bg-green-50 text-green-700 rounded-xl">
                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                <span className="font-medium">{t('المسح نشط - جاهز للاستخدام', 'Scanner Active - Ready')}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Result Dialog */}
      <Dialog open={showResult} onOpenChange={setShowResult}>
        <DialogContent className={`max-w-md border-4 ${scanResult?.success ? 'border-green-500' : 'border-red-500'}`}>
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-16 h-16 mx-auto animate-spin text-blue-500" />
              <p className="mt-4 text-lg text-gray-600">{t('جاري التحقق...', 'Checking...')}</p>
            </div>
          ) : scanResult ? (
            <div className="py-6">
              {/* Status Icon */}
              <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-6 ${
                scanResult.success ? 'bg-green-500' : scanResult.alreadyCheckedIn ? 'bg-orange-500' : 'bg-red-500'
              }`}>
                {scanResult.success ? (
                  <Check className="w-12 h-12 text-white" />
                ) : (
                  <X className="w-12 h-12 text-white" />
                )}
              </div>

              {/* Member Info */}
              <div className="text-center space-y-3">
                {scanResult.memberName && (
                  <h2 className="text-2xl font-bold text-gray-800">
                    {scanResult.memberName}
                  </h2>
                )}
                
                {scanResult.memberCode && (
                  <Badge variant="outline" className="text-lg px-4 py-1">
                    <User className="w-4 h-4 ml-2" />
                    #{scanResult.memberCode}
                  </Badge>
                )}

                {scanResult.activityName && (
                  <div className="flex items-center justify-center gap-2 text-gray-600">
                    <Activity className="w-4 h-4" />
                    {scanResult.activityName}
                  </div>
                )}

                <p className={`text-xl font-bold ${
                  scanResult.success ? 'text-green-600' : scanResult.alreadyCheckedIn ? 'text-orange-600' : 'text-red-600'
                }`}>
                  {scanResult.message}
                </p>

                <div className="flex items-center justify-center gap-2 text-gray-500 text-sm">
                  <Clock className="w-4 h-4" />
                  {scanResult.time}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GlobalScanner;
