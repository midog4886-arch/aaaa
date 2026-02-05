import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { schedulesAPI, branchesAPI } from '../services/api';
import { Calendar, Clock, Users, ChevronDown, ChevronUp, User } from 'lucide-react';

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
  const [selectedDay, setSelectedDay] = useState('all');

  // Day names
  const days = [
    { key: 'all', ar: 'الكل', en: 'All' },
    { key: 'sunday', ar: 'الأحد', en: 'Sun' },
    { key: 'monday', ar: 'الإثنين', en: 'Mon' },
    { key: 'tuesday', ar: 'الثلاثاء', en: 'Tue' },
    { key: 'wednesday', ar: 'الأربعاء', en: 'Wed' },
    { key: 'thursday', ar: 'الخميس', en: 'Thu' },
    { key: 'friday', ar: 'الجمعة', en: 'Fri' },
    { key: 'saturday', ar: 'السبت', en: 'Sat' }
  ];

  const dayLabels = {
    sunday: { ar: 'الأحد', en: 'Sun' },
    monday: { ar: 'الإثنين', en: 'Mon' },
    tuesday: { ar: 'الثلاثاء', en: 'Tue' },
    wednesday: { ar: 'الأربعاء', en: 'Wed' },
    thursday: { ar: 'الخميس', en: 'Thu' },
    friday: { ar: 'الجمعة', en: 'Fri' },
    saturday: { ar: 'السبت', en: 'Sat' }
  };

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

  // Count members for a time slot across selected days
  const countMembersForTime = (timeData) => {
    let count = 0;
    const daysToCheck = selectedDay === 'all' 
      ? Object.keys(dayLabels) 
      : [selectedDay];
    
    daysToCheck.forEach(day => {
      count += (timeData[day] || []).length;
    });
    return count;
  };

  // Get total members for an activity
  const getTotalMembers = (activity) => {
    const uniqueMembers = new Set();
    Object.values(activity.times).forEach(timeData => {
      Object.values(timeData).forEach(dayMembers => {
        dayMembers.forEach(m => uniqueMembers.add(m.member_id));
      });
    });
    return uniqueMembers.size;
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto" data-testid="schedule-page">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-primary" />
              {t('جدول الأنشطة والمواعيد', 'Activity Schedule')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('الأنشطة والأعضاء حسب المواعيد', 'Activities and members by schedule')}
            </p>
          </div>
          
          {/* Branch Filter */}
          <select
            value={selectedBranchId}
            onChange={e => setSelectedBranchId(e.target.value)}
            className="border rounded-lg p-2 text-sm"
          >
            <option value="">{t('كل الفروع', 'All Branches')}</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Day Filter Tabs */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-2 bg-gray-100 p-1 rounded-lg">
          {days.map(day => (
            <button
              key={day.key}
              onClick={() => setSelectedDay(day.key)}
              className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                selectedDay === day.key
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              {language === 'ar' ? day.ar : day.en}
            </button>
          ))}
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
                          {t('تسجيل الحضور', 'Attendance')}
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
                                            className="flex items-center gap-2 text-xs p-1.5 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                                          >
                                            <div className={`w-6 h-6 rounded-full ${style.bg} text-white flex items-center justify-center text-[10px] font-bold`}>
                                              {(member.member_name || '?').charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium truncate" title={member.member_name}>
                                                {member.member_name}
                                              </div>
                                              {member.phone && (
                                                <div className="text-gray-400 text-[10px]" dir="ltr">
                                                  {member.phone}
                                                </div>
                                              )}
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

        {/* Summary */}
        {!loading && activitiesData.length > 0 && (
          <div className="mt-6 bg-white rounded-lg border p-4 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{activitiesData.length}</div>
                <div className="text-xs text-gray-500">{t('نشاط', 'Activities')}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {activitiesData.reduce((sum, a) => sum + getTotalMembers(a), 0)}
                </div>
                <div className="text-xs text-gray-500">{t('مشترك', 'Members')}</div>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              💡 {t('انقر على "تسجيل الحضور" للانتقال لصفحة الحضور', 'Click "Attendance" to record attendance')}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
