import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { schedulesAPI, branchesAPI, attendanceAPI } from '../services/api';
import { Calendar, Clock, Users, ChevronDown, ChevronUp, Check, X, UserCheck, UserX } from 'lucide-react';

export default function SchedulePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [activitiesData, setActivitiesData] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedActivities, setExpandedActivities] = useState({});
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
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

  // Fetch activities with members
  const fetchActivities = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedBranchId) params.branch_id = selectedBranchId;
      const res = await schedulesAPI.getActivitiesWithMembers(params);
      setActivitiesData(res.data);
      
      // Auto-expand all activities
      const expanded = {};
      res.data.forEach(a => { expanded[a.activity_id] = true; });
      setExpandedActivities(expanded);
    } catch (error) {
      toast.error(t('خطأ في جلب البيانات', 'Error fetching data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [selectedBranchId]);

  // Toggle activity expansion
  const toggleActivity = (activityId) => {
    setExpandedActivities(prev => ({
      ...prev,
      [activityId]: !prev[activityId]
    }));
  };

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

  // Count members for a time slot for selected day
  const countMembersForTime = (timeData) => {
    return (timeData[selectedDay] || []).length;
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

  // Format date for display
  const formatDateDisplay = (dateString) => {
    const date = new Date(dateString);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', options);
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
        </div>

        {/* Filters Row */}
        <div className="bg-white rounded-lg border p-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            {/* Date Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                📅 {t('التاريخ', 'Date')}
              </label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-44"
                />
                <Button 
                  onClick={fetchActivities}
                  className="bg-primary hover:bg-primary/90"
                >
                  {t('تنفيذ', 'Apply')}
                </Button>
              </div>
            </div>

            {/* Selected Day Display */}
            <div className="bg-primary/10 px-4 py-2 rounded-lg">
              <div className="text-lg font-bold text-primary">
                {language === 'ar' ? dayLabels[selectedDay].ar : dayLabels[selectedDay].en}
              </div>
              <div className="text-xs text-gray-500">{t('اليوم المحدد', 'Selected Day')}</div>
            </div>

            {/* Branch Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                🏢 {t('الفرع', 'Branch')}
              </label>
              <select
                value={selectedBranchId}
                onChange={e => setSelectedBranchId(e.target.value)}
                className="border rounded-lg p-2 text-sm w-44"
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
                const isExpanded = expandedActivities[activity.activity_id];
                const totalMembers = getTotalMembers(activity);
                
                return (
                  <div 
                    key={activity.activity_id}
                    className={`rounded-xl border-2 ${style.border} overflow-hidden shadow-sm`}
                  >
                    {/* Activity Header */}
                    <div 
                      className={`${style.bg} text-white p-4 cursor-pointer flex items-center justify-between`}
                      onClick={() => toggleActivity(activity.activity_id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{style.icon}</span>
                        <div>
                          <h2 className="font-bold text-lg">{activity.activity_name}</h2>
                          <div className="flex items-center gap-2 text-sm opacity-90">
                            <Users className="w-4 h-4" />
                            <span>{totalMembers} {t('مشترك', 'members')}</span>
                            <span className="opacity-60">•</span>
                            <Clock className="w-4 h-4" />
                            <span>{Object.keys(activity.times).length} {t('أوقات', 'times')}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => { e.stopPropagation(); goToAttendance(activity.activity_id); }}
                          className="bg-white/20 hover:bg-white/30 text-white border-0"
                        >
                          {t('صفحة الحضور', 'Attendance')}
                        </Button>
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>

                    {/* Time Slots & Members */}
                    {isExpanded && (
                      <div className={`${style.light} p-4`}>
                        {Object.entries(activity.times).sort().map(([time, timeData]) => {
                          const memberCount = countMembersForTime(timeData);
                          if (memberCount === 0 && selectedDay !== 'all') return null;
                          
                          return (
                            <div key={time} className="mb-4 last:mb-0">
                              {/* Time Header */}
                              <div className={`flex items-center gap-2 ${style.text} font-semibold mb-2 pb-2 border-b ${style.border}`}>
                                <Clock className="w-5 h-5" />
                                <span className="text-lg">{time === 'غير محدد' ? t('بدون وقت محدد', 'No specific time') : time}</span>
                                <span className="text-sm font-normal opacity-70">
                                  ({memberCount} {t('مشترك', 'members')})
                                </span>
                              </div>

                              {/* Days Grid with Members */}
                              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                                {(selectedDay === 'all' ? Object.keys(dayLabels) : [selectedDay]).map(dayKey => {
                                  const members = timeData[dayKey] || [];
                                  if (members.length === 0) return null;
                                  
                                  return (
                                    <div 
                                      key={dayKey}
                                      className="bg-white rounded-lg border p-2 shadow-sm"
                                    >
                                      {/* Day Label */}
                                      <div className={`text-xs font-bold ${style.text} mb-2 pb-1 border-b`}>
                                        {language === 'ar' ? dayLabels[dayKey].ar : dayLabels[dayKey].en}
                                        <span className="float-left text-gray-400">({members.length})</span>
                                      </div>
                                      
                                      {/* Members List */}
                                      <div className="space-y-1">
                                        {members.map((member, idx) => (
                                          <div 
                                            key={idx}
                                            onClick={() => openAttendanceDialog(member, activity)}
                                            className="flex items-center gap-2 text-xs p-1.5 bg-gray-50 rounded hover:bg-blue-50 hover:border-blue-300 border border-transparent cursor-pointer transition-all group"
                                            title={t('انقر لتسجيل الحضور', 'Click to record attendance')}
                                          >
                                            <div className={`w-6 h-6 rounded-full ${style.bg} text-white flex items-center justify-center text-[10px] font-bold group-hover:scale-110 transition-transform`}>
                                              {(member.member_name || '?').charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium truncate group-hover:text-blue-600" title={member.member_name}>
                                                {member.member_name}
                                              </div>
                                              {member.phone && (
                                                <div className="text-gray-400 text-[10px]" dir="ltr">
                                                  {member.phone}
                                                </div>
                                              )}
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                              <UserCheck className="w-4 h-4 text-green-500" />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-16 bg-gray-50 rounded-xl border">
                <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">
                  {t('لا توجد أنشطة', 'No Activities')}
                </h3>
                <p className="text-gray-400 text-sm">
                  {t('سيتم عرض الأنشطة والمواعيد من الفواتير هنا', 'Activities from invoices will appear here')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {!loading && activitiesData.length > 0 && (
          <div className="mt-4 text-center text-sm text-gray-500 bg-blue-50 p-3 rounded-lg">
            💡 {t('انقر على اسم أي عضو لتسجيل حضوره أو غيابه بتاريخ', 'Click any member to record attendance for')} <strong>{selectedDate}</strong>
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
