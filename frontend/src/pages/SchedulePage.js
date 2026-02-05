import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { schedulesAPI, branchesAPI, activitiesAPI } from '../services/api';
import { Calendar, Clock, Users, List, Grid3X3, ClipboardList } from 'lucide-react';

export default function SchedulePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = (ar, en) => language === 'ar' ? ar : en;

  // State
  const [weeklySchedule, setWeeklySchedule] = useState(null);
  const [schedulesList, setSchedulesList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('weekly'); // weekly, list

  // Day names in Arabic
  const days = [
    { key: 'sunday', ar: 'الأحد', en: 'Sunday' },
    { key: 'monday', ar: 'الإثنين', en: 'Monday' },
    { key: 'tuesday', ar: 'الثلاثاء', en: 'Tuesday' },
    { key: 'wednesday', ar: 'الأربعاء', en: 'Wednesday' },
    { key: 'thursday', ar: 'الخميس', en: 'Thursday' },
    { key: 'friday', ar: 'الجمعة', en: 'Friday' },
    { key: 'saturday', ar: 'السبت', en: 'Saturday' }
  ];

  // Activity colors
  const activityColors = [
    'bg-blue-100 border-blue-300 text-blue-800',
    'bg-green-100 border-green-300 text-green-800',
    'bg-purple-100 border-purple-300 text-purple-800',
    'bg-orange-100 border-orange-300 text-orange-800',
    'bg-pink-100 border-pink-300 text-pink-800',
    'bg-cyan-100 border-cyan-300 text-cyan-800',
    'bg-yellow-100 border-yellow-300 text-yellow-800',
    'bg-red-100 border-red-300 text-red-800',
  ];

  // Get color for activity
  const getActivityColor = (activityId) => {
    const index = activities.findIndex(a => a.id === activityId);
    return activityColors[index % activityColors.length];
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
      if (selectedActivityId) params.activity_id = selectedActivityId;

      const [weeklyRes, listRes] = await Promise.all([
        schedulesAPI.getWeekly(params),
        schedulesAPI.getAll(params)
      ]);
      
      setWeeklySchedule(weeklyRes.data);
      setSchedulesList(listRes.data);
    } catch (error) {
      toast.error(t('خطأ في جلب الجدول', 'Error fetching schedule'));
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchSchedules();
  }, [selectedBranchId, selectedActivityId]);

  // Count total sessions
  const getTotalSessions = () => {
    if (!weeklySchedule) return 0;
    return Object.values(weeklySchedule).reduce((sum, day) => sum + day.length, 0);
  };

  // Get unique activities count
  const getUniqueActivitiesCount = () => {
    if (!weeklySchedule) return 0;
    const activityIds = new Set();
    Object.values(weeklySchedule).forEach(day => {
      day.forEach(session => activityIds.add(session.activity_id));
    });
    return activityIds.size;
  };

  // Navigate to attendance page with activity
  const goToAttendance = (activityId) => {
    navigate(`/attendance?activity_id=${activityId}`);
  };

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto" data-testid="schedule-page">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              📅 {t('جدول الأنشطة والمواعيد', 'Activity Schedule')}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {t('عرض مواعيد الأنشطة الأسبوعية', 'View weekly activity timetable')}
            </p>
          </div>
          
          {/* View Toggle */}
          <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
            <Button
              variant={viewMode === 'weekly' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('weekly')}
              className="gap-1"
            >
              <Grid3X3 className="w-4 h-4" />
              {t('أسبوعي', 'Weekly')}
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="gap-1"
            >
              <List className="w-4 h-4" />
              {t('قائمة', 'List')}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg border shadow-sm mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Branch Filter */}
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

            {/* Activity Filter */}
            <div>
              <label className="text-sm font-medium text-gray-600 block mb-1">
                {t('النشاط', 'Activity')}
              </label>
              <select
                value={selectedActivityId}
                onChange={e => setSelectedActivityId(e.target.value)}
                className="w-full border rounded-lg p-2"
              >
                <option value="">{t('كل الأنشطة', 'All Activities')}</option>
                {activities.map(a => (
                  <option key={a.id} value={a.id}>{a.name_ar || a.name}</option>
                ))}
              </select>
            </div>

            {/* Stats */}
            <div className="flex items-end gap-4">
              <div className="bg-blue-50 px-4 py-2 rounded-lg text-center flex-1">
                <div className="text-xl font-bold text-blue-600">{getTotalSessions()}</div>
                <div className="text-xs text-gray-600">{t('حصة', 'Sessions')}</div>
              </div>
              <div className="bg-green-50 px-4 py-2 rounded-lg text-center flex-1">
                <div className="text-xl font-bold text-green-600">{getUniqueActivitiesCount()}</div>
                <div className="text-xs text-gray-600">{t('نشاط', 'Activities')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-10">
            <div className="spinner mx-auto"></div>
            <p className="mt-2 text-gray-500">{t('جاري التحميل...', 'Loading...')}</p>
          </div>
        )}

        {/* Weekly View */}
        {!loading && viewMode === 'weekly' && weeklySchedule && (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 divide-x divide-gray-200">
              {days.map(day => (
                <div key={day.key} className="min-h-[400px]">
                  {/* Day Header */}
                  <div className="bg-gray-100 p-3 text-center border-b font-bold">
                    {language === 'ar' ? day.ar : day.en}
                    {weeklySchedule[day.key]?.length > 0 && (
                      <span className="text-xs font-normal text-gray-500 block">
                        ({weeklySchedule[day.key].length} {t('حصص', 'sessions')})
                      </span>
                    )}
                  </div>
                  
                  {/* Day Sessions */}
                  <div className="p-2 space-y-2">
                    {weeklySchedule[day.key]?.map((session, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg border ${getActivityColor(session.activity_id)} text-sm group cursor-pointer hover:shadow-md transition-shadow`}
                        onClick={() => goToAttendance(session.activity_id)}
                        title={t('انقر لتسجيل الحضور', 'Click to record attendance')}
                      >
                        <div className="font-semibold truncate" title={session.activity_name}>
                          {session.activity_name}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          {session.time && (
                            <div className="flex items-center gap-1 text-xs opacity-80">
                              <Clock className="w-3 h-3" />
                              {session.time}
                            </div>
                          )}
                          <ClipboardList className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    ))}
                    {(!weeklySchedule[day.key] || weeklySchedule[day.key].length === 0) && (
                      <div className="text-center text-gray-400 text-sm py-8">
                        {t('لا توجد حصص', 'No sessions')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* List View */}
        {!loading && viewMode === 'list' && (
          <div className="bg-white rounded-lg border shadow-sm">
            <div className="p-4 border-b bg-gray-50">
              <h2 className="font-bold">{t('قائمة المواعيد حسب النشاط', 'Schedules by Activity')}</h2>
            </div>
            
            {schedulesList.length > 0 ? (
              <div className="divide-y">
                {schedulesList.map((item, idx) => (
                  <div key={idx} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-3 h-3 rounded-full ${activityColors[idx % activityColors.length].split(' ')[0]}`}></span>
                          <h3 className="font-semibold text-lg">{item.activity_name}</h3>
                        </div>
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 text-gray-700">
                            <Calendar className="w-4 h-4 text-gray-500" />
                            <span>{item.schedule}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        <div className="text-center bg-blue-50 px-4 py-2 rounded-lg">
                          <div className="flex items-center gap-1 text-blue-600">
                            <Users className="w-4 h-4" />
                            <span className="font-bold">{item.member_count}</span>
                          </div>
                          <div className="text-xs text-gray-500">{t('مشترك', 'members')}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => goToAttendance(item.activity_id)}
                          className="gap-1 text-green-600 border-green-300 hover:bg-green-50"
                        >
                          <ClipboardList className="w-4 h-4" />
                          {t('تسجيل الحضور', 'Record Attendance')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-gray-500">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{t('لا توجد مواعيد محددة', 'No schedules defined')}</p>
                <p className="text-sm mt-2">{t('يتم استخراج المواعيد من الفواتير', 'Schedules are extracted from invoices')}</p>
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        {!loading && activities.length > 0 && (
          <div className="mt-6 bg-white rounded-lg border shadow-sm p-4">
            <h3 className="font-semibold mb-3">{t('دليل الألوان', 'Color Legend')}</h3>
            <div className="flex flex-wrap gap-2">
              {activities.slice(0, 8).map((activity, idx) => (
                <div
                  key={activity.id}
                  className={`px-3 py-1 rounded-full text-sm ${activityColors[idx % activityColors.length]}`}
                >
                  {activity.name_ar || activity.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
