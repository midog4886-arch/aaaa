import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { schedulesAPI, branchesAPI, activitiesAPI } from '../services/api';
import { Calendar, Clock, Users, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';

export default function SchedulePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [weeklySchedule, setWeeklySchedule] = useState(null);
  const [branches, setBranches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(false);

  // Day names in Arabic
  const days = [
    { key: 'sunday', ar: 'الأحد', en: 'Sun' },
    { key: 'monday', ar: 'الإثنين', en: 'Mon' },
    { key: 'tuesday', ar: 'الثلاثاء', en: 'Tue' },
    { key: 'wednesday', ar: 'الأربعاء', en: 'Wed' },
    { key: 'thursday', ar: 'الخميس', en: 'Thu' },
    { key: 'friday', ar: 'الجمعة', en: 'Fri' },
    { key: 'saturday', ar: 'السبت', en: 'Sat' }
  ];

  // Activity type colors and icons
  const activityStyles = {
    'سباحة': { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-400', text: 'text-blue-700', icon: '🏊' },
    'swimming': { bg: 'bg-blue-500', light: 'bg-blue-50', border: 'border-blue-400', text: 'text-blue-700', icon: '🏊' },
    'كرة قدم': { bg: 'bg-green-500', light: 'bg-green-50', border: 'border-green-400', text: 'text-green-700', icon: '⚽' },
    'football': { bg: 'bg-green-500', light: 'bg-green-50', border: 'border-green-400', text: 'text-green-700', icon: '⚽' },
    'كاراتيه': { bg: 'bg-red-500', light: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', icon: '🥋' },
    'karate': { bg: 'bg-red-500', light: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', icon: '🥋' },
    'جمباز': { bg: 'bg-purple-500', light: 'bg-purple-50', border: 'border-purple-400', text: 'text-purple-700', icon: '🤸' },
    'تنس': { bg: 'bg-yellow-500', light: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', icon: '🎾' },
    'default': { bg: 'bg-gray-500', light: 'bg-gray-50', border: 'border-gray-400', text: 'text-gray-700', icon: '🏃' }
  };

  // Get style for activity based on name
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
    const fetchData = async () => {
      try {
        const [branchesRes, activitiesRes] = await Promise.all([
          branchesAPI.getAll(),
          activitiesAPI.getAll()
        ]);
        setBranches(branchesRes.data);
        setActivities(activitiesRes.data);
        
        if (user?.branch_id) {
          setSelectedBranchId(user.branch_id);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [user]);

  // Fetch schedules
  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedBranchId) params.branch_id = selectedBranchId;

      const weeklyRes = await schedulesAPI.getWeekly(params);
      setWeeklySchedule(weeklyRes.data);
    } catch (error) {
      toast.error(t('خطأ في جلب الجدول', 'Error fetching schedule'));
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchSchedules();
  }, [selectedBranchId]);

  // Navigate to attendance page with activity
  const goToAttendance = (activityId) => {
    navigate(`/attendance?activity_id=${activityId}`);
  };

  // Group sessions by activity for each day
  const groupByActivity = (sessions) => {
    const grouped = {};
    sessions.forEach(session => {
      const actName = session.activity_name;
      if (!grouped[actName]) {
        grouped[actName] = {
          activity_id: session.activity_id,
          activity_name: actName,
          times: []
        };
      }
      if (session.time && !grouped[actName].times.includes(session.time)) {
        grouped[actName].times.push(session.time);
      }
    });
    // Sort times
    Object.values(grouped).forEach(g => {
      g.times.sort();
    });
    return Object.values(grouped);
  };

  // Count total sessions
  const getTotalSessions = () => {
    if (!weeklySchedule) return 0;
    return Object.values(weeklySchedule).reduce((sum, day) => sum + day.length, 0);
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-full mx-auto" data-testid="schedule-page">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 flex-wrap gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-primary" />
              {t('جدول الأنشطة والمواعيد', 'Activity Schedule')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('مواعيد الأنشطة الأسبوعية من الفواتير', 'Weekly activity timetable from invoices')}
            </p>
          </div>
          
          {/* Branch Filter */}
          <div className="flex items-center gap-3">
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
            <div className="bg-primary/10 px-3 py-1 rounded-full text-sm font-medium text-primary">
              {getTotalSessions()} {t('حصة', 'sessions')}
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

        {/* Weekly Schedule Grid */}
        {!loading && weeklySchedule && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {/* Days Header */}
            <div className="grid grid-cols-7 bg-gray-800 text-white">
              {days.map(day => {
                const dayCount = weeklySchedule[day.key]?.length || 0;
                return (
                  <div key={day.key} className="p-3 text-center border-l border-gray-700 first:border-l-0">
                    <div className="font-bold text-sm md:text-base">
                      {language === 'ar' ? day.ar : day.en}
                    </div>
                    {dayCount > 0 && (
                      <div className="text-xs opacity-75 mt-1">
                        {dayCount} {t('حصة', '')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Activity Cards Grid */}
            <div className="grid grid-cols-7 min-h-[500px]">
              {days.map(day => {
                const sessions = weeklySchedule[day.key] || [];
                const groupedActivities = groupByActivity(sessions);
                
                return (
                  <div 
                    key={day.key} 
                    className="border-l border-gray-200 first:border-l-0 p-2 bg-gray-50"
                  >
                    {groupedActivities.length > 0 ? (
                      <div className="space-y-2">
                        {groupedActivities.map((activity, idx) => {
                          const style = getActivityStyle(activity.activity_name);
                          return (
                            <div
                              key={idx}
                              className={`rounded-lg border-2 ${style.border} ${style.light} overflow-hidden cursor-pointer hover:shadow-md transition-all group`}
                              onClick={() => goToAttendance(activity.activity_id)}
                            >
                              {/* Activity Header */}
                              <div className={`${style.bg} text-white px-2 py-1.5 flex items-center justify-between`}>
                                <div className="flex items-center gap-1">
                                  <span className="text-sm">{style.icon}</span>
                                  <span className="font-medium text-xs truncate max-w-[80px]" title={activity.activity_name}>
                                    {activity.activity_name.split(' ')[0]}
                                  </span>
                                </div>
                                <ClipboardList className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              
                              {/* Time Slots */}
                              <div className="p-1.5 space-y-1">
                                {activity.times.length > 0 ? (
                                  activity.times.map((time, tIdx) => (
                                    <div 
                                      key={tIdx}
                                      className={`flex items-center gap-1 ${style.text} text-xs bg-white rounded px-1.5 py-1 border ${style.border}`}
                                    >
                                      <Clock className="w-3 h-3" />
                                      <span className="font-medium">{time}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className={`text-xs ${style.text} opacity-60 text-center py-1`}>
                                    {t('بدون وقت محدد', 'No time')}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-300 text-xs">
                        {t('لا توجد حصص', 'No sessions')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-6 bg-white rounded-lg border shadow-sm p-4">
          <h3 className="font-semibold mb-3 text-sm">{t('دليل الأنشطة', 'Activity Legend')}</h3>
          <div className="flex flex-wrap gap-3">
            {[
              { name: t('سباحة', 'Swimming'), style: activityStyles['سباحة'] },
              { name: t('كرة قدم', 'Football'), style: activityStyles['كرة قدم'] },
              { name: t('كاراتيه', 'Karate'), style: activityStyles['كاراتيه'] },
              { name: t('جمباز', 'Gymnastics'), style: activityStyles['جمباز'] },
              { name: t('أخرى', 'Other'), style: activityStyles['default'] },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded ${item.style.bg}`}></div>
                <span className="text-sm text-gray-600">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-4 text-center text-sm text-gray-500">
          <p>{t('💡 انقر على أي نشاط للانتقال لصفحة تسجيل الحضور', '💡 Click any activity to go to attendance page')}</p>
        </div>
      </div>
    </Layout>
  );
}
