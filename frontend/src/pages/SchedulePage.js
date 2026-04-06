import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { schedulesAPI, branchesAPI, attendanceAPI, levelsAPI, activityNotesAPI, activitiesAPI } from '../services/api';
import { Calendar, Clock, Users, Check, X, UserCheck, ChevronLeft, ChevronRight, Printer, Layers, MessageSquarePlus, StickyNote, Trash2, BarChart3, UserX, TrendingUp } from 'lucide-react';

export default function SchedulePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [activitiesData, setActivitiesData] = useState([]);
  const [activitiesList, setActivitiesList] = useState([]); // Activities from Activities page
  const [branches, setBranches] = useState([]);
  const [levels, setLevels] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedTime, setSelectedTime] = useState('all'); // فلتر المواعيد
  const [selectedLevelFilter, setSelectedLevelFilter] = useState('all'); // فلتر المستويات
  const [selectedActivityType, setSelectedActivityType] = useState('all'); // فلتر نوع النشاط
  const [viewMode, setViewMode] = useState('by-activity'); // 'by-activity' | 'by-time'
  const [selectedHour, setSelectedHour] = useState(null); // الساعة المختارة في وضع by-time
  
  // Attendance dialog state
  const [attendanceDialog, setAttendanceDialog] = useState({
    open: false,
    member: null,
    activity: null,
    saving: false
  });

  // Today's attendance records
  const [todayAttendance, setTodayAttendance] = useState([]);

  // Notes dialog state
  const [notesDialog, setNotesDialog] = useState({
    open: false,
    activity: null,
    notes: [],
    loading: false
  });
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [notesCounts, setNotesCounts] = useState({}); // {activity_id: {count, latest_date}}

  // Day names
  const dayLabels = {
    sunday: { ar: 'الأحد', en: 'Sunday' },
    monday: { ar: 'الإثنين', en: 'Monday' },
    tuesday: { ar: 'الثلاثاء', en: 'Tuesday' },
    wednesday: { ar: 'الأربعاء', en: 'Wednesday' },
    thursday: { ar: 'الخميس', en: 'Thursday' },
    friday: { ar: 'الجمعة', en: 'Friday' },
    saturday: { ar: 'السبت', en: 'Saturday' }
  };

  // Get day of week from date
  const getDayOfWeek = (dateString) => {
    const date = new Date(dateString);
    const dayIndex = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return dayKeys[dayIndex];
  };

  // Get current selected day based on date
  const selectedDay = getDayOfWeek(selectedDate);

  // Activity styles
  const activityStyles = {
    'سباحة': { bg: 'bg-blue-600', light: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', icon: '🏊' },
    'swimming': { bg: 'bg-blue-600', light: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', icon: '🏊' },
    'كرة قدم': { bg: 'bg-green-600', light: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', icon: '⚽' },
    'كرة': { bg: 'bg-green-600', light: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', icon: '⚽' },
    'football': { bg: 'bg-green-600', light: 'bg-green-50', border: 'border-green-300', text: 'text-green-700', icon: '⚽' },
    'كاراتيه': { bg: 'bg-red-600', light: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', icon: '🥋' },
    'karate': { bg: 'bg-red-600', light: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', icon: '🥋' },
    'جمباز': { bg: 'bg-purple-600', light: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700', icon: '🤸' },
    'تنس': { bg: 'bg-yellow-600', light: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700', icon: '🎾' },
    'default': { bg: 'bg-gray-600', light: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700', icon: '🏃' }
  };

  const getActivityStyle = (name) => {
    const lowerName = (name || '').toLowerCase();
    for (const [key, style] of Object.entries(activityStyles)) {
      if (lowerName.includes(key.toLowerCase())) {
        return style;
      }
    }
    return activityStyles.default;
  };

  // Fetch initial data
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await branchesAPI.getAll();
        setBranches(res.data);
        if (user?.branch_id) {
          setSelectedBranchId(user.branch_id);
        }
      } catch (error) {
        console.error('Error fetching branches:', error);
      }
    };
    fetchBranches();
    fetchNotesCounts();
  }, [user]);

  // Fetch notes counts for all activities
  const fetchNotesCounts = async () => {
    try {
      const res = await activityNotesAPI.getCounts();
      setNotesCounts(res.data || {});
    } catch (error) {
      console.error('Error fetching notes counts:', error);
    }
  };

  // Fetch levels
  const fetchLevels = async () => {
    try {
      const params = {};
      if (selectedBranchId) params.branch_filter = selectedBranchId;
      const res = await levelsAPI.getAll(params);
      setLevels(res.data || []);
    } catch (error) {
      console.error('Error fetching levels:', error);
    }
  };

  // Fetch activities with members
  const fetchActivities = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedBranchId) params.branch_id = selectedBranchId;
      const branchParams = selectedBranchId ? { branch_filter: selectedBranchId } : {};
      
      if (selectedDate) params.date = selectedDate;
      const [activitiesRes, activitiesListRes, attendanceRes] = await Promise.all([
        schedulesAPI.getActivitiesWithMembers(params),
        activitiesAPI.getAll(branchParams),
        attendanceAPI.getAll({ date: selectedDate }).catch(() => ({ data: [] })),
        fetchLevels()
      ]);
      const data = Array.isArray(activitiesRes.data) ? activitiesRes.data : [];
      setActivitiesData(data);
      setActivitiesList(activitiesListRes.data || []);
      setTodayAttendance(Array.isArray(attendanceRes.data) ? attendanceRes.data : []);
    } catch (error) {
      console.error('Error fetching activities:', error);
      toast.error(t('خطأ في جلب البيانات', 'Error fetching data'));
      setActivitiesData([]);
      setActivitiesList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [selectedBranchId, selectedDate]);

  // Navigate to attendance
  const goToAttendance = (activityId) => {
    navigate(`/attendance?activity_id=${activityId}`);
  };

  // Open attendance dialog for a member
  const openAttendanceDialog = (member, activity) => {
    setAttendanceDialog({
      open: true,
      member,
      activity,
      saving: false
    });
  };

  // Record attendance (present or absent)
  const recordAttendance = async (status) => {
    const { member, activity } = attendanceDialog;
    if (!member || !activity) return;

    setAttendanceDialog(prev => ({ ...prev, saving: true }));

    try {
      await attendanceAPI.record({
        member_id: member.member_id,
        activity_id: activity.activity_id,
        date: selectedDate,
        status: status
      });

      toast.success(
        status === 'present' 
          ? t('تم تسجيل الحضور ✓', 'Attendance recorded ✓')
          : t('تم تسجيل الغياب ✗', 'Absence recorded ✗')
      );

      setTodayAttendance(prev => {
        const filtered = prev.filter(a => a.member_id !== member.member_id || a.activity_id !== activity.activity_id);
        return [...filtered, { member_id: member.member_id, activity_id: activity.activity_id, status, date: selectedDate }];
      });

      setAttendanceDialog({ open: false, member: null, activity: null, saving: false });
    } catch (error) {
      const errorMsg = error.response?.data?.detail;
      const message = typeof errorMsg === 'string' ? errorMsg : t('خطأ في التسجيل', 'Error recording');
      toast.error(message);
      setAttendanceDialog(prev => ({ ...prev, saving: false }));
    }
  };

  // Open notes dialog for an activity
  const openNotesDialog = async (activity) => {
    setNotesDialog({
      open: true,
      activity,
      notes: [],
      loading: true
    });
    setNewNoteText('');

    try {
      const res = await activityNotesAPI.getByActivity(activity.activity_id);
      setNotesDialog(prev => ({
        ...prev,
        notes: res.data || [],
        loading: false
      }));
    } catch (error) {
      toast.error(t('خطأ في جلب الملاحظات', 'Error fetching notes'));
      setNotesDialog(prev => ({ ...prev, loading: false }));
    }
  };

  // Add a new note
  const handleAddNote = async () => {
    if (!newNoteText.trim() || !notesDialog.activity) return;

    setSavingNote(true);
    try {
      const res = await activityNotesAPI.create({
        activity_id: notesDialog.activity.activity_id,
        activity_name: notesDialog.activity.activity_name,
        note_text: newNoteText.trim()
      });

      setNotesDialog(prev => ({
        ...prev,
        notes: [res.data, ...prev.notes]
      }));
      
      // Update notes count
      setNotesCounts(prev => ({
        ...prev,
        [notesDialog.activity.activity_id]: {
          count: (prev[notesDialog.activity.activity_id]?.count || 0) + 1,
          latest_date: new Date().toISOString()
        }
      }));
      
      setNewNoteText('');
      toast.success(t('تم إضافة الملاحظة ✓', 'Note added ✓'));
    } catch (error) {
      toast.error(t('خطأ في إضافة الملاحظة', 'Error adding note'));
    } finally {
      setSavingNote(false);
    }
  };

  // Delete a note
  const handleDeleteNote = async (noteId) => {
    if (!window.confirm(t('هل أنت متأكد من حذف هذه الملاحظة؟', 'Are you sure you want to delete this note?'))) {
      return;
    }

    try {
      await activityNotesAPI.delete(noteId);
      setNotesDialog(prev => ({
        ...prev,
        notes: prev.notes.filter(n => n.id !== noteId)
      }));
      
      // Update notes count
      if (notesDialog.activity) {
        setNotesCounts(prev => {
          const currentCount = prev[notesDialog.activity.activity_id]?.count || 1;
          if (currentCount <= 1) {
            const newCounts = { ...prev };
            delete newCounts[notesDialog.activity.activity_id];
            return newCounts;
          }
          return {
            ...prev,
            [notesDialog.activity.activity_id]: {
              ...prev[notesDialog.activity.activity_id],
              count: currentCount - 1
            }
          };
        });
      }
      
      toast.success(t('تم حذف الملاحظة', 'Note deleted'));
    } catch (error) {
      toast.error(t('خطأ في حذف الملاحظة', 'Error deleting note'));
    }
  };

  // Get member attendance status for today
  const getMemberAttendanceStatus = (memberId) => {
    const record = todayAttendance.find(a => a.member_id === memberId);
    return record ? record.status : null;
  };

  // Attendance stats for today
  const attendanceStats = useMemo(() => {
    const totalMembers = activitiesData.reduce((sum, a) => sum + getTotalMembersCount(a), 0);
    const present = todayAttendance.filter(a => a.status === 'present').length;
    const absent = todayAttendance.filter(a => a.status === 'absent').length;
    const rate = totalMembers > 0 ? Math.round((present / totalMembers) * 100) : 0;
    return { totalMembers, present, absent, rate };
  }, [activitiesData, todayAttendance, selectedDay]);

  function getTotalMembersCount(activity) {
    const uniqueMembers = new Set();
    Object.values(activity.times).forEach(timeData => {
      const dayMembers = timeData[selectedDay] || [];
      dayMembers.forEach(m => uniqueMembers.add(m.member_id));
    });
    return uniqueMembers.size;
  }

  // Get total members for an activity for selected day
  const getTotalMembers = (activity) => {
    const uniqueMembers = new Set();
    Object.values(activity.times).forEach(timeData => {
      const dayMembers = timeData[selectedDay] || [];
      dayMembers.forEach(m => uniqueMembers.add(m.member_id));
    });
    return uniqueMembers.size;
  };

  // Get all available times from activities
  const getAvailableTimes = () => {
    const times = new Set();
    activitiesData.forEach(activity => {
      Object.entries(activity.times).forEach(([time, timeData]) => {
        if ((timeData[selectedDay] || []).length > 0) {
          times.add(time);
        }
      });
    });
    return Array.from(times).sort();
  };

  // Reset selectedHour when activitiesData/day changes and the hour is no longer valid
  useEffect(() => {
    if (selectedHour !== null) {
      const available = getAvailableTimes();
      if (!available.includes(selectedHour)) {
        setSelectedHour(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activitiesData, selectedDay]);

  // Get activity types (swimming, football, karate, etc.)
  const getActivityTypes = () => {
    const types = new Map(); // Use Map to store type -> display name
    activitiesData.forEach(activity => {
      const name = activity.activity_name.toLowerCase();
      let type = '';
      let displayName = '';
      
      if (name.includes('سباح') || name.includes('swim')) {
        type = 'swimming';
        displayName = language === 'ar' ? 'السباحة' : 'Swimming';
      } else if (name.includes('قدم') || name.includes('football') || name.includes('soccer')) {
        type = 'football';
        displayName = language === 'ar' ? 'كرة القدم' : 'Football';
      } else if (name.includes('كارات') || name.includes('karate')) {
        type = 'karate';
        displayName = language === 'ar' ? 'الكاراتيه' : 'Karate';
      } else if (name.includes('جمباز') || name.includes('gym')) {
        type = 'gymnastics';
        displayName = language === 'ar' ? 'الجمباز' : 'Gymnastics';
      } else if (name.includes('سلة') || name.includes('basket')) {
        type = 'basketball';
        displayName = language === 'ar' ? 'كرة السلة' : 'Basketball';
      } else if (name.includes('تنس') || name.includes('tennis')) {
        type = 'tennis';
        displayName = language === 'ar' ? 'التنس' : 'Tennis';
      } else {
        type = 'other';
        displayName = language === 'ar' ? 'أخرى' : 'Other';
      }
      
      if (!types.has(type)) {
        types.set(type, displayName);
      }
    });
    return types;
  };

  // Check if activity matches selected type/activity
  const activityMatchesType = (activity) => {
    if (selectedActivityType === 'all') return true;
    
    // Check if it's a specific activity from Activities page (prefixed with "activity_")
    if (selectedActivityType.startsWith('activity_')) {
      const activityId = selectedActivityType.replace('activity_', '');
      const selectedActivity = activitiesList.find(a => a.id === activityId);
      if (selectedActivity) {
        const activityName = activity.activity_name?.toLowerCase() || '';
        const selectedName = (selectedActivity.name_ar || selectedActivity.name || '').toLowerCase();
        return activityName.includes(selectedName) || selectedName.includes(activityName.split(' ')[0]);
      }
      return false;
    }
    
    // Main activity type matching
    const name = (activity.activity_name || '').toLowerCase();
    switch (selectedActivityType) {
      case 'swimming':
        return name.includes('سباح') || name.includes('swim');
      case 'football':
        return name.includes('قدم') || name.includes('football') || name.includes('soccer');
      case 'karate':
        return name.includes('كارات') || name.includes('karate');
      case 'gymnastics':
        return name.includes('جمباز') || name.includes('gym');
      case 'basketball':
        return name.includes('سلة') || name.includes('basket');
      case 'tennis':
        return name.includes('تنس') || name.includes('tennis');
      case 'other':
        return !(name.includes('سباح') || name.includes('swim') || 
                 name.includes('قدم') || name.includes('football') || name.includes('soccer') ||
                 name.includes('كارات') || name.includes('karate') ||
                 name.includes('جمباز') || name.includes('gym') ||
                 name.includes('سلة') || name.includes('basket') ||
                 name.includes('تنس') || name.includes('tennis'));
      default:
        return true;
    }
  };

  // Get member's level for a specific activity
  const getMemberLevel = (memberId) => {
    for (const level of levels) {
      if (level.members && level.members.includes(memberId)) {
        return level;
      }
    }
    return null;
  };

  // Get level color
  const getLevelColor = (levelNum) => {
    const colors = {
      1: { bg: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700' },
      2: { bg: 'bg-green-500', light: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
      3: { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700' },
      4: { bg: 'bg-yellow-500', light: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700' },
      5: { bg: 'bg-orange-500', light: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700' },
      6: { bg: 'bg-red-500', light: 'bg-red-50', border: 'border-red-300', text: 'text-red-700' }
    };
    return colors[levelNum] || { bg: 'bg-gray-500', light: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700' };
  };

  // Group members by level
  const groupMembersByLevel = (members) => {
    const grouped = {};
    const noLevel = [];
    
    members.forEach(member => {
      const level = getMemberLevel(member.member_id);
      if (level) {
        const key = `${level.level_number}-${level.activity_name}`;
        if (!grouped[key]) {
          grouped[key] = {
            level_number: level.level_number,
            activity_name: level.activity_name,
            members: []
          };
        }
        grouped[key].members.push(member);
      } else {
        noLevel.push(member);
      }
    });
    
    // Sort by level number
    const sortedGroups = Object.values(grouped).sort((a, b) => a.level_number - b.level_number);
    
    return { levelGroups: sortedGroups, noLevel };
  };

  // Format date for display
  const formatDateDisplay = (dateString) => {
    const date = new Date(dateString);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', options);
  };

  // Navigate to previous/next day
  const changeDate = (days) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  // Go to today
  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Print schedule
  const handlePrint = () => {
    const dayName = language === 'ar' ? dayLabels[selectedDay].ar : dayLabels[selectedDay].en;
    
    // Get level colors for print
    const getLevelPrintColor = (levelNum) => {
      const colors = {
        1: '#8b5cf6', // purple
        2: '#22c55e', // green
        3: '#3b82f6', // blue
        4: '#eab308', // yellow
        5: '#f97316', // orange
        6: '#ef4444'  // red
      };
      return colors[levelNum] || '#9ca3af';
    };
    
    // Filter activities based on current filters
    let filteredActivities = activitiesData.filter(a => {
      // First check if activity has members
      if (getTotalMembers(a) <= 0) return false;
      
      // Apply activity type filter
      if (selectedActivityType === 'all') return true;
      
      // Check if it's a specific activity from Activities page (prefixed with "activity_")
      if (selectedActivityType.startsWith('activity_')) {
        const activityId = selectedActivityType.replace('activity_', '');
        const selectedActivity = activitiesList.find(act => act.id === activityId);
        if (selectedActivity) {
          const activityName = a.activity_name?.toLowerCase() || '';
          const selectedName = (selectedActivity.name_ar || selectedActivity.name || '').toLowerCase();
          return activityName.includes(selectedName) || selectedName.includes(activityName.split(' ')[0]);
        }
        return false;
      }
      
      // Main activity type matching
      const name = (a.activity_name || '').toLowerCase();
      switch (selectedActivityType) {
        case 'swimming':
          return name.includes('سباح') || name.includes('swim');
        case 'football':
          return name.includes('قدم') || name.includes('football') || name.includes('soccer');
        case 'karate':
          return name.includes('كارات') || name.includes('karate');
        case 'gymnastics':
          return name.includes('جمباز') || name.includes('gym');
        case 'basketball':
          return name.includes('سلة') || name.includes('basket');
        case 'tennis':
          return name.includes('تنس') || name.includes('tennis');
        case 'other':
          return !(name.includes('سباح') || name.includes('swim') || 
                   name.includes('قدم') || name.includes('football') || name.includes('soccer') ||
                   name.includes('كارات') || name.includes('karate') ||
                   name.includes('جمباز') || name.includes('gym') ||
                   name.includes('سلة') || name.includes('basket') ||
                   name.includes('تنس') || name.includes('tennis'));
        default:
          return true;
      }
    });
    
    const printContent = `
      <!DOCTYPE html>
      <html dir="${language === 'ar' ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="UTF-8">
        <title>${t('جدول الأنشطة', 'Activity Schedule')} - ${selectedDate}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Segoe UI', Tahoma, Arial, sans-serif; 
            padding: 20px;
            direction: ${language === 'ar' ? 'rtl' : 'ltr'};
          }
          .header { 
            text-align: center; 
            margin-bottom: 20px; 
            padding-bottom: 15px;
            border-bottom: 2px solid #f97316;
          }
          .header h1 { 
            color: #f97316; 
            font-size: 24px; 
            margin-bottom: 5px;
          }
          .header .date { 
            font-size: 18px; 
            color: #333;
            font-weight: bold;
          }
          .header .day { 
            font-size: 16px; 
            color: #666;
          }
          .filters-info {
            text-align: center;
            margin: 10px 0;
            font-size: 12px;
            color: #666;
          }
          .filters-info span {
            background: #f3f4f6;
            padding: 2px 8px;
            border-radius: 4px;
            margin: 0 4px;
          }
          .stats {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin: 10px 0;
          }
          .stat {
            text-align: center;
          }
          .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #f97316;
          }
          .stat-label {
            font-size: 12px;
            color: #666;
          }
          .activities-container {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .activity-card {
            border: 2px solid #ddd;
            border-radius: 8px;
            overflow: hidden;
            break-inside: avoid;
          }
          .activity-header {
            background: #f97316;
            color: white;
            padding: 8px 10px;
            font-weight: bold;
            font-size: 13px;
          }
          .activity-header .count {
            font-size: 10px;
            opacity: 0.9;
            margin-top: 2px;
          }
          .times-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
            padding: 8px;
            background: #fff9f5;
          }
          .time-slot {
            background: white;
            border-radius: 6px;
            border: 1px solid #eee;
            overflow: hidden;
          }
          .time-header {
            background: #fef3e8;
            padding: 5px 8px;
            font-weight: bold;
            font-size: 11px;
            color: #f97316;
            border-bottom: 1px solid #eee;
          }
          .time-count {
            color: #888;
            font-weight: normal;
          }
          .level-group {
            margin: 4px;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid #ddd;
          }
          .level-header {
            color: white;
            padding: 3px 6px;
            font-size: 9px;
            font-weight: bold;
          }
          .level-members {
            padding: 4px;
          }
          .member-item {
            padding: 2px 4px;
            margin: 1px 0;
            background: #f9f9f9;
            border-radius: 3px;
            font-size: 9px;
          }
          .member-name {
            font-weight: 500;
          }
          .no-level-group {
            background: #f3f4f6;
            border-color: #d1d5db;
          }
          .no-level-header {
            background: #9ca3af;
          }
          .footer {
            margin-top: 15px;
            text-align: center;
            font-size: 8px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 5px;
          }
          .empty-message {
            text-align: center;
            padding: 20px;
            color: #666;
          }
          @media print {
            @page {
              size: A4 landscape;
              margin: 3mm;
            }
            body { 
              padding: 3px;
              font-size: 8px;
            }
            .header { margin-bottom: 5px; }
            .header h1 { font-size: 12px; margin-bottom: 3px; }
            .header .date { font-size: 10px; }
            .header .day { font-size: 9px; }
            .stats { margin: 5px 0; gap: 20px; }
            .stat-value { font-size: 14px; }
            .stat-label { font-size: 8px; }
            .activities-container { grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .activity-header { font-size: 10px; padding: 5px 8px; }
            .activity-header .count { font-size: 8px; }
            .times-grid { 
              grid-template-columns: repeat(3, 1fr);
              gap: 4px;
              padding: 5px;
            }
            .time-header { font-size: 9px; padding: 3px 5px; }
            .level-group { margin: 3px; }
            .level-header { font-size: 8px; padding: 2px 4px; }
            .level-members { padding: 3px; }
            .member-item { font-size: 8px; padding: 1px 3px; margin: 1px 0; }
            .footer { margin-top: 5px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏆 ${t('شركة اداء الابطال العالمية للرياضة', 'World Champions Performance Academy')}</h1>
          <div class="date">${t('جدول الأنشطة', 'Activity Schedule')} - ${selectedDate}</div>
          <div class="day">${dayName}</div>
        </div>
        
        ${(selectedActivityType !== 'all' || selectedTime !== 'all' || selectedLevelFilter !== 'all') ? `
          <div class="filters-info">
            ${t('الفلاتر المطبقة', 'Applied Filters')}:
            ${selectedActivityType !== 'all' ? `<span>🏃 ${
              selectedActivityType === 'swimming' ? t('السباحة', 'Swimming') :
              selectedActivityType === 'football' ? t('كرة القدم', 'Football') :
              selectedActivityType === 'karate' ? t('الكاراتيه', 'Karate') :
              selectedActivityType === 'gymnastics' ? t('الجمباز', 'Gymnastics') :
              selectedActivityType === 'basketball' ? t('كرة السلة', 'Basketball') :
              selectedActivityType === 'tennis' ? t('التنس', 'Tennis') :
              selectedActivityType === 'other' ? t('أخرى', 'Other') :
              selectedActivityType.startsWith('activity_') ? (activitiesList.find(a => a.id === selectedActivityType.replace('activity_', ''))?.name_ar || '') :
              selectedActivityType
            }</span>` : ''}
            ${selectedTime !== 'all' ? `<span>🕐 ${selectedTime}</span>` : ''}
            ${selectedLevelFilter !== 'all' ? `<span>🎯 ${selectedLevelFilter === 'none' ? t('بدون مستوى', 'No Level') : levels.find(l => l.id === selectedLevelFilter)?.activity_name || ''}</span>` : ''}
          </div>
        ` : ''}
        
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${filteredActivities.length}</div>
            <div class="stat-label">${t('نشاط', 'Activities')}</div>
          </div>
          <div class="stat">
            <div class="stat-value">${filteredActivities.reduce((sum, a) => sum + getTotalMembers(a), 0)}</div>
            <div class="stat-label">${t('مشترك', 'Members')}</div>
          </div>
        </div>
        
        ${filteredActivities.length > 0 ? `
          <div class="activities-container">
            ${filteredActivities.map(activity => {
              // Get times filtered
              let timesWithMembers = Object.entries(activity.times)
                .filter(([time, timeData]) => (timeData[selectedDay] || []).length > 0)
                .sort(([a], [b]) => a.localeCompare(b));
              
              // Apply time filter
              if (selectedTime !== 'all') {
                timesWithMembers = timesWithMembers.filter(([time]) => time === selectedTime);
              }
              
              if (timesWithMembers.length === 0) return '';
              
              return `
                <div class="activity-card">
                  <div class="activity-header">
                    ${activity.activity_name}
                    <div class="count">${getTotalMembers(activity)} ${t('مشترك', 'members')} • ${timesWithMembers.length} ${t('أوقات', 'times')}</div>
                  </div>
                  <div class="times-grid">
                    ${timesWithMembers.map(([time, timeData]) => {
                      let members = timeData[selectedDay] || [];
                      
                      // Apply level filter
                      if (selectedLevelFilter !== 'all') {
                        members = members.filter(member => {
                          const memberLevel = getMemberLevel(member.member_id);
                          if (selectedLevelFilter === 'none') {
                            return !memberLevel;
                          }
                          return memberLevel && memberLevel.id === selectedLevelFilter;
                        });
                      }
                      
                      if (members.length === 0) return '';
                      
                      // Group by level
                      const { levelGroups, noLevel } = groupMembersByLevel(members);
                      
                      return `
                        <div class="time-slot">
                          <div class="time-header">
                            🕐 ${time === 'غير محدد' ? t('بدون وقت', 'No time') : time}
                            <span class="time-count">(${members.length})</span>
                          </div>
                          
                          ${levelGroups.map(group => `
                            <div class="level-group">
                              <div class="level-header" style="background: ${getLevelPrintColor(group.level_number)}">
                                ${t('المستوى', 'Level')} ${group.level_number} - ${group.activity_name} (${group.members.length})
                              </div>
                              <div class="level-members">
                                ${group.members.map(m => `
                                  <div class="member-item">
                                    <span class="member-name">${m.member_name}</span>
                                  </div>
                                `).join('')}
                              </div>
                            </div>
                          `).join('')}
                          
                          ${noLevel.length > 0 ? `
                            <div class="level-group no-level-group">
                              <div class="level-header no-level-header">
                                ${t('بدون مستوى', 'No Level')} (${noLevel.length})
                              </div>
                              <div class="level-members">
                                ${noLevel.map(m => `
                                  <div class="member-item">
                                    <span class="member-name">${m.member_name}</span>
                                  </div>
                                `).join('')}
                              </div>
                            </div>
                          ` : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="empty-message">
            ${t('لا يوجد مشتركين في هذا اليوم', 'No members scheduled for this day')}
          </div>
        `}
        
        <div class="footer">
          ${t('تم الطباعة بتاريخ', 'Printed on')}: ${new Date().toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US')}
        </div>
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  return (
    <Layout title={t('الجدول', 'Schedule')}>
      <div className="p-4 md:p-6 max-w-6xl mx-auto" data-testid="schedule-page">
        {/* Prominent Date & Day Header */}
        <div className="bg-gradient-to-r from-primary to-orange-500 text-white rounded-xl p-5 mb-5 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3">
                <Calendar className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  {language === 'ar' ? dayLabels[selectedDay]?.ar : dayLabels[selectedDay]?.en}
                </h1>
                <p className="text-sm opacity-90 mt-0.5">
                  {formatDateDisplay(selectedDate)}
                </p>
                <p className="text-xs opacity-75 mt-0.5">
                  {new Date(selectedDate).toLocaleDateString('ar-SA-u-ca-islamic', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 items-center bg-white/15 rounded-lg p-1">
                <Button variant="ghost" size="icon" onClick={() => changeDate(-1)} className="h-8 w-8 text-white hover:bg-white/20">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-36 bg-white/20 border-0 text-white text-sm h-8 [color-scheme:dark]" />
                <Button variant="ghost" size="icon" onClick={() => changeDate(1)} className="h-8 w-8 text-white hover:bg-white/20">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
              <Button variant="secondary" onClick={goToToday} className="h-8 px-3 text-xs">{t('اليوم', 'Today')}</Button>
              <Button variant="secondary" onClick={handlePrint} className="h-8 px-3 gap-1 text-xs">
                <Printer className="w-3.5 h-3.5" />{t('طباعة', 'Print')}
              </Button>
            </div>
          </div>
        </div>

        {/* Attendance Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-blue-100">
            <CardContent className="p-3 text-center">
              <Users className="w-5 h-5 mx-auto mb-1 text-blue-600" />
              <p className="text-2xl font-bold text-blue-700">{attendanceStats.totalMembers}</p>
              <p className="text-[10px] text-blue-600">{t('إجمالي المشتركين', 'Total Members')}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-green-100">
            <CardContent className="p-3 text-center">
              <UserCheck className="w-5 h-5 mx-auto mb-1 text-green-600" />
              <p className="text-2xl font-bold text-green-700">{attendanceStats.present}</p>
              <p className="text-[10px] text-green-600">{t('حاضرين', 'Present')}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-red-50 to-red-100">
            <CardContent className="p-3 text-center">
              <UserX className="w-5 h-5 mx-auto mb-1 text-red-600" />
              <p className="text-2xl font-bold text-red-700">{attendanceStats.absent}</p>
              <p className="text-[10px] text-red-600">{t('غائبين', 'Absent')}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-purple-100">
            <CardContent className="p-3 text-center">
              <TrendingUp className="w-5 h-5 mx-auto mb-1 text-purple-600" />
              <p className="text-2xl font-bold text-purple-700">{attendanceStats.rate}%</p>
              <p className="text-[10px] text-purple-600">{t('نسبة الحضور', 'Attendance Rate')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters Row */}
        <div className="bg-white rounded-lg border p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            {/* Activity Type Filter - Grouped by main activity type */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                🏃 {t('النشاط', 'Activity')}
              </label>
              <select
                value={selectedActivityType}
                onChange={e => setSelectedActivityType(e.target.value)}
                className="border rounded-lg p-2 text-sm w-44"
              >
                <option value="all">{t('كل الأنشطة', 'All Activities')}</option>
                
                {/* Swimming Group */}
                <optgroup label={t('🏊 السباحة', '🏊 Swimming')}>
                  <option value="swimming">{t('كل السباحة', 'All Swimming')}</option>
                  {activitiesList
                    .filter(a => (a.name_ar || a.name || '').toLowerCase().includes('سباح') || (a.name || '').toLowerCase().includes('swim'))
                    .map(activity => (
                      <option key={activity.id} value={`activity_${activity.id}`}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </option>
                    ))
                  }
                </optgroup>
                
                {/* Football Group */}
                <optgroup label={t('⚽ كرة القدم', '⚽ Football')}>
                  <option value="football">{t('كل كرة القدم', 'All Football')}</option>
                  {activitiesList
                    .filter(a => (a.name_ar || a.name || '').toLowerCase().includes('قدم') || (a.name || '').toLowerCase().includes('football'))
                    .map(activity => (
                      <option key={activity.id} value={`activity_${activity.id}`}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </option>
                    ))
                  }
                </optgroup>
                
                {/* Karate Group */}
                <optgroup label={t('🥋 الكاراتيه', '🥋 Karate')}>
                  <option value="karate">{t('كل الكاراتيه', 'All Karate')}</option>
                  {activitiesList
                    .filter(a => (a.name_ar || a.name || '').toLowerCase().includes('كارات') || (a.name || '').toLowerCase().includes('karate'))
                    .map(activity => (
                      <option key={activity.id} value={`activity_${activity.id}`}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </option>
                    ))
                  }
                </optgroup>
                
                {/* Other Activities */}
                <optgroup label={t('📋 أنشطة أخرى', '📋 Other Activities')}>
                  {activitiesList
                    .filter(a => {
                      const name = (a.name_ar || a.name || '').toLowerCase();
                      return !name.includes('سباح') && !name.includes('swim') &&
                             !name.includes('قدم') && !name.includes('football') &&
                             !name.includes('كارات') && !name.includes('karate');
                    })
                    .map(activity => (
                      <option key={activity.id} value={`activity_${activity.id}`}>
                        {language === 'ar' ? activity.name_ar : activity.name}
                      </option>
                    ))
                  }
                </optgroup>
              </select>
            </div>

            {/* Time Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                🕐 {t('الموعد', 'Time')}
              </label>
              <select
                value={selectedTime}
                onChange={e => setSelectedTime(e.target.value)}
                className="border rounded-lg p-2 text-sm w-32"
              >
                <option value="all">{t('كل المواعيد', 'All Times')}</option>
                {getAvailableTimes().map(time => (
                  <option key={time} value={time}>
                    {time === 'غير محدد' ? t('بدون وقت', 'No time') : time}
                  </option>
                ))}
              </select>
            </div>

            {/* Level Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                🎯 {t('المستوى', 'Level')}
              </label>
              <select
                value={selectedLevelFilter}
                onChange={e => setSelectedLevelFilter(e.target.value)}
                className="border rounded-lg p-2 text-sm w-40"
              >
                <option value="all">{t('كل المستويات', 'All Levels')}</option>
                <option value="none">{t('بدون مستوى', 'No Level')}</option>
                {levels.map(level => (
                  <option key={level.id} value={level.id}>
                    {t('المستوى', 'Level')} {level.level_number} - {level.activity_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                🏢 {t('الفرع', 'Branch')}
              </label>
              <select
                value={selectedBranchId}
                onChange={e => setSelectedBranchId(e.target.value)}
                className="border rounded-lg p-2 text-sm w-36"
              >
                <option value="">{t('كل الفروع', 'All Branches')}</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* Stats */}
            <div className="flex gap-3 ms-auto items-end">
              <div className="bg-primary/10 px-4 py-2 rounded-lg text-center">
                <div className="text-xl font-bold text-primary">{activitiesData.filter(a => getTotalMembers(a) > 0).length}</div>
                <div className="text-xs text-gray-500">{t('نشاط', 'Activities')}</div>
              </div>
              <div className="bg-green-100 px-4 py-2 rounded-lg text-center">
                <div className="text-xl font-bold text-green-600">
                  {activitiesData.reduce((sum, a) => sum + getTotalMembers(a), 0)}
                </div>
                <div className="text-xs text-gray-500">{t('مشترك', 'Members')}</div>
              </div>
              {/* View Mode Toggle */}
              <div className="flex rounded-lg border overflow-hidden shadow-sm">
                <button
                  onClick={() => setViewMode('by-activity')}
                  className={`px-3 py-2 text-xs font-medium flex items-center gap-1 transition-colors ${viewMode === 'by-activity' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  {t('حسب النشاط', 'By Activity')}
                </button>
                <button
                  onClick={() => { setViewMode('by-time'); setSelectedHour(null); }}
                  className={`px-3 py-2 text-xs font-medium flex items-center gap-1 transition-colors border-s ${viewMode === 'by-time' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  {t('حسب الوقت', 'By Time')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-20">
            <div className="spinner mx-auto"></div>
            <p className="mt-2 text-gray-500">{t('جاري التحميل...', 'Loading...')}</p>
          </div>
        )}

        {/* ══ BY-TIME VIEW ══ */}
        {!loading && viewMode === 'by-time' && (() => {
          const allTimes = getAvailableTimes();
          const displayHour = selectedHour || (allTimes[0] ?? null);
          return (
            <div className="space-y-4">
              {/* Hour selector */}
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  {t('اختر الساعة', 'Select Hour')}
                </p>
                {allTimes.length === 0 ? (
                  <p className="text-sm text-gray-400">{t('لا توجد مواعيد لهذا اليوم', 'No times for this day')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allTimes.map(time => (
                      <button
                        key={time}
                        onClick={() => setSelectedHour(time)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                          displayHour === time
                            ? 'bg-primary text-white border-primary shadow-md'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-primary/50 hover:bg-primary/5'
                        }`}
                      >
                        {time === 'غير محدد' ? t('بدون وقت محدد', 'No specific time') : time}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Activities for selected hour */}
              {displayHour && (() => {
                const activitiesAtHour = activitiesData
                  .filter(a => activityMatchesType(a))
                  .map(activity => {
                    const timeData = activity.times[displayHour];
                    const members = timeData ? (timeData[selectedDay] || []) : [];
                    return { activity, members };
                  })
                  .filter(({ members }) => members.length > 0);

                if (activitiesAtHour.length === 0) {
                  return (
                    <div className="text-center py-16 text-gray-400">
                      <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{t('لا يوجد أنشطة في هذه الساعة', 'No activities at this hour')}</p>
                    </div>
                  );
                }

                return (
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-base font-bold text-gray-800">
                        {displayHour === 'غير محدد' ? t('بدون وقت محدد', 'No specific time') : displayHour}
                      </h3>
                      <span className="bg-primary/10 text-primary text-xs font-semibold px-2.5 py-1 rounded-full">
                        {activitiesAtHour.length} {t('نشاط', 'activities')}
                        &nbsp;•&nbsp;
                        {activitiesAtHour.reduce((s, { members }) => s + members.length, 0)} {t('مشترك', 'members')}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {activitiesAtHour.map(({ activity, members }) => {
                        const style = getActivityStyle(activity.activity_name);
                        return (
                          <div key={activity.activity_id} className={`rounded-xl border-2 ${style.border} overflow-hidden shadow-sm`}>
                            {/* Card header */}
                            <div className={`${style.bg} text-white px-4 py-3 flex items-center justify-between`}>
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{style.icon}</span>
                                <span className="font-bold text-sm">{activity.activity_name}</span>
                              </div>
                              <span className="bg-white/25 text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {members.length}
                              </span>
                            </div>
                            {/* Members list */}
                            <div className="bg-white divide-y max-h-64 overflow-y-auto">
                              {members.map((member, idx) => {
                                const memberLevel = getMemberLevel(member.member_id);
                                const initials = (member.member_name || '?').charAt(0).toUpperCase();
                                return (
                                  <div key={member.member_id || idx} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                                    <div className={`w-8 h-8 rounded-full ${style.bg} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                                      {initials}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-800 truncate">{member.member_name}</p>
                                      {member.member_code && (
                                        <p className="text-xs text-gray-400">#{member.member_code}</p>
                                      )}
                                    </div>
                                    {memberLevel && (
                                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full shrink-0">
                                        {t('م', 'L')}{memberLevel.level_number}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Activities Cards (by-activity mode) */}
        {!loading && viewMode === 'by-activity' && (
          <div className="space-y-4">
            {activitiesData.length > 0 ? (
              activitiesData.map(activity => {
                const style = getActivityStyle(activity.activity_name);
                const totalMembers = getTotalMembers(activity);
                
                // Apply activity type filter
                if (!activityMatchesType(activity)) {
                  return null;
                }
                
                // Get times that have members for selected day, filtered by time filter
                let timesWithMembers = Object.entries(activity.times)
                  .filter(([time, timeData]) => (timeData[selectedDay] || []).length > 0)
                  .sort(([a], [b]) => a.localeCompare(b));
                
                // Apply time filter
                if (selectedTime !== 'all') {
                  timesWithMembers = timesWithMembers.filter(([time]) => time === selectedTime);
                }
                
                // Apply level filter to check if activity has any matching members
                if (selectedLevelFilter !== 'all') {
                  timesWithMembers = timesWithMembers.filter(([time, timeData]) => {
                    const members = timeData[selectedDay] || [];
                    return members.some(member => {
                      const memberLevel = getMemberLevel(member.member_id);
                      if (selectedLevelFilter === 'none') {
                        return !memberLevel;
                      }
                      return memberLevel && memberLevel.id === selectedLevelFilter;
                    });
                  });
                }
                
                if (timesWithMembers.length === 0) return null;
                
                return (
                  <div 
                    key={activity.activity_id}
                    className={`rounded-xl border-2 ${style.border} overflow-hidden shadow-sm`}
                  >
                    {/* Activity Header */}
                    {(() => {
                      const actPresent = todayAttendance.filter(a => a.activity_id === activity.activity_id && a.status === 'present').length;
                      const actRate = totalMembers > 0 ? Math.round((actPresent / totalMembers) * 100) : 0;
                      return (
                    <div className={`${style.bg} text-white p-3 flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{style.icon}</span>
                        <div>
                          <h2 className="font-bold text-lg">{activity.activity_name}</h2>
                          <div className="flex items-center gap-2 text-sm opacity-90">
                            <Users className="w-4 h-4" />
                            <span>{totalMembers} {t('مشترك', 'members')}</span>
                            {actPresent > 0 && (
                              <>
                                <span className="opacity-60">•</span>
                                <UserCheck className="w-4 h-4" />
                                <span>{actPresent} {t('حاضر', 'present')} ({actRate}%)</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openNotesDialog(activity)}
                          className="bg-white/20 hover:bg-white/30 text-white border-0 gap-1 relative"
                          title={t('ملاحظات', 'Notes')}
                        >
                          <StickyNote className="w-4 h-4" />
                          {t('ملاحظات', 'Notes')}
                          {notesCounts[activity.activity_id]?.count > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                              {notesCounts[activity.activity_id].count}
                            </span>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => goToAttendance(activity.activity_id)}
                          className="bg-white/20 hover:bg-white/30 text-white border-0"
                        >
                          {t('صفحة الحضور', 'Attendance')}
                        </Button>
                      </div>
                    </div>
                      );
                    })()}

                    {/* Time Slots */}
                    <div className={`${style.light} p-4`}>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {timesWithMembers.map(([time, timeData]) => {
                          let members = timeData[selectedDay] || [];
                          
                          // Apply level filter to members
                          if (selectedLevelFilter !== 'all') {
                            members = members.filter(member => {
                              const memberLevel = getMemberLevel(member.member_id);
                              if (selectedLevelFilter === 'none') {
                                return !memberLevel;
                              }
                              return memberLevel && memberLevel.id === selectedLevelFilter;
                            });
                          }
                          
                          if (members.length === 0) return null;
                          
                          const { levelGroups, noLevel } = groupMembersByLevel(members);
                          
                          return (
                            <div key={time} className="bg-white rounded-lg border shadow-sm overflow-hidden">
                              {/* Time Header */}
                              {(() => {
                                const presentInSlot = members.filter(m => getMemberAttendanceStatus(m.member_id) === 'present').length;
                                const slotRate = members.length > 0 ? Math.round((presentInSlot / members.length) * 100) : 0;
                                return (
                                <div className={`${style.bg} bg-opacity-20 px-3 py-2 border-b`}>
                                  <div className="flex items-center gap-2">
                                    <Clock className={`w-4 h-4 ${style.text}`} />
                                    <span className={`font-bold ${style.text}`}>
                                      {time === 'غير محدد' ? t('بدون وقت محدد', 'No time') : time}
                                    </span>
                                    <span className="text-gray-500 text-sm">({members.length})</span>
                                    {presentInSlot > 0 && (
                                      <Badge className="ms-auto bg-green-100 text-green-700 text-[10px] border-green-200">
                                        ✓ {presentInSlot}/{members.length}
                                      </Badge>
                                    )}
                                  </div>
                                  {todayAttendance.length > 0 && (
                                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1.5">
                                      <div className={`h-1.5 rounded-full transition-all ${slotRate >= 80 ? 'bg-green-500' : slotRate >= 50 ? 'bg-yellow-500' : 'bg-gray-400'}`}
                                        style={{ width: `${slotRate}%` }} />
                                    </div>
                                  )}
                                </div>
                                );
                              })()}
                              
                              {/* Members grouped by Level */}
                              <div className="p-2 space-y-3">
                                {/* Level Groups */}
                                {levelGroups.map((group, groupIdx) => {
                                  const levelColor = getLevelColor(group.level_number);
                                  return (
                                    <div key={groupIdx} className={`rounded-lg ${levelColor.light} border ${levelColor.border} overflow-hidden`}>
                                      {/* Level Header */}
                                      <div className={`${levelColor.bg} text-white px-2 py-1 flex items-center gap-1 text-xs font-medium`}>
                                        <Layers className="w-3 h-3" />
                                        <span>{t('المستوى', 'Level')} {group.level_number}</span>
                                        <span className="opacity-75">- {group.activity_name}</span>
                                        <span className="ms-auto bg-white/20 px-1.5 py-0.5 rounded text-xs">
                                          {group.members.length}
                                        </span>
                                      </div>
                                      {/* Level Members */}
                                      <div className="p-1.5 space-y-1">
                                        {group.members.map((member, idx) => {
                                          const attStatus = getMemberAttendanceStatus(member.member_id);
                                          return (
                                          <div 
                                            key={idx}
                                            onClick={() => openAttendanceDialog(member, activity)}
                                            className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-all group ${
                                              attStatus === 'present' ? 'bg-green-50 border border-green-200' :
                                              attStatus === 'absent' ? 'bg-red-50 border border-red-200' :
                                              'bg-white hover:bg-blue-50'
                                            }`}
                                            title={t('انقر لتسجيل الحضور', 'Click to record attendance')}
                                          >
                                            <div className={`w-6 h-6 rounded-full ${
                                              attStatus === 'present' ? 'bg-green-500' :
                                              attStatus === 'absent' ? 'bg-red-500' :
                                              levelColor.bg
                                            } text-white flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform`}>
                                              {attStatus === 'present' ? '✓' : attStatus === 'absent' ? '✗' : (member.member_name || '?').charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className={`font-medium text-xs truncate ${
                                                attStatus === 'present' ? 'text-green-700' :
                                                attStatus === 'absent' ? 'text-red-600 line-through' :
                                                'group-hover:text-blue-600'
                                              }`}>
                                                {member.member_name}
                                              </div>
                                            </div>
                                            {attStatus === 'present' && <Badge className="bg-green-500 text-white text-[9px] px-1 h-4">{t('حاضر', 'P')}</Badge>}
                                            {attStatus === 'absent' && <Badge className="bg-red-500 text-white text-[9px] px-1 h-4">{t('غائب', 'A')}</Badge>}
                                            {!attStatus && <UserCheck className="w-3 h-3 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />}
                                          </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                                
                                {/* Members without Level */}
                                {noLevel.length > 0 && (
                                  <div className="rounded-lg bg-gray-50 border border-gray-200 overflow-hidden">
                                    <div className="bg-gray-400 text-white px-2 py-1 flex items-center gap-1 text-xs font-medium">
                                      <Users className="w-3 h-3" />
                                      <span>{t('بدون مستوى', 'No Level')}</span>
                                      <span className="ms-auto bg-white/20 px-1.5 py-0.5 rounded text-xs">
                                        {noLevel.length}
                                      </span>
                                    </div>
                                    <div className="p-1.5 space-y-1">
                                      {noLevel.map((member, idx) => {
                                        const attStatus = getMemberAttendanceStatus(member.member_id);
                                        return (
                                        <div 
                                          key={idx}
                                          onClick={() => openAttendanceDialog(member, activity)}
                                          className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-all group ${
                                            attStatus === 'present' ? 'bg-green-50 border border-green-200' :
                                            attStatus === 'absent' ? 'bg-red-50 border border-red-200' :
                                            'bg-white hover:bg-blue-50'
                                          }`}
                                          title={t('انقر لتسجيل الحضور', 'Click to record attendance')}
                                        >
                                          <div className={`w-6 h-6 rounded-full ${
                                            attStatus === 'present' ? 'bg-green-500' :
                                            attStatus === 'absent' ? 'bg-red-500' :
                                            'bg-gray-400'
                                          } text-white flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform`}>
                                            {attStatus === 'present' ? '✓' : attStatus === 'absent' ? '✗' : (member.member_name || '?').charAt(0)}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className={`font-medium text-xs truncate ${
                                              attStatus === 'present' ? 'text-green-700' :
                                              attStatus === 'absent' ? 'text-red-600 line-through' :
                                              'group-hover:text-blue-600'
                                            }`}>
                                              {member.member_name}
                                            </div>
                                          </div>
                                          {attStatus === 'present' && <Badge className="bg-green-500 text-white text-[9px] px-1 h-4">{t('حاضر', 'P')}</Badge>}
                                          {attStatus === 'absent' && <Badge className="bg-red-500 text-white text-[9px] px-1 h-4">{t('غائب', 'A')}</Badge>}
                                          {!attStatus && <UserCheck className="w-3 h-3 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />}
                                        </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : null}
          </div>
        )}
        
        {/* Empty State (by-activity only) */}
        {!loading && viewMode === 'by-activity' && activitiesData.filter(a => getTotalMembers(a) > 0).length === 0 && (
          <div className="text-center py-16 bg-gray-50 rounded-xl border">
            <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">
              {t('لا يوجد مشتركين في هذا اليوم', 'No members scheduled for this day')}
            </h3>
            <p className="text-gray-400 text-sm">
              {t('اختر تاريخاً آخر لعرض الجدول', 'Select another date to view schedule')}
            </p>
          </div>
        )}

        {/* Instructions (by-activity only) */}
        {!loading && viewMode === 'by-activity' && activitiesData.filter(a => getTotalMembers(a) > 0).length > 0 && (
          <div className="mt-4 text-center text-sm text-gray-500 bg-blue-50 p-3 rounded-lg">
            💡 {t('انقر على اسم أي عضو لتسجيل حضوره أو غيابه', 'Click any member to record attendance')}
          </div>
        )}
      </div>

      {/* Attendance Dialog */}
      <Dialog open={attendanceDialog.open} onOpenChange={(open) => !open && setAttendanceDialog({ open: false, member: null, activity: null, saving: false })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">
              {t('تسجيل الحضور', 'Record Attendance')}
            </DialogTitle>
          </DialogHeader>
          
          {attendanceDialog.member && attendanceDialog.activity && (
            <div className="space-y-4">
              {/* Member Info */}
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className={`w-16 h-16 rounded-full ${getActivityStyle(attendanceDialog.activity.activity_name).bg} text-white flex items-center justify-center text-2xl font-bold mx-auto mb-2`}>
                  {(attendanceDialog.member.member_name || '?').charAt(0)}
                </div>
                <h3 className="font-bold text-lg">{attendanceDialog.member.member_name}</h3>
                {attendanceDialog.member.phone && (
                  <p className="text-gray-500 text-sm" dir="ltr">{attendanceDialog.member.phone}</p>
                )}
              </div>

              {/* Activity & Date */}
              <div className="text-center text-sm text-gray-600">
                <p><strong>{t('النشاط', 'Activity')}:</strong> {attendanceDialog.activity.activity_name}</p>
                <p><strong>{t('التاريخ', 'Date')}:</strong> {selectedDate}</p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => recordAttendance('present')}
                  disabled={attendanceDialog.saving}
                  className="bg-green-600 hover:bg-green-700 text-white py-6 text-lg gap-2"
                >
                  <Check className="w-6 h-6" />
                  {t('حاضر', 'Present')}
                </Button>
                <Button
                  onClick={() => recordAttendance('absent')}
                  disabled={attendanceDialog.saving}
                  className="bg-red-600 hover:bg-red-700 text-white py-6 text-lg gap-2"
                >
                  <X className="w-6 h-6" />
                  {t('غائب', 'Absent')}
                </Button>
              </div>

              {/* Cancel */}
              <Button
                variant="outline"
                onClick={() => setAttendanceDialog({ open: false, member: null, activity: null, saving: false })}
                className="w-full"
              >
                {t('إلغاء', 'Cancel')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Notes Dialog */}
      <Dialog open={notesDialog.open} onOpenChange={(open) => !open && setNotesDialog({ open: false, activity: null, notes: [], loading: false })}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="w-5 h-5 text-primary" />
              {t('ملاحظات', 'Notes')} - {notesDialog.activity?.activity_name}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            {/* Add New Note */}
            <div className="space-y-2 bg-gray-50 p-3 rounded-lg">
              <Textarea
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder={t('اكتب ملاحظتك هنا...', 'Write your note here...')}
                className="min-h-[80px] resize-none"
                dir="rtl"
              />
              <Button
                onClick={handleAddNote}
                disabled={!newNoteText.trim() || savingNote}
                className="w-full gap-2"
              >
                <MessageSquarePlus className="w-4 h-4" />
                {savingNote ? t('جاري الحفظ...', 'Saving...') : t('إضافة ملاحظة', 'Add Note')}
              </Button>
            </div>

            {/* Notes List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {notesDialog.loading ? (
                <div className="text-center py-8 text-gray-500">
                  {t('جاري التحميل...', 'Loading...')}
                </div>
              ) : notesDialog.notes.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <StickyNote className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>{t('لا توجد ملاحظات', 'No notes yet')}</p>
                </div>
              ) : (
                notesDialog.notes.map((note) => (
                  <div key={note.id} className="bg-white border rounded-lg p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-gray-800 flex-1 whitespace-pre-wrap">{note.note_text}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 w-7 p-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <Calendar className="w-3 h-3" />
                      <span>{note.date}</span>
                      {note.created_by_name && (
                        <>
                          <span>•</span>
                          <span>{note.created_by_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
