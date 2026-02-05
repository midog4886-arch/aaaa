import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { schedulesAPI, branchesAPI, attendanceAPI, levelsAPI } from '../services/api';
import { Calendar, Clock, Users, Check, X, UserCheck, ChevronLeft, ChevronRight, Printer, Layers } from 'lucide-react';

export default function SchedulePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [activitiesData, setActivitiesData] = useState([]);
  const [branches, setBranches] = useState([]);
  const [levels, setLevels] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedTime, setSelectedTime] = useState('all'); // فلتر المواعيد
  const [selectedLevelFilter, setSelectedLevelFilter] = useState('all'); // فلتر المستويات
  const [selectedActivityType, setSelectedActivityType] = useState('all'); // فلتر نوع النشاط
  
  // Attendance dialog state
  const [attendanceDialog, setAttendanceDialog] = useState({
    open: false,
    member: null,
    activity: null,
    saving: false
  });

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
  }, [user]);

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
      const [activitiesRes] = await Promise.all([
        schedulesAPI.getActivitiesWithMembers(params),
        fetchLevels()
      ]);
      setActivitiesData(activitiesRes.data);
    } catch (error) {
      toast.error(t('خطأ في جلب البيانات', 'Error fetching data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [selectedBranchId]);

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

      setAttendanceDialog({ open: false, member: null, activity: null, saving: false });
    } catch (error) {
      toast.error(error.response?.data?.detail || t('خطأ في التسجيل', 'Error recording'));
      setAttendanceDialog(prev => ({ ...prev, saving: false }));
    }
  };

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
    let filteredActivities = activitiesData.filter(a => getTotalMembers(a) > 0);
    
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
            margin: 15px 0;
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
          .activity-card {
            border: 2px solid #ddd;
            border-radius: 10px;
            overflow: hidden;
            break-inside: avoid;
            margin-bottom: 20px;
          }
          .activity-header {
            background: #f97316;
            color: white;
            padding: 12px 15px;
            font-weight: bold;
            font-size: 16px;
          }
          .activity-header .count {
            font-size: 12px;
            opacity: 0.9;
            margin-top: 2px;
          }
          .times-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            padding: 15px;
            background: #fff9f5;
          }
          .time-slot {
            background: white;
            border-radius: 8px;
            border: 1px solid #eee;
            overflow: hidden;
          }
          .time-header {
            background: #fef3e8;
            padding: 8px 10px;
            font-weight: bold;
            font-size: 13px;
            color: #f97316;
            border-bottom: 1px solid #eee;
          }
          .time-count {
            color: #888;
            font-weight: normal;
          }
          .level-group {
            margin: 8px;
            border-radius: 6px;
            overflow: hidden;
            border: 1px solid #ddd;
          }
          .level-header {
            color: white;
            padding: 4px 8px;
            font-size: 11px;
            font-weight: bold;
          }
          .level-members {
            padding: 6px;
          }
          .member-item {
            padding: 4px 6px;
            margin: 2px 0;
            background: #f9f9f9;
            border-radius: 4px;
            font-size: 11px;
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
            margin-top: 30px;
            text-align: center;
            font-size: 11px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 10px;
          }
          .empty-message {
            text-align: center;
            padding: 40px;
            color: #666;
          }
          @media print {
            body { padding: 10px; }
            .times-grid { grid-template-columns: repeat(3, 1fr); }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🏆 ${t('شركة اداء الابطال العالمية للرياضة', 'World Champions Performance Academy')}</h1>
          <div class="date">${t('جدول الأنشطة', 'Activity Schedule')} - ${selectedDate}</div>
          <div class="day">${dayName}</div>
        </div>
        
        ${(selectedTime !== 'all' || selectedLevelFilter !== 'all') ? `
          <div class="filters-info">
            ${t('الفلاتر المطبقة', 'Applied Filters')}:
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
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto" data-testid="schedule-page">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-primary" />
              {t('جدول الأنشطة والمواعيد', 'Activity Schedule')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('انقر على اسم العضو لتسجيل الحضور', 'Click member name to record attendance')}
            </p>
          </div>
          <Button
            onClick={handlePrint}
            variant="outline"
            className="gap-2"
          >
            <Printer className="w-4 h-4" />
            {t('طباعة', 'Print')}
          </Button>
        </div>

        {/* Filters Row */}
        <div className="bg-white rounded-lg border p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            {/* Date Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                📅 {t('التاريخ', 'Date')}
              </label>
              <div className="flex gap-1 items-center">
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => changeDate(-1)}
                  className="h-9 w-9"
                  title={t('اليوم السابق', 'Previous Day')}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-40"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => changeDate(1)}
                  className="h-9 w-9"
                  title={t('اليوم التالي', 'Next Day')}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline"
                  onClick={goToToday}
                  className="h-9 px-3 text-sm"
                >
                  {t('اليوم', 'Today')}
                </Button>
              </div>
            </div>

            {/* Time Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                🕐 {t('الموعد', 'Time')}
              </label>
              <select
                value={selectedTime}
                onChange={e => setSelectedTime(e.target.value)}
                className="border rounded-lg p-2 text-sm w-36"
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
                className="border rounded-lg p-2 text-sm w-44"
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
            <div className="flex gap-3 ms-auto">
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

        {/* Activities Cards */}
        {!loading && (
          <div className="space-y-4">
            {activitiesData.length > 0 ? (
              activitiesData.map(activity => {
                const style = getActivityStyle(activity.activity_name);
                const totalMembers = getTotalMembers(activity);
                
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
                    <div className={`${style.bg} text-white p-3 flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{style.icon}</span>
                        <div>
                          <h2 className="font-bold text-lg">{activity.activity_name}</h2>
                          <div className="flex items-center gap-2 text-sm opacity-90">
                            <Users className="w-4 h-4" />
                            <span>{totalMembers} {t('مشترك', 'members')}</span>
                            <span className="opacity-60">•</span>
                            <Clock className="w-4 h-4" />
                            <span>{timesWithMembers.length} {t('أوقات', 'times')}</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => goToAttendance(activity.activity_id)}
                        className="bg-white/20 hover:bg-white/30 text-white border-0"
                      >
                        {t('صفحة الحضور', 'Attendance')}
                      </Button>
                    </div>

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
                              <div className={`${style.bg} bg-opacity-20 px-3 py-2 border-b flex items-center gap-2`}>
                                <Clock className={`w-4 h-4 ${style.text}`} />
                                <span className={`font-bold ${style.text}`}>
                                  {time === 'غير محدد' ? t('بدون وقت محدد', 'No time') : time}
                                </span>
                                <span className="text-gray-500 text-sm">({members.length})</span>
                              </div>
                              
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
                                        {group.members.map((member, idx) => (
                                          <div 
                                            key={idx}
                                            onClick={() => openAttendanceDialog(member, activity)}
                                            className="flex items-center gap-2 p-1.5 rounded bg-white hover:bg-blue-50 cursor-pointer transition-all group"
                                            title={t('انقر لتسجيل الحضور', 'Click to record attendance')}
                                          >
                                            <div className={`w-6 h-6 rounded-full ${levelColor.bg} text-white flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform`}>
                                              {(member.member_name || '?').charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium text-xs truncate group-hover:text-blue-600">
                                                {member.member_name}
                                              </div>
                                            </div>
                                            <UserCheck className="w-3 h-3 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        ))}
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
                                      {noLevel.map((member, idx) => (
                                        <div 
                                          key={idx}
                                          onClick={() => openAttendanceDialog(member, activity)}
                                          className="flex items-center gap-2 p-1.5 rounded bg-white hover:bg-blue-50 cursor-pointer transition-all group"
                                          title={t('انقر لتسجيل الحضور', 'Click to record attendance')}
                                        >
                                          <div className="w-6 h-6 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-bold group-hover:scale-110 transition-transform">
                                            {(member.member_name || '?').charAt(0)}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="font-medium text-xs truncate group-hover:text-blue-600">
                                              {member.member_name}
                                            </div>
                                          </div>
                                          <UserCheck className="w-3 h-3 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                      ))}
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
        
        {/* Empty State */}
        {!loading && activitiesData.filter(a => getTotalMembers(a) > 0).length === 0 && (
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

        {/* Instructions */}
        {!loading && activitiesData.filter(a => getTotalMembers(a) > 0).length > 0 && (
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
    </Layout>
  );
}
