import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { activitiesAPI, attendanceAPI, branchesAPI, schedulesAPI, levelsAPI } from '../services/api';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Check, X, Users, Calendar, QrCode, FileSpreadsheet, FileText, Search, Clock, UserCheck, UserX, CalendarDays, Zap, Hash, Camera, CameraOff, Scan, Volume2, VolumeX } from 'lucide-react';
import MemberAvatar from '../components/MemberAvatar';

const ACTIVITY_CATEGORIES = [
  { id: 'swimming', name: '🏊 السباحة', keywords: ['سباح', 'swim'] },
  { id: 'football', name: '⚽ كرة القدم', keywords: ['قدم', 'كرة', 'foot'] },
  { id: 'karate', name: '🥋 الكاراتيه', keywords: ['كارات', 'karate'] },
  { id: 'gymnastics', name: '🤸 الجمباز', keywords: ['جمباز', 'gym'] },
];

export default function AttendancePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState(searchParams.get('activity_id') || '');
  const [selectedCategory, setSelectedCategory] = useState(''); // Category state for grouped activities
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceData, setAttendanceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState({});
  const [todaySessions, setTodaySessions] = useState([]);
  
  // Quick Registration State
  const [quickMemberCode, setQuickMemberCode] = useState('');
  const [quickSearchResult, setQuickSearchResult] = useState(null);
  const [quickSearching, setQuickSearching] = useState(false);
  const [quickRegistering, setQuickRegistering] = useState(false);
  const [quickSearchResults, setQuickSearchResults] = useState([]); // Multiple results
  
  // QR Scanner Dialog
  const [isQRDialogOpen, setIsQRDialogOpen] = useState(false);
  const [qrActivityId, setQrActivityId] = useState('');
  const [qrScanResult, setQrScanResult] = useState(null);
  const [manualMemberId, setManualMemberId] = useState('');
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [qrMemberData, setQrMemberData] = useState(null); // Member data with activities after QR scan
  const [qrCoachResult, setQrCoachResult] = useState(null); // Coach data after QR scan
  const [qrLoading, setQrLoading] = useState(false);
  const scannerRef = useRef(null);
  
  // Kiosk Mode (USB Scanner) State
  const [kioskMode, setKioskMode] = useState(false);
  const [kioskBuffer, setKioskBuffer] = useState('');
  const [kioskLastKeyTime, setKioskLastKeyTime] = useState(0);
  const [kioskActivityId, setKioskActivityId] = useState('');
  const [kioskCategoryId, setKioskCategoryId] = useState(''); // category-based selection
  const [kioskLastScan, setKioskLastScan] = useState(null);
  const [kioskSoundEnabled, setKioskSoundEnabled] = useState(true);
  const kioskBufferRef = useRef('');
  const kioskTimeoutRef = useRef(null);
  
  // Report Dialog
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportType, setReportType] = useState('activity');
  const [reportDateRange, setReportDateRange] = useState({ start: '', end: '' });

  // Level filter for attendance export (reports tab)
  const [reportLevels, setReportLevels] = useState([]);
  const [reportSelectedLevelId, setReportSelectedLevelId] = useState('');

  // Tab state
  const [activeTab, setActiveTab] = useState('quick'); // quick, record, qr, kiosk, reports

  // Day mapping for today's sessions
  const dayMap = {
    0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
    4: 'thursday', 5: 'friday', 6: 'saturday'
  };

  // Fetch today's sessions from schedule
  const fetchTodaySessions = useCallback(async () => {
    try {
      const params = {};
      if (selectedBranchId) params.branch_id = selectedBranchId;
      const res = await schedulesAPI.getWeekly(params);
      const today = dayMap[new Date().getDay()];
      setTodaySessions(res.data[today] || []);
    } catch (error) {
      console.error('Error fetching today sessions:', error);
    }
  }, [selectedBranchId]);

  // Fetch activities and branches
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [activitiesRes, branchesRes] = await Promise.all([
          activitiesAPI.getAll(),
          branchesAPI.getAll()
        ]);
        setActivities(activitiesRes.data);
        setBranches(branchesRes.data);
        
        // Set default branch if user has one
        if (user?.branch_id) {
          setSelectedBranchId(user.branch_id);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [user]);

  // Fetch today's sessions when branch changes
  useEffect(() => {
    fetchTodaySessions();
  }, [fetchTodaySessions]);

  // Auto-load attendance if activity_id is passed via URL
  useEffect(() => {
    const activityFromUrl = searchParams.get('activity_id');
    if (activityFromUrl && activities.length > 0) {
      setSelectedActivityId(activityFromUrl);
    }
  }, [searchParams, activities]);

  // Fetch attendance for selected category and date
  const [closureInfo, setClosureInfo] = useState(null);

  const fetchAttendance = useCallback(async () => {
    if (!selectedCategory || !selectedDate) return;
    
    const activityIds = getActivitiesByCategory(selectedCategory).map(a => a.id);
    if (activityIds.length === 0) return;
    
    setLoading(true);
    setClosureInfo(null);
    try {
      const allMembers = [];
      const categoryName = activityCategories.find(c => c.id === selectedCategory)?.name || '';
      let foundClosure = null;
      
      for (const activityId of activityIds) {
        try {
          const res = await attendanceAPI.getByActivity(activityId, selectedDate);
          if (res.data?.closure) {
            foundClosure = res.data.closure;
          }
          if (res.data?.members) {
            res.data.members.forEach(m => {
              if (!allMembers.find(existing => existing.member_id === m.member_id)) {
                allMembers.push({
                  ...m,
                  activity_name: res.data.activity?.name || res.data.activity?.name_ar || ''
                });
              }
            });
          }
        } catch (e) {
          // Continue with other activities if one fails
        }
      }
      
      if (foundClosure) {
        setClosureInfo(foundClosure);
      }
      
      setAttendanceData({
        activity: { name: categoryName, name_ar: categoryName },
        members: allMembers,
        total_members: allMembers.length,
        present_count: allMembers.filter(m => m.status === 'present').length,
        absent_count: allMembers.filter(m => m.status === 'absent').length
      });
      
      const initialRecords = {};
      allMembers.forEach(m => {
        initialRecords[m.member_id] = {
          status: m.status || null,
          notes: m.notes || ''
        };
      });
      setAttendanceRecords(initialRecords);
    } catch (error) {
      toast.error(t('خطأ في جلب بيانات الحضور', 'Error fetching attendance'));
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, selectedDate, activities]);

  // Remove auto-fetch - only fetch when button is clicked
  // This prevents infinite loop caused by useCallback dependency changes

  // Handle attendance status change
  const handleStatusChange = (memberId, status) => {
    setAttendanceRecords(prev => ({
      ...prev,
      [memberId]: { ...prev[memberId], status }
    }));
  };

  // Save all attendance
  const handleSaveAttendance = async () => {
    const records = Object.entries(attendanceRecords)
      .filter(([_, rec]) => rec.status !== null)
      .map(([memberId, rec]) => ({
        member_id: memberId,
        status: rec.status,
        notes: rec.notes
      }));

    if (records.length === 0) {
      toast.error(t('لم يتم تحديد أي حضور', 'No attendance selected'));
      return;
    }

    try {
      // Get the first activity ID from the category for saving
      const activityIds = getActivitiesByCategory(selectedCategory).map(a => a.id);
      const activityId = activityIds[0] || selectedActivityId;
      
      await attendanceAPI.recordBulk({
        activity_id: activityId,
        date: selectedDate,
        records
      });
      toast.success(t(`تم حفظ حضور ${records.length} عضو`, `Saved attendance for ${records.length} members`));
      fetchAttendance();
    } catch (error) {
      toast.error(t('خطأ في حفظ الحضور', 'Error saving attendance'));
    }
  };

  // Mark all as present
  const handleMarkAllPresent = () => {
    if (!attendanceData?.members) return;
    const newRecords = {};
    attendanceData.members.forEach(m => {
      newRecords[m.member_id] = { status: 'present', notes: '' };
    });
    setAttendanceRecords(newRecords);
  };

  // Mark all as absent
  const handleMarkAllAbsent = () => {
    if (!attendanceData?.members) return;
    const newRecords = {};
    attendanceData.members.forEach(m => {
      newRecords[m.member_id] = { status: 'absent', notes: '' };
    });
    setAttendanceRecords(newRecords);
  };

  // QR Check-in
  const handleQRCheckin = async () => {
    if (!manualMemberId || !qrActivityId) {
      toast.error(t('يرجى إدخال رقم العضو واختيار النشاط', 'Please enter member ID and select activity'));
      return;
    }

    try {
      const res = await attendanceAPI.qrCheckin(manualMemberId, qrActivityId);
      setQrScanResult(res.data);
      if (res.data.already_checked_in) {
        toast.info(t('تم تسجيل الحضور مسبقاً', 'Already checked in'));
      } else if (res.data.status === 'wrong_day') {
        const days = (res.data.schedule_days || []).join(' - ');
        toast.warning(
          t(`ليس موعد العضو اليوم. مواعيده: ${days}. لم يتم التسجيل.`,
            `Not the member's scheduled day. Days: ${days}. Not recorded.`)
        );
      } else {
        toast.success(t('تم تسجيل الحضور بنجاح', 'Check-in successful'));
        setManualMemberId('');
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail;
      const message = typeof errorMsg === 'string' ? errorMsg : t('خطأ في التسجيل', 'Check-in error');
      toast.error(message);
      setQrScanResult({ error: true, message: message });
    }
  };

  // Fetch report
  const handleFetchReport = async () => {
    if (!selectedActivityId) {
      toast.error(t('يرجى اختيار النشاط', 'Please select activity'));
      return;
    }

    try {
      const params = {};
      if (reportDateRange.start) params.start_date = reportDateRange.start;
      if (reportDateRange.end) params.end_date = reportDateRange.end;
      
      const res = await attendanceAPI.getActivityReport(selectedActivityId, params);
      setReportData(res.data);
      setIsReportDialogOpen(true);
    } catch (error) {
      toast.error(t('خطأ في جلب التقرير', 'Error fetching report'));
    }
  };

  // Export attendance
  const handleExportAttendance = () => {
    const params = {};
    if (selectedActivityId) params.activity_id = selectedActivityId;
    if (selectedBranchId) params.branch_id = selectedBranchId;
    if (reportDateRange.start) params.start_date = reportDateRange.start;
    if (reportDateRange.end) params.end_date = reportDateRange.end;
    
    const url = attendanceAPI.export(params);
    window.open(url, '_blank');
    toast.success(t('جاري تحميل التقرير...', 'Downloading report...'));
  };

  // Quick Search by Member Code or Name
  const handleQuickSearch = async () => {
    if (!quickMemberCode.trim()) {
      toast.error(t('أدخل رقم العضوية أو الاسم', 'Enter member ID or name'));
      return;
    }
    
    setQuickSearching(true);
    setQuickSearchResult(null);
    setQuickSearchResults([]);
    
    try {
      // Try multi-search first
      const res = await attendanceAPI.quickSearchMulti(quickMemberCode.trim());
      
      if (res.data && res.data.length > 0) {
        if (res.data.length === 1) {
          // Single result - show directly
          setQuickSearchResult(res.data[0]);
        } else {
          // Multiple results - show list
          setQuickSearchResults(res.data);
        }
      } else {
        toast.error(t('لم يتم العثور على العضو', 'Member not found'));
      }
    } catch (error) {
      toast.error(t('خطأ في البحث', 'Search error'));
    } finally {
      setQuickSearching(false);
    }
  };

  // Select member from multiple results
  const selectMemberFromResults = (member) => {
    setQuickSearchResult(member);
    setQuickSearchResults([]);
  };

  // Quick Attendance Registration
  const handleQuickAttendance = async (activityId) => {
    // Use member_code from search result, not the search term
    const memberCode = quickSearchResult?.member_code;
    if (!memberCode) {
      toast.error(t('يرجى اختيار العضو أولاً', 'Please select a member first'));
      return;
    }
    
    setQuickRegistering(true);
    
    try {
      const res = await attendanceAPI.quickAttendance(memberCode, activityId);
      
      if (res.data.already_recorded) {
        toast.info(t('تم تسجيل الحضور مسبقاً', 'Already recorded'));
      } else {
        toast.success(res.data.message);
        // Update the search result to show new attendance
        setQuickSearchResult(prev => ({
          ...prev,
          today_attendance: [...(prev?.today_attendance || []), res.data.record]
        }));
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail;
      const message = typeof errorMsg === 'string' ? errorMsg : t('خطأ في التسجيل', 'Registration error');
      toast.error(message);
    } finally {
      setQuickRegistering(false);
    }
  };

  // Clear quick search
  const clearQuickSearch = () => {
    setQuickMemberCode('');
    setQuickSearchResult(null);
    setQuickSearchResults([]);
  };

  // QR Scanner Functions
  const startQRScanner = () => {
    if (scannerRef.current) return;
    
    setIsScannerActive(true);
    
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "qr-reader",
        { 
          fps: 10, 
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
          showTorchButtonIfSupported: true,
          showZoomSliderIfSupported: true,
          videoConstraints: {
            facingMode: "environment"
          }
        },
        false
      );
      
      scanner.render(onQRScanSuccess, onQRScanError);
      scannerRef.current = scanner;
    }, 100);
  };

  const stopQRScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(console.error);
      scannerRef.current = null;
    }
    setIsScannerActive(false);
  };

  const onQRScanSuccess = async (decodedText) => {
    try {
      const data = JSON.parse(decodedText);

      // If JSON parsed to a primitive (number/string), treat as a plain member/coach code
      if (typeof data !== 'object' || data === null) {
        const code = String(data).trim();
        stopQRScanner();
        setManualMemberId(code);
        await fetchMemberActivities(code);
        return;
      }

      // Coach QR with explicit type
      if (data.type === 'WCPA_COACH' || data.employee_id) {
        const empId = String(data.employee_id || data.id || '').trim();
        if (empId) {
          stopQRScanner();
          await handleCoachQRCheckin(empId);
        } else {
          toast.error(t('كود غير صالح', 'Invalid QR code'));
        }
        return;
      }

      // Support multiple member QR formats (old and new)
      const memberCode = data.code || data.member_code || data.id;
      if ((data.type === 'WCPA_MEMBER' || data.type === 'WCPA_REG_FORM' || data.member_id || data.member_code) && memberCode) {
        stopQRScanner();
        setManualMemberId(memberCode);
        await fetchMemberActivities(memberCode);
      } else {
        toast.error(t('كود غير صالح', 'Invalid QR code'));
      }
    } catch (e) {
      const trimmed = decodedText.trim();
      if (trimmed) {
        stopQRScanner();
        setManualMemberId(trimmed);
        await fetchMemberActivities(trimmed);
      } else {
        toast.error(t('كود غير صالح', 'Invalid QR code'));
      }
    }
  };

  const onQRScanError = (error) => {
    // Ignore scan errors (they happen frequently while scanning)
  };

  // Auto-check-in coach via QR scan
  const handleCoachQRCheckin = async (employeeId) => {
    setQrLoading(true);
    setQrCoachResult(null);
    setQrMemberData(null);
    setQrScanResult(null);
    try {
      const res = await fetch(`/api/coach-attendance/qr-checkin-by-code/${employeeId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Coach not found');
      const data = await res.json();
      setQrCoachResult(data);
      if (data.action === 'checked_in') toast.success(`✅ ${data.coach_name} — تم تسجيل الحضور`);
      else if (data.action === 'checked_out') toast.success(`✅ ${data.coach_name} — تم تسجيل الانصراف`);
    } catch {
      setQrScanResult({ error: true, message: t('⚠️ الرقم غير موجود (عضو أو مدرب)', '⚠️ Code not found') });
    } finally {
      setQrLoading(false);
    }
  };

  // Fetch member activities after QR scan
  const fetchMemberActivities = async (memberCode) => {
    setQrLoading(true);
    setQrScanResult(null);
    setQrMemberData(null);
    setQrCoachResult(null);
    
    try {
      const API_URL = '';
      // Pass the scanner's branch context so the backend can disambiguate
      // printed-card QRs that only carry a numeric suffix (e.g. "0027")
      // when the same suffix exists in more than one branch.
      const scannerBranchId = selectedBranchId || user?.branch_id || '';
      const branchQS = scannerBranchId ? `?branch_id=${encodeURIComponent(scannerBranchId)}` : '';
      const response = await fetch(`${API_URL}/api/public/member-card/${encodeURIComponent(memberCode)}${branchQS}`);
      
      if (!response.ok) {
        // Not a member — try coach lookup
        const coachRes = await fetch(`/api/coach-attendance/qr-status-by-code/${memberCode}`);
        if (coachRes.ok) {
          // It's a coach — auto check-in/out
          setQrLoading(false);
          await handleCoachQRCheckin(memberCode);
          return;
        }
        throw new Error('Not found');
      }
      
      const memberData = await response.json();
      
      // Keep all activities (active and expired) to show status
      const allActivities = memberData.activities || [];
      const activeActivities = allActivities.filter(a => a.status === 'active');
      const expiredActivities = allActivities.filter(a => a.status === 'expired');
      
      if (allActivities.length === 0) {
        setQrScanResult({
          error: true,
          message: t('⚠️ لا يوجد اشتراكات لهذا العضو', '⚠️ No subscriptions for this member')
        });
        setQrMemberData({ ...memberData, activities: [], expiredActivities: [] });
      } else if (activeActivities.length === 0 && expiredActivities.length > 0) {
        // Only expired subscriptions
        setQrScanResult({
          error: true,
          message: t('⚠️ انتهت جميع اشتراكات هذا العضو', '⚠️ All subscriptions have expired')
        });
        setQrMemberData({ ...memberData, activities: [], expiredActivities: expiredActivities });
      } else {
        setQrMemberData({ ...memberData, activities: activeActivities, expiredActivities: expiredActivities });
        toast.success(t(`مرحباً ${memberData.name_ar}`, `Welcome ${memberData.name_ar}`));
      }
    } catch (error) {
      setQrScanResult({
        error: true,
        message: t('⚠️ رقم العضوية غير موجود', '⚠️ Member ID not found')
      });
    } finally {
      setQrLoading(false);
    }
  };

  // Handle check-in for specific activity from QR scan
  const handleQRActivityCheckin = async (activityId, activityName) => {
    if (!qrMemberData || !activityId) return;
    
    setQrLoading(true);
    
    try {
      const res = await attendanceAPI.quickAttendance(qrMemberData.member_code, activityId);
      
      if (res.data.already_recorded) {
        setQrScanResult({
          error: false,
          message: t('تم تسجيل الحضور مسبقاً ✓', 'Already checked in ✓'),
          member_name: qrMemberData.name_ar,
          member_photo: qrMemberData.photo || res.data.member_photo || '',
          activity_name: activityName,
          check_in_time: new Date().toLocaleTimeString('ar-SA')
        });
      } else {
        setQrScanResult({
          error: false,
          message: t('تم تسجيل الحضور بنجاح ✓', 'Check-in successful ✓'),
          member_name: qrMemberData.name_ar,
          member_photo: qrMemberData.photo || res.data.member_photo || '',
          activity_name: activityName,
          check_in_time: new Date().toLocaleTimeString('ar-SA')
        });
        toast.success(t('تم تسجيل الحضور ✓', 'Check-in successful ✓'));
        
        // Update the activity to show as recorded
        setQrMemberData(prev => ({
          ...prev,
          activities: prev.activities.map(a => 
            a.activity_id === activityId ? { ...a, recorded_today: true } : a
          )
        }));
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail;
      const message = typeof errorMsg === 'string' ? errorMsg : t('خطأ في تسجيل الحضور', 'Check-in error');
      setQrScanResult({
        error: true,
        message: message
      });
    } finally {
      setQrLoading(false);
    }
  };

  // Clear QR scan data
  const clearQRScan = () => {
    setQrMemberData(null);
    setQrScanResult(null);
    setQrCoachResult(null);
    setManualMemberId('');
  };

  const handleQRCheckinWithCode = async (memberCode) => {
    if (!memberCode) return;
    await fetchMemberActivities(memberCode);
  };

  // ============ KIOSK MODE (USB Scanner) ============
  
  // Play sound for kiosk mode
  const playSound = useCallback((type) => {
    if (!kioskSoundEnabled) return;
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'success') {
      oscillator.frequency.value = 800;
      gainNode.gain.value = 0.3;
      oscillator.start();
      setTimeout(() => {
        oscillator.frequency.value = 1000;
      }, 100);
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
  }, [kioskSoundEnabled]);

  // Filtered activities (needed before handleKioskCheckin useCallback)
  const filteredActivitiesRaw = selectedBranchId
    ? activities.filter(a => a.branch_id === selectedBranchId || !a.branch_id)
    : activities;

  // Handle kiosk mode check-in (members + coaches)
  const handleKioskCheckin = useCallback(async (memberCode) => {
    if (!memberCode) return;
    
    playSound('scan');
    
    // Try member first using category activities
    if (kioskCategoryId) {
      // Get all activity IDs for the selected category
      const cat = ACTIVITY_CATEGORIES.find(c => c.id === kioskCategoryId);
      const catActivities = cat
        ? filteredActivitiesRaw.filter(a => {
            const name = (a.name_ar || a.name || '').toLowerCase();
            return cat.keywords.some(k => name.includes(k));
          })
        : [];
      
      // Try each activity in category until one succeeds. A wrong-day response for
      // one activity must NOT stop the loop — a different activity in the same
      // category may be scheduled today. Remember it and only surface the wrong-day
      // denial if no activity ends up succeeding.
      let memberCheckedIn = false;
      let pendingWrongDay = null;
      for (const activity of catActivities) {
        try {
          const res = await attendanceAPI.qrCheckin(memberCode, activity.id);
          if (res.data.status === 'already_checked_in') {
            playSound('error');
            setKioskLastScan({
              success: false,
              memberName: res.data.member?.name || memberCode,
              memberPhoto: res.data.member?.photo || '',
              message: t('⚠️ مسجل مسبقاً اليوم', '⚠️ Already checked in today'),
              time: new Date().toLocaleTimeString('ar-SA')
            });
          } else if (res.data.status === 'wrong_day') {
            // Defer: keep trying other activities in this category first.
            const days = (res.data.schedule_days || []).join(' - ');
            pendingWrongDay = {
              memberName: res.data.member?.name || memberCode,
              memberPhoto: res.data.member?.photo || '',
              message: t(`⚠️ ليس موعدك اليوم (${days}) — راجع الاستقبال`, `⚠️ Not your day (${days}) — see reception`)
            };
            continue;
          } else {
            playSound('success');
            setKioskLastScan({
              success: true,
              memberName: res.data.member?.name || res.data.member_name || memberCode,
              memberPhoto: res.data.member?.photo || '',
              message: t('✅ تم تسجيل الحضور', '✅ Check-in successful'),
              time: new Date().toLocaleTimeString('ar-SA')
            });
          }
          memberCheckedIn = true;
          setTimeout(() => setKioskLastScan(null), 5000);
          return;
        } catch (err) {
          // 404 = not subscribed in this activity, try next
          if (err.response?.status !== 404) {
            // Real error — show it and stop
            playSound('error');
            const errorMsg = err.response?.data?.detail || t('خطأ', 'Error');
            setKioskLastScan({ success: false, memberName: memberCode, message: `❌ ${errorMsg}`, time: new Date().toLocaleTimeString('ar-SA') });
            setTimeout(() => setKioskLastScan(null), 5000);
            memberCheckedIn = true;
            return;
          }
        }
      }
      // No activity succeeded. If at least one was a wrong-day match, the member IS
      // subscribed in this category (just not today) — show that instead of falling
      // through to the coach check.
      if (pendingWrongDay) {
        playSound('error');
        setKioskLastScan({
          success: false,
          ...pendingWrongDay,
          time: new Date().toLocaleTimeString('ar-SA')
        });
        setTimeout(() => setKioskLastScan(null), 5000);
        return;
      }
      // If tried all activities with 404 — not a member in this category, fall through to coach check
      if (memberCheckedIn) return;
    }
    
    // Try coach check-in by employee_id
    try {
      const coachRes = await fetch(`/api/coach-attendance/qr-checkin-by-code/${memberCode}`, { method: 'POST' });
      if (!coachRes.ok) throw new Error('not found');
      const data = await coachRes.json();
      playSound('success');
      setKioskLastScan({
        success: true,
        memberName: `${data.coach_name} (مدرب)`,
        message: data.action === 'checked_in' ? '✅ تم تسجيل حضور المدرب' : data.action === 'checked_out' ? '🔵 تم تسجيل انصراف المدرب' : data.message,
        time: new Date().toLocaleTimeString('ar-SA')
      });
    } catch {
      playSound('error');
      setKioskLastScan({ success: false, memberName: memberCode, message: `❌ ${t('الرقم غير موجود', 'Code not found')}`, time: new Date().toLocaleTimeString('ar-SA') });
    }
    
    setTimeout(() => setKioskLastScan(null), 5000);
  }, [kioskCategoryId, filteredActivitiesRaw, playSound, t]);

  // Kiosk mode keyboard listener
  useEffect(() => {
    if (!kioskMode) return;
    
    const handleKeyDown = (e) => {
      const now = Date.now();
      
      // If more than 100ms between keys, it's manual typing - reset buffer
      if (now - kioskLastKeyTime > 100 && kioskBufferRef.current.length > 0) {
        kioskBufferRef.current = '';
      }
      
      setKioskLastKeyTime(now);
      
      // Clear any existing timeout
      if (kioskTimeoutRef.current) {
        clearTimeout(kioskTimeoutRef.current);
      }
      
      if (e.key === 'Enter') {
        // Process the scanned code
        const scannedCode = kioskBufferRef.current.trim();
        if (scannedCode.length >= 3) {
          handleKioskCheckin(scannedCode);
        }
        kioskBufferRef.current = '';
        setKioskBuffer('');
        e.preventDefault();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Add character to buffer
        kioskBufferRef.current += e.key;
        setKioskBuffer(kioskBufferRef.current);
        
        // Auto-process after 50ms of no input (scanner sends Enter, but just in case)
        kioskTimeoutRef.current = setTimeout(() => {
          const code = kioskBufferRef.current.trim();
          if (code.length >= 3) {
            handleKioskCheckin(code);
          }
          kioskBufferRef.current = '';
          setKioskBuffer('');
        }, 50);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (kioskTimeoutRef.current) {
        clearTimeout(kioskTimeoutRef.current);
      }
    };
  }, [kioskMode, kioskLastKeyTime, handleKioskCheckin]);

  // Cleanup scanner on unmount or tab change
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, []);

  // Stop scanner when changing tabs
  useEffect(() => {
    if (activeTab !== 'qr') {
      stopQRScanner();
    }
    // Disable kiosk mode when leaving kiosk tab
    if (activeTab !== 'kiosk') {
      setKioskMode(false);
    }
  }, [activeTab]);

  // Fetch levels for selected category (reports tab)
  useEffect(() => {
    if (!selectedCategory) {
      setReportLevels([]);
      setReportSelectedLevelId('');
      return;
    }
    const actIds = getActivitiesByCategory(selectedCategory).map(a => a.id);
    if (!actIds.length) { setReportLevels([]); setReportSelectedLevelId(''); return; }
    levelsAPI.getAll().then(res => {
      const allLevels = res.data || [];
      const filtered = allLevels.filter(l => actIds.includes(l.activity_id));
      filtered.forEach(l => {
        const cn = (l.custom_name || '').trim();
        l.display_name = cn || `المستوى ${l.level_number || ''}`;
      });
      setReportLevels(filtered);
      setReportSelectedLevelId('');
    }).catch(() => { setReportLevels([]); setReportSelectedLevelId(''); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // Export attendance summary (summary mode: one row per member)
  const handleExportAttendanceSummary = (format = 'xlsx') => {
    const params = { format };
    // Determine activity_id: if a level is selected its activity is used on backend;
    // otherwise use first activity from selected category
    if (!reportSelectedLevelId) {
      const catActivities = selectedCategory ? getActivitiesByCategory(selectedCategory) : [];
      const actId = selectedActivityId || (catActivities.length > 0 ? catActivities[0].id : null);
      if (actId) params.activity_id = actId;
    }
    if (reportSelectedLevelId) params.level_id = reportSelectedLevelId;
    if (selectedBranchId) params.branch_id = selectedBranchId;
    if (reportDateRange.start) params.start_date = reportDateRange.start;
    if (reportDateRange.end) params.end_date = reportDateRange.end;
    const url = attendanceAPI.exportSummary(params);
    window.open(url, '_blank');
    toast.success(t('جاري تحميل الكشف...', 'Downloading report...'));
  };

  // Get activity name
  const getActivityName = (id) => activities.find(a => a.id === id)?.name || '';

  // Activity categories (defined as module-level ACTIVITY_CATEGORIES)
  const activityCategories = ACTIVITY_CATEGORIES;

  // Get activities by category
  const getActivitiesByCategory = (categoryId) => {
    const category = activityCategories.find(c => c.id === categoryId);
    if (!category) return [];
    return filteredActivitiesRaw.filter(a => {
      const name = (a.name_ar || a.name || '').toLowerCase();
      return category.keywords.some(k => name.includes(k));
    });
  };

  // Get available categories (only those with activities)
  const availableCategories = activityCategories.filter(cat => 
    getActivitiesByCategory(cat.id).length > 0
  );

  // Get activity IDs for selected category
  const getSelectedActivityIds = () => {
    if (!selectedCategory) return [];
    return getActivitiesByCategory(selectedCategory).map(a => a.id);
  };

  // Sort: by category first, then by number (for other uses)
  const getActivityCategory = (activity) => {
    const name = (activity.name_ar || activity.name || '').toLowerCase();
    if (name.includes('سباح') || name.includes('swim')) return 1;
    if (name.includes('قدم') || name.includes('كرة') || name.includes('foot')) return 2;
    if (name.includes('كارات') || name.includes('karate')) return 3;
    if (name.includes('جمباز') || name.includes('gym')) return 4;
    return 99;
  };

  const getActivityNumber = (activity) => {
    const name = activity.name_ar || activity.name || '';
    const match = name.match(/(\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

  const filteredActivities = [...filteredActivitiesRaw].sort((a, b) => {
    const catA = getActivityCategory(a);
    const catB = getActivityCategory(b);
    if (catA !== catB) return catA - catB;
    return getActivityNumber(a) - getActivityNumber(b);
  });

  return (
    <Layout title={t('الحضور', 'Attendance')}>
      <div className="p-6 max-w-7xl mx-auto" data-testid="attendance-page">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              📋 {t('تتبع الحضور', 'Attendance Tracking')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('تسجيل ومتابعة حضور الأعضاء', 'Record and track member attendance')}
            </p>
          </div>
          <Button onClick={handleExportAttendance} variant="outline" className="gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            {t('تصدير Excel', 'Export Excel')}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b pb-2 flex-wrap">
          <Button
            variant={activeTab === 'quick' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('quick')}
            className="gap-2"
          >
            <Zap className="w-4 h-4" />
            {t('تسجيل سريع', 'Quick Check-in')}
          </Button>
          <Button
            variant={activeTab === 'record' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('record')}
            className="gap-2"
          >
            <Users className="w-4 h-4" />
            {t('تسجيل الحضور', 'Record Attendance')}
          </Button>
          <Button
            variant={activeTab === 'qr' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('qr')}
            className="gap-2"
          >
            <QrCode className="w-4 h-4" />
            {t('QR', 'QR')}
          </Button>
          <Button
            variant={activeTab === 'kiosk' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('kiosk')}
            className="gap-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-600 hover:to-blue-600"
          >
            <Scan className="w-4 h-4" />
            {t('جهاز المسح', 'Scanner Device')}
          </Button>
          <Button
            variant={activeTab === 'reports' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('reports')}
            className="gap-2"
          >
            <Calendar className="w-4 h-4" />
            {t('التقارير', 'Reports')}
          </Button>
        </div>

        {/* Quick Registration Tab */}
        {activeTab === 'quick' && (
          <div className="space-y-4">
            {/* Quick Search Box */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-green-800 mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5" />
                {t('تسجيل سريع برقم العضوية أو الاسم', 'Quick Check-in by Member ID or Name')}
              </h2>
              
              <div className="flex gap-3 items-end">
                <div className="flex-1 max-w-md">
                  <label className="text-sm text-gray-600 mb-1 block">
                    {t('رقم العضوية أو الاسم', 'Member ID or Name')}
                  </label>
                  <div className="relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="text"
                      value={quickMemberCode}
                      onChange={(e) => setQuickMemberCode(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleQuickSearch()}
                      placeholder={t('2601 أو أحمد', '2601 or Ahmed')}
                      className="text-lg pr-10 h-12"
                      dir="auto"
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleQuickSearch} 
                  disabled={quickSearching || !quickMemberCode.trim()}
                  className="h-12 px-6 bg-green-600 hover:bg-green-700"
                >
                  <Search className="w-4 h-4 me-2" />
                  {quickSearching ? t('جاري البحث...', 'Searching...') : t('بحث', 'Search')}
                </Button>
                {(quickSearchResult || quickSearchResults.length > 0) && (
                  <Button variant="outline" onClick={clearQuickSearch} className="h-12">
                    {t('مسح', 'Clear')}
                  </Button>
                )}
              </div>
            </div>

            {/* Multiple Search Results */}
            {quickSearchResults.length > 0 && (
              <div className="bg-white border-2 border-blue-200 rounded-xl p-4 shadow-lg">
                <h3 className="text-sm font-medium text-blue-700 mb-3">
                  {t(`تم العثور على ${quickSearchResults.length} نتائج - اختر العضو:`, `Found ${quickSearchResults.length} results - Select member:`)}
                </h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {quickSearchResults.map((member, idx) => (
                    <div
                      key={member.member_id}
                      onClick={() => selectMemberFromResults(member)}
                      className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-blue-50 rounded-lg cursor-pointer transition-colors border hover:border-blue-300"
                    >
                      <MemberAvatar photo={member.photo} name={member.name_ar || member.name} size="sm" />
                      <span className="font-mono text-primary font-bold">#{member.member_code}</span>
                      <span className="font-medium">{member.name_ar || member.name}</span>
                      <span className="text-gray-500 text-sm">{member.phone}</span>
                      {member.today_attendance?.length > 0 && (
                        <Badge className="bg-blue-100 text-blue-700 text-xs">
                          {t('مسجل اليوم', 'Recorded today')}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Single Search Result */}
            {quickSearchResult && (
              <div className="bg-white border-2 border-green-300 rounded-xl p-6 shadow-lg animate-in fade-in duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <MemberAvatar
                      photo={quickSearchResult.photo}
                      name={quickSearchResult.name_ar || quickSearchResult.name}
                      size="lg"
                      borderClass="border-green-300"
                    />
                    <div>
                      <p className="text-sm font-bold text-green-600">#{quickSearchResult.member_code}</p>
                      <h3 className="text-xl font-bold text-gray-800">
                        {quickSearchResult.name_ar || quickSearchResult.name}
                      </h3>
                      <p className="text-gray-500">{quickSearchResult.phone}</p>
                    </div>
                  </div>
                  <UserCheck className="w-10 h-10 text-green-500" />
                </div>

                {/* Today's Attendance Status */}
                {quickSearchResult.today_attendance?.length > 0 && (
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-700 font-medium mb-2">
                      {t('تم تسجيل الحضور اليوم:', 'Recorded today:')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {quickSearchResult.today_attendance.map((att, idx) => (
                        <Badge key={idx} className="bg-blue-100 text-blue-700">
                          ✓ {att.activity_name} - {att.check_in_time}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activities to Register */}
                <div>
                  <p className="text-sm text-gray-600 mb-3">
                    {t('اختر النشاط لتسجيل الحضور:', 'Select activity to record attendance:')}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {quickSearchResult.activities?.length > 0 ? (
                      quickSearchResult.activities.map((activity, idx) => {
                        const alreadyRecorded = quickSearchResult.today_attendance?.some(
                          att => att.activity_id === activity.activity_id
                        );
                        return (
                          <Button
                            key={idx}
                            variant={alreadyRecorded ? "secondary" : "default"}
                            disabled={quickRegistering || alreadyRecorded}
                            onClick={() => handleQuickAttendance(activity.activity_id)}
                            className={`h-auto py-3 flex flex-col gap-1 ${
                              alreadyRecorded ? 'bg-gray-100' : 'bg-green-600 hover:bg-green-700'
                            }`}
                          >
                            <span className="font-bold">{activity.activity_name}</span>
                            {alreadyRecorded ? (
                              <span className="text-xs opacity-70">✓ {t('مسجل', 'Recorded')}</span>
                            ) : (
                              <span className="text-xs opacity-70">{t('تسجيل حضور', 'Check-in')}</span>
                            )}
                          </Button>
                        );
                      })
                    ) : (
                      <p className="text-gray-500 col-span-3 text-center py-4">
                        {t('لا توجد أنشطة مسجلة لهذا العضو', 'No activities registered for this member')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Record Attendance Tab */}
        {activeTab === 'record' && (
          <div className="space-y-4">
            {/* Today's Sessions from Schedule */}
            {todaySessions.length > 0 && !attendanceData && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarDays className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-blue-800">{t('حصص اليوم', "Today's Sessions")}</h3>
                  <span className="text-sm text-blue-600">({todaySessions.length} {t('حصة', 'sessions')})</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {todaySessions.map((session, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedActivityId(session.activity_id);
                        setTimeout(() => {
                          document.querySelector('[data-testid="load-attendance-btn"]')?.click();
                        }, 100);
                      }}
                      className="gap-2 bg-white hover:bg-blue-50 border-blue-300"
                    >
                      <span className="font-medium">{session.activity_name}</span>
                      {session.time && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          {session.time}
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Branch Select */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('الفرع', 'Branch')}
                  </label>
                  <select
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full border rounded-lg p-2"
                  >
                    <option value="">{t('كل الفروع', 'All Branches')}</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                {/* Activity Category Select */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('النشاط', 'Activity')} *
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="w-full border rounded-lg p-2"
                    data-testid="activity-select"
                  >
                    <option value="">{t('اختر النشاط', 'Select Activity')}</option>
                    {availableCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('التاريخ', 'Date')} *
                  </label>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                    data-testid="date-input"
                  />
                </div>

                {/* Load Button */}
                <div className="flex items-end">
                  <Button 
                    onClick={fetchAttendance} 
                    disabled={!selectedCategory}
                    className="w-full gap-2"
                    data-testid="load-attendance-btn"
                  >
                    <Search className="w-4 h-4" />
                    {t('تحميل القائمة', 'Load List')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Attendance List */}
            {loading ? (
              <div className="text-center py-10">
                <div className="spinner mx-auto"></div>
                <p className="mt-2 text-gray-500">{t('جاري التحميل...', 'Loading...')}</p>
              </div>
            ) : closureInfo ? (
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="p-8 text-center">
                  <div className="text-6xl mb-4">🚫</div>
                  <h2 className="text-xl font-bold text-red-600 mb-2">
                    {closureInfo.title || t('توقف', 'Closure')}
                  </h2>
                  <p className="text-gray-600 mb-2">
                    {t('هذا التاريخ يقع ضمن فترة توقف', 'This date falls within a closure period')}
                  </p>
                  <p className="text-sm text-gray-500">
                    {closureInfo.start_date} → {closureInfo.end_date}
                  </p>
                  {closureInfo.reason && (
                    <p className="mt-2 text-sm text-gray-500">
                      {t('السبب:', 'Reason:')} {closureInfo.reason}
                    </p>
                  )}
                </div>
              </div>
            ) : attendanceData ? (
              <div className="bg-white rounded-lg border shadow-sm">
                {/* Summary Header */}
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-4">
                  <div>
                    <h2 className="font-bold text-lg">{attendanceData.activity?.name}</h2>
                    <p className="text-sm text-gray-500">
                      {selectedDate} • {attendanceData.total_members} {t('عضو', 'members')}
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center px-4 py-2 bg-green-100 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">{attendanceData.present_count}</div>
                      <div className="text-xs text-green-700">{t('حاضر', 'Present')}</div>
                    </div>
                    <div className="text-center px-4 py-2 bg-red-100 rounded-lg">
                      <div className="text-2xl font-bold text-red-600">{attendanceData.absent_count}</div>
                      <div className="text-xs text-red-700">{t('غائب', 'Absent')}</div>
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="p-4 border-b flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={handleMarkAllPresent} className="gap-1 text-green-600 border-green-300">
                    <UserCheck className="w-4 h-4" />
                    {t('الكل حاضر', 'All Present')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleMarkAllAbsent} className="gap-1 text-red-600 border-red-300">
                    <UserX className="w-4 h-4" />
                    {t('الكل غائب', 'All Absent')}
                  </Button>
                </div>

                {/* Members List */}
                <div className="divide-y max-h-[500px] overflow-y-auto">
                  {attendanceData.members?.map((member, idx) => (
                    <div 
                      key={member.member_id} 
                      className={`p-4 flex items-center justify-between hover:bg-gray-50 ${
                        attendanceRecords[member.member_id]?.status === 'present' ? 'bg-green-50' :
                        attendanceRecords[member.member_id]?.status === 'absent' ? 'bg-red-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                          {idx + 1}
                        </span>
                        <MemberAvatar photo={member.member_photo} name={member.member_name} size="sm" />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {member.member_code && (
                              <span className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                #{member.member_code}
                              </span>
                            )}
                            {member.member_name}
                          </div>
                          <div className="text-xs text-gray-500">{member.phone}</div>
                        </div>
                        {member.subscription_status !== 'active' && (
                          <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">
                            {t('اشتراك غير نشط', 'Inactive')}
                          </span>
                        )}
                        {member.recorded && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                            {t('مسجل', 'Recorded')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={attendanceRecords[member.member_id]?.status === 'present' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleStatusChange(member.member_id, 'present')}
                          className={`gap-1 ${attendanceRecords[member.member_id]?.status === 'present' ? 'bg-green-600 hover:bg-green-700' : 'text-green-600 border-green-300'}`}
                          data-testid={`present-btn-${member.member_id}`}
                        >
                          <Check className="w-4 h-4" />
                          {t('حاضر', 'Present')}
                        </Button>
                        <Button
                          variant={attendanceRecords[member.member_id]?.status === 'absent' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleStatusChange(member.member_id, 'absent')}
                          className={`gap-1 ${attendanceRecords[member.member_id]?.status === 'absent' ? 'bg-red-600 hover:bg-red-700' : 'text-red-600 border-red-300'}`}
                          data-testid={`absent-btn-${member.member_id}`}
                        >
                          <X className="w-4 h-4" />
                          {t('غائب', 'Absent')}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {attendanceData.members?.length === 0 && (
                    <div className="p-8 text-center text-gray-500">
                      {t('لا يوجد أعضاء مسجلين في هذا النشاط', 'No members enrolled in this activity')}
                    </div>
                  )}
                </div>

                {/* Save Button */}
                {attendanceData.members?.length > 0 && (
                  <div className="p-4 border-t bg-gray-50">
                    <Button onClick={handleSaveAttendance} className="w-full gap-2" data-testid="save-attendance-btn">
                      <Check className="w-4 h-4" />
                      {t('حفظ الحضور', 'Save Attendance')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg border p-10 text-center text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t('اختر النشاط والتاريخ لعرض قائمة الأعضاء', 'Select activity and date to view members list')}</p>
              </div>
            )}
          </div>
        )}

        {/* QR Check-in Tab */}
        {activeTab === 'qr' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* QR Scanner Section */}
            <div className="bg-white p-6 rounded-lg border shadow-sm">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Camera className="w-5 h-5" />
                {t('مسح QR Code', 'Scan QR Code')}
              </h2>
              
              <div className="space-y-4">
                {/* QR Scanner */}
                <div className="border-2 border-dashed border-gray-200 rounded-lg overflow-hidden">
                  {isScannerActive ? (
                    <div>
                      <div id="qr-reader" className="w-full"></div>
                      <Button 
                        onClick={stopQRScanner} 
                        variant="outline"
                        className="w-full mt-2 gap-2 text-red-600"
                      >
                        <CameraOff className="w-4 h-4" />
                        {t('إيقاف الكاميرا', 'Stop Camera')}
                      </Button>
                    </div>
                  ) : (
                    <div className="p-8 text-center">
                      <Camera className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <Button 
                        onClick={startQRScanner}
                        className="gap-2 bg-blue-600 hover:bg-blue-700"
                      >
                        <Camera className="w-4 h-4" />
                        {t('تشغيل الكاميرا', 'Start Camera')}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Manual Entry */}
                <div className="border-t pt-4">
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('أو أدخل رقم العضوية يدوياً', 'Or enter member ID manually')}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={manualMemberId}
                      onChange={e => setManualMemberId(e.target.value)}
                      placeholder={t('رقم العضوية', 'Member ID')}
                      onKeyPress={e => e.key === 'Enter' && handleQRCheckinWithCode(manualMemberId)}
                    />
                    <Button 
                      onClick={() => handleQRCheckinWithCode(manualMemberId)} 
                      disabled={!manualMemberId || qrLoading}
                    >
                      {qrLoading ? <Clock className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Result */}
              {qrScanResult && (
                <div className={`mt-4 p-4 rounded-lg ${qrScanResult.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {qrScanResult.error ? (
                    <div className="flex items-center gap-2">
                      <X className="w-5 h-5" />
                      <span>{qrScanResult.message}</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <MemberAvatar
                        photo={qrScanResult.member_photo}
                        name={qrScanResult.member_name}
                        size="md"
                        borderClass="border-green-300"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Check className="w-5 h-5" />
                          <span className="font-bold">{qrScanResult.message}</span>
                        </div>
                        <div className="text-sm">
                          <p>{t('العضو', 'Member')}: {qrScanResult.member_name}</p>
                          <p>{t('النشاط', 'Activity')}: {qrScanResult.activity_name}</p>
                          <p>{t('الوقت', 'Time')}: {qrScanResult.check_in_time}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Member Activities Section (after QR scan) */}
            <div className="bg-white p-6 rounded-lg border shadow-sm">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <UserCheck className="w-5 h-5" />
                {t('بيانات العضو', 'Member Data')}
              </h2>
              
              {qrLoading ? (
                <div className="text-center py-10">
                  <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300 animate-spin" />
                  <p className="text-gray-500">{t('جاري البحث...', 'Searching...')}</p>
                </div>
              ) : qrCoachResult ? (
                <div className="space-y-4">
                  {/* Coach Result Card */}
                  <div className={`p-5 rounded-xl text-center border-2 ${
                    qrCoachResult.action === 'checked_in' ? 'bg-green-50 border-green-300' :
                    qrCoachResult.action === 'checked_out' ? 'bg-blue-50 border-blue-300' :
                    'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`text-4xl mb-3 ${
                      qrCoachResult.action === 'checked_in' ? 'text-green-600' :
                      qrCoachResult.action === 'checked_out' ? 'text-blue-600' : 'text-gray-500'
                    }`}>
                      {qrCoachResult.action === 'checked_in' ? '✅' :
                       qrCoachResult.action === 'checked_out' ? '🔵' : 'ℹ️'}
                    </div>
                    <p className="text-xl font-bold text-gray-800 mb-1">{qrCoachResult.coach_name}</p>
                    <p className="text-sm text-gray-500 mb-3">
                      {qrCoachResult.employee_id && `رقم الموظف: #${qrCoachResult.employee_id}`}
                    </p>
                    <div className={`text-lg font-bold mb-2 ${
                      qrCoachResult.action === 'checked_in' ? 'text-green-700' :
                      qrCoachResult.action === 'checked_out' ? 'text-blue-700' : 'text-gray-700'
                    }`}>
                      {qrCoachResult.message}
                    </div>
                    {qrCoachResult.check_in_time && (
                      <p className="text-sm text-gray-600">وقت الحضور: {qrCoachResult.check_in_time}</p>
                    )}
                    {qrCoachResult.check_out_time && (
                      <p className="text-sm text-gray-600">وقت الانصراف: {qrCoachResult.check_out_time}</p>
                    )}
                    {qrCoachResult.total_hours && (
                      <p className="text-sm font-semibold text-indigo-600 mt-1">ساعات العمل: {qrCoachResult.total_hours} ساعة</p>
                    )}
                  </div>
                  <Button onClick={clearQRScan} variant="outline" className="w-full gap-2">
                    <X className="w-4 h-4" />
                    {t('مسح وبدء من جديد', 'Clear and start over')}
                  </Button>
                </div>
              ) : qrMemberData ? (
                <div className="space-y-4">
                  {/* Member Info */}
                  <div className="bg-blue-50 p-4 rounded-lg flex items-center gap-4">
                    <MemberAvatar
                      photo={qrMemberData.photo}
                      name={qrMemberData.name_ar || qrMemberData.name}
                      size="lg"
                      borderClass="border-blue-300"
                    />
                    <div className="text-right flex-1">
                      <p className="text-xl font-bold text-gray-800">{qrMemberData.name_ar}</p>
                      <p className="text-lg text-blue-600 font-bold">#{qrMemberData.member_code}</p>
                      {qrMemberData.phone && <p className="text-sm text-gray-500" dir="ltr">{qrMemberData.phone}</p>}
                    </div>
                  </div>

                  {/* Member Notes - shown prominently for supervisor */}
                  {qrMemberData.notes && (
                    <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-3 flex items-start gap-2">
                      <span className="text-amber-500 text-xl flex-shrink-0">📝</span>
                      <div>
                        <p className="text-xs font-bold text-amber-700 mb-0.5">{t('ملاحظات', 'Notes')}</p>
                        <p className="text-sm text-amber-900 font-medium">{qrMemberData.notes}</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Activities List */}
                  {qrMemberData.activities && qrMemberData.activities.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-600">{t('اختر النشاط لتسجيل الحضور:', 'Select activity to check-in:')}</p>
                      {qrMemberData.activities.map((act, idx) => (
                        <div
                          key={idx}
                          className={`p-4 rounded-lg border-2 ${
                            act.recorded_today 
                              ? 'bg-green-50 border-green-300' 
                              : 'bg-white border-gray-200'
                          }`}
                        >
                          <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                              {act.recorded_today ? (
                                <Check className="w-5 h-5 text-green-600" />
                              ) : (
                                <UserCheck className="w-5 h-5 text-blue-500" />
                              )}
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-lg">{act.activity_name}</p>
                              <p className="text-xs text-gray-500">
                                {t('من:', 'From:')} {act.start_date || '-'} | {t('إلى:', 'To:')} {act.end_date || '-'}
                              </p>
                            </div>
                          </div>
                          
                          {act.recorded_today ? (
                            <div className="bg-green-100 text-green-700 py-2 px-4 rounded-lg text-center font-bold">
                              ✓ {t('تم تسجيل الحضور اليوم', 'Checked in today')}
                            </div>
                          ) : (
                            <Button
                              onClick={() => handleQRActivityCheckin(act.activity_id, act.activity_name)}
                              disabled={qrLoading}
                              className="w-full bg-green-600 hover:bg-green-700 text-white py-3 text-lg font-bold gap-2"
                              data-testid={`checkin-btn-${act.activity_id}`}
                            >
                              <UserCheck className="w-5 h-5" />
                              {t('تسجيل الحضور', 'Check In')}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-orange-600 bg-orange-50 rounded-lg">
                      <X className="w-8 h-8 mx-auto mb-2" />
                      <p>{t('لا يوجد اشتراكات سارية', 'No active subscriptions')}</p>
                    </div>
                  )}
                  
                  {/* Expired Subscriptions */}
                  {qrMemberData.expiredActivities && qrMemberData.expiredActivities.length > 0 && (
                    <div className="space-y-3 mt-4">
                      <p className="text-sm font-medium text-red-600">{t('⚠️ اشتراكات منتهية:', '⚠️ Expired Subscriptions:')}</p>
                      {qrMemberData.expiredActivities.map((act, idx) => (
                        <div
                          key={idx}
                          className="p-4 rounded-lg border-2 bg-red-50 border-red-300"
                        >
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                              <X className="w-5 h-5 text-red-600" />
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-lg">{act.activity_name}</p>
                              <p className="text-xs text-gray-500">
                                {t('انتهى في:', 'Expired on:')} {act.end_date || '-'}
                              </p>
                            </div>
                          </div>
                          <div className="bg-red-100 text-red-700 py-2 px-4 rounded-lg text-center font-bold">
                            ⛔ {t('انتهى الاشتراك - يرجى التجديد', 'Subscription expired - Please renew')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Clear Button */}
                  <Button onClick={clearQRScan} variant="outline" className="w-full gap-2 mt-4">
                    <X className="w-4 h-4" />
                    {t('مسح وبدء من جديد', 'Clear and start over')}
                  </Button>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-500">
                  <QrCode className="w-16 h-16 mx-auto mb-3 opacity-30" />
                  <p>{t('امسح QR Code أو أدخل رقم العضوية', 'Scan QR Code or enter member ID')}</p>
                </div>
              )}
              
              {/* Scan Result */}
              {qrScanResult && (
                <div className={`mt-4 p-4 rounded-lg ${qrScanResult.error ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
                  <p className={`font-bold ${qrScanResult.error ? 'text-orange-700' : 'text-green-700'}`}>
                    {qrScanResult.message}
                  </p>
                  {!qrScanResult.error && qrScanResult.activity_name && (
                    <p className="text-sm text-gray-600 mt-1">
                      {qrScanResult.activity_name} - {qrScanResult.check_in_time}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Kiosk Mode Tab - USB Scanner */}
        {activeTab === 'kiosk' && (
          <div className="max-w-2xl mx-auto">
            <div className={`rounded-2xl border-4 transition-all ${kioskMode ? 'border-green-500 bg-gradient-to-br from-green-50 to-blue-50' : 'border-gray-200 bg-white'} p-8 shadow-lg`}>
              {/* Header */}
              <div className="text-center mb-8">
                <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${kioskMode ? 'bg-green-500 animate-pulse' : 'bg-gray-200'}`}>
                  <Scan className={`w-10 h-10 ${kioskMode ? 'text-white' : 'text-gray-500'}`} />
                </div>
                <h2 className="text-2xl font-bold text-gray-800">
                  {t('وضع جهاز المسح', 'Scanner Device Mode')}
                </h2>
                <p className="text-gray-500 mt-2">
                  {t('تسجيل الحضور باستخدام جهاز QR Scanner خارجي', 'Check-in using external QR Scanner device')}
                </p>
              </div>

              {/* Activity Category Selection */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  🏃 {t('النشاط', 'Activity')} *
                </label>
                <select
                  value={kioskCategoryId}
                  onChange={(e) => setKioskCategoryId(e.target.value)}
                  className="w-full border-2 rounded-xl p-4 text-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  disabled={kioskMode}
                >
                  <option value="">{t('اختر النشاط', 'Select Activity')}</option>
                  {availableCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              {/* Sound Toggle */}
              <div className="flex items-center justify-between mb-6 p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-3">
                  {kioskSoundEnabled ? <Volume2 className="w-5 h-5 text-blue-600" /> : <VolumeX className="w-5 h-5 text-gray-400" />}
                  <span className="font-medium">{t('الصوت', 'Sound')}</span>
                </div>
                <Button
                  variant={kioskSoundEnabled ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setKioskSoundEnabled(!kioskSoundEnabled)}
                >
                  {kioskSoundEnabled ? t('مفعّل', 'On') : t('مغلق', 'Off')}
                </Button>
              </div>

              {/* Activate Button */}
              {!kioskMode ? (
                <Button
                  onClick={() => setKioskMode(true)}
                  disabled={!kioskCategoryId}
                  className="w-full py-6 text-xl gap-3 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600"
                >
                  <Scan className="w-6 h-6" />
                  {t('تفعيل وضع المسح', 'Activate Scanner Mode')}
                </Button>
              ) : (
                <Button
                  onClick={() => setKioskMode(false)}
                  variant="destructive"
                  className="w-full py-6 text-xl gap-3"
                >
                  <X className="w-6 h-6" />
                  {t('إيقاف وضع المسح', 'Stop Scanner Mode')}
                </Button>
              )}

              {/* Active Status */}
              {kioskMode && (
                <div className="mt-8 text-center">
                  <div className="inline-flex items-center gap-2 px-6 py-3 bg-green-100 text-green-700 rounded-full font-bold animate-pulse">
                    <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                    {t('جاهز للمسح - امسح QR Code العضو', 'Ready - Scan Member QR Code')}
                  </div>
                  
                  {/* Buffer display */}
                  {kioskBuffer && (
                    <div className="mt-4 p-4 bg-blue-50 rounded-xl">
                      <p className="text-sm text-gray-500 mb-1">{t('جاري القراءة...', 'Reading...')}</p>
                      <p className="text-2xl font-mono font-bold text-blue-600">{kioskBuffer}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Last Scan Result */}
              {kioskLastScan && (
                <div className={`mt-6 p-6 rounded-2xl border-2 ${kioskLastScan.success ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <MemberAvatar
                        photo={kioskLastScan.memberPhoto}
                        name={kioskLastScan.memberName}
                        size="lg"
                        borderClass={kioskLastScan.success ? 'border-green-400' : 'border-red-400'}
                      />
                      <div>
                        <p className={`text-2xl font-bold ${kioskLastScan.success ? 'text-green-700' : 'text-red-700'}`}>
                          {kioskLastScan.memberName}
                        </p>
                        <p className={`text-lg ${kioskLastScan.success ? 'text-green-600' : 'text-red-600'}`}>
                          {kioskLastScan.message}
                        </p>
                      </div>
                    </div>
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${kioskLastScan.success ? 'bg-green-500' : 'bg-red-500'}`}>
                      {kioskLastScan.success ? <Check className="w-8 h-8 text-white" /> : <X className="w-8 h-8 text-white" />}
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">{kioskLastScan.time}</p>
                </div>
              )}

              {/* Instructions */}
              <div className="mt-8 p-4 bg-gray-50 rounded-xl">
                <h3 className="font-bold text-gray-700 mb-3">{t('تعليمات الاستخدام:', 'Instructions:')}</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">1</span>
                    {t('اختر النشاط المراد تسجيل الحضور له', 'Select the activity for check-in')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">2</span>
                    {t('اضغط "تفعيل وضع المسح"', 'Click "Activate Scanner Mode"')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">3</span>
                    {t('امسح QR Code العضو بجهاز المسح', 'Scan member QR Code with scanner device')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">4</span>
                    {t('سيتم تسجيل الحضور تلقائياً', 'Attendance will be recorded automatically')}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="space-y-4">
            {/* Report Filters */}
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h2 className="font-bold mb-4">{t('تقرير الحضور', 'Attendance Report')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {/* Activity */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('النشاط', 'Activity')}
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                    className="w-full border rounded-lg p-2 text-sm"
                  >
                    <option value="">{t('اختر النشاط', 'Select Activity')}</option>
                    {availableCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                {/* Level */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('المستوى', 'Level')}
                  </label>
                  <select
                    value={reportSelectedLevelId}
                    onChange={e => setReportSelectedLevelId(e.target.value)}
                    disabled={!selectedCategory || reportLevels.length === 0}
                    className="w-full border rounded-lg p-2 text-sm disabled:opacity-50"
                  >
                    <option value="">{reportLevels.length === 0 ? t('لا توجد مستويات', 'No levels') : t('كل المستويات', 'All Levels')}</option>
                    {reportLevels.map(lvl => (
                      <option key={lvl.id} value={lvl.id}>{lvl.display_name}</option>
                    ))}
                  </select>
                </div>
                {/* From Date */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('من تاريخ', 'From Date')}
                  </label>
                  <Input
                    type="date"
                    value={reportDateRange.start}
                    onChange={e => setReportDateRange(prev => ({ ...prev, start: e.target.value }))}
                  />
                </div>
                {/* To Date */}
                <div>
                  <label className="text-sm font-medium text-gray-600 block mb-1">
                    {t('إلى تاريخ', 'To Date')}
                  </label>
                  <Input
                    type="date"
                    value={reportDateRange.end}
                    onChange={e => setReportDateRange(prev => ({ ...prev, end: e.target.value }))}
                  />
                </div>
                {/* View Report */}
                <div className="flex items-end">
                  <Button onClick={handleFetchReport} disabled={!selectedCategory} className="w-full gap-2">
                    <Search className="w-4 h-4" />
                    {t('عرض', 'View')}
                  </Button>
                </div>
                {/* Export buttons */}
                <div className="flex items-end gap-2">
                  <Button onClick={() => handleExportAttendanceSummary('xlsx')} variant="outline" className="flex-1 gap-1 text-green-700 border-green-300 hover:bg-green-50" title="تصدير Excel">
                    <FileSpreadsheet className="w-4 h-4" />
                    <span className="hidden sm:inline">Excel</span>
                  </Button>
                  <Button onClick={() => handleExportAttendanceSummary('pdf')} variant="outline" className="flex-1 gap-1 text-red-600 border-red-300 hover:bg-red-50" title="تصدير PDF">
                    <FileText className="w-4 h-4" />
                    <span className="hidden sm:inline">PDF</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Report Data */}
            {reportData && (
              <div className="bg-white rounded-lg border shadow-sm">
                {/* Summary */}
                <div className="p-4 border-b bg-gray-50">
                  <h3 className="font-bold text-lg mb-3">{reportData.activity?.name}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-blue-600">{reportData.total_records}</div>
                      <div className="text-xs text-gray-600">{t('إجمالي السجلات', 'Total Records')}</div>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-green-600">{reportData.total_present}</div>
                      <div className="text-xs text-gray-600">{t('حضور', 'Present')}</div>
                    </div>
                    <div className="bg-red-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-red-600">{reportData.total_absent}</div>
                      <div className="text-xs text-gray-600">{t('غياب', 'Absent')}</div>
                    </div>
                    <div className="bg-purple-50 p-3 rounded-lg text-center">
                      <div className="text-2xl font-bold text-purple-600">
                        {reportData.total_records > 0 
                          ? Math.round(reportData.total_present / reportData.total_records * 100) 
                          : 0}%
                      </div>
                      <div className="text-xs text-gray-600">{t('نسبة الحضور', 'Attendance Rate')}</div>
                    </div>
                  </div>
                </div>

                {/* Member Stats */}
                <div className="p-4">
                  <h4 className="font-semibold mb-3">{t('إحصائيات الأعضاء', 'Member Statistics')}</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-3 text-right">{t('رقم العضوية', 'Member ID')}</th>
                          <th className="p-3 text-right">{t('العضو', 'Member')}</th>
                          <th className="p-3 text-center">{t('حضور', 'Present')}</th>
                          <th className="p-3 text-center">{t('غياب', 'Absent')}</th>
                          <th className="p-3 text-center">{t('الإجمالي', 'Total')}</th>
                          <th className="p-3 text-center">{t('النسبة', 'Rate')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {reportData.member_stats?.map(stat => (
                          <tr key={stat.member_id} className="hover:bg-gray-50">
                            <td className="p-3 font-mono text-primary font-bold">{stat.member_code || '-'}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <MemberAvatar
                                  photo={stat.member_photo}
                                  name={stat.member_name}
                                  size="sm"
                                />
                                <span>{stat.member_name}</span>
                              </div>
                            </td>
                            <td className="p-3 text-center text-green-600 font-medium">{stat.present}</td>
                            <td className="p-3 text-center text-red-600 font-medium">{stat.absent}</td>
                            <td className="p-3 text-center">{stat.total}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-1 rounded text-sm font-medium ${
                                stat.attendance_rate >= 80 ? 'bg-green-100 text-green-700' :
                                stat.attendance_rate >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {stat.attendance_rate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Daily Stats */}
                {reportData.date_stats?.length > 0 && (
                  <div className="p-4 border-t">
                    <h4 className="font-semibold mb-3">{t('إحصائيات يومية', 'Daily Statistics')}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                      {reportData.date_stats?.slice(0, 12).map(stat => (
                        <div key={stat.date} className="border rounded p-2 text-center text-sm">
                          <div className="font-medium">{stat.date}</div>
                          <div className="flex justify-center gap-2 mt-1">
                            <span className="text-green-600">{stat.present}✓</span>
                            <span className="text-red-600">{stat.absent}✗</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
