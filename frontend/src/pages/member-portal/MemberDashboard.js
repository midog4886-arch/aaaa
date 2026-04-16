import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CreditCard, Calendar, QrCode, Bell, CheckCircle, 
  AlertTriangle, Clock, ChevronLeft, Trophy, Star, Activity
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import MemberLayout, { memberAPI, getMemberData, getDarkMode, getLanguage } from './MemberLayout';
import { HeroBannerAds, InlineAds, PopupAd } from './MemberAds';
import PullToRefresh from '../../components/PullToRefresh';
import TrainingReminder from '../../components/TrainingReminder';
import AttendanceToast from '../../components/AttendanceToast';
import PushNotificationManager from '../../components/PushNotificationManager';

// ── helpers ──────────────────────────────────────────────────────────────────

const getInitials = (name) => {
  if (!name) return '؟';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0][0] + words[1][0];
};

const daysDiff = (dateStr1, dateStr2) => {
  if (!dateStr1 || !dateStr2) return 0;
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / 86400000);
};

const remainingDaysColor = (days) => {
  if (days > 14) return { text: 'text-green-600', bg: 'bg-green-500', badge: 'bg-green-100 text-green-700 border-green-300' };
  if (days > 7)  return { text: 'text-yellow-600', bg: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-700 border-yellow-300' };
  return            { text: 'text-red-600',   bg: 'bg-red-500',   badge: 'bg-red-100 text-red-700 border-red-300' };
};

const loyaltyLevelStyle = (level) => {
  const map = {
    'برونزي': { bg: 'from-amber-700 to-amber-900', icon: '🥉', textColor: 'text-amber-100' },
    'Bronze':  { bg: 'from-amber-700 to-amber-900', icon: '🥉', textColor: 'text-amber-100' },
    'فضي':    { bg: 'from-slate-400 to-slate-600',  icon: '🥈', textColor: 'text-slate-100' },
    'Silver':  { bg: 'from-slate-400 to-slate-600',  icon: '🥈', textColor: 'text-slate-100' },
    'ذهبي':   { bg: 'from-yellow-500 to-yellow-700', icon: '🥇', textColor: 'text-yellow-100' },
    'Gold':    { bg: 'from-yellow-500 to-yellow-700', icon: '🥇', textColor: 'text-yellow-100' },
    'ماسي':   { bg: 'from-blue-400 to-indigo-600',   icon: '💎', textColor: 'text-blue-100' },
    'Diamond': { bg: 'from-blue-400 to-indigo-600',   icon: '💎', textColor: 'text-blue-100' },
  };
  return map[level] || { bg: 'from-amber-700 to-amber-900', icon: '🥉', textColor: 'text-amber-100' };
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
};

// ── Skeleton Components ───────────────────────────────────────────────────────

const Skeleton = ({ className }) => (
  <div className={`animate-pulse rounded bg-gray-300/60 dark:bg-gray-700 ${className}`} />
);

const LoadingSkeleton = ({ darkMode }) => (
  <div className="space-y-6">
    <div className={`rounded-2xl p-6 ${darkMode ? 'bg-gray-800' : 'bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950'}`}>
      <div className="flex items-center gap-4">
        <Skeleton className="w-16 h-16 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      {[1,2,3,4].map(i => (
        <div key={i} className={`rounded-2xl p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm`}>
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
    <div className={`rounded-2xl p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm`}>
      <Skeleton className="h-5 w-36 mb-4" />
      <Skeleton className="h-20 w-full" />
    </div>
    <div className="grid grid-cols-3 gap-3">
      {[1,2,3].map(i => (
        <div key={i} className={`rounded-xl p-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-sm`}>
          <Skeleton className="w-10 h-10 rounded-full mx-auto mb-2" />
          <Skeleton className="h-3 w-16 mx-auto" />
        </div>
      ))}
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

const MemberDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscriptions, setSubscriptions] = useState({ active: [], expired: [], total_active: 0, total_expired: 0 });
  const [notifications, setNotifications] = useState({ notifications: [], unread_count: 0 });
  const [attendanceStats, setAttendanceStats] = useState(null);
  const [loyaltyData, setLoyaltyData] = useState(null);

  const member = getMemberData();
  const darkMode = getDarkMode();
  const language = getLanguage();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { fetchData(); }, []);

  const fetchData = useCallback(async (showToast = false) => {
    try {
      const requests = [
        memberAPI.get('/api/member-portal/subscriptions'),
        memberAPI.get('/api/member-portal/notifications'),
        memberAPI.get('/api/member-portal/attendance-stats'),
      ];
      if (member?.id) {
        requests.push(memberAPI.get(`/api/loyalty/members/${member.id}/points`));
      }

      const [subsRes, notifRes, attRes, loyaltyRes] = await Promise.allSettled(requests);

      if (subsRes.status === 'fulfilled')   setSubscriptions(subsRes.value.data);
      if (notifRes.status === 'fulfilled')  setNotifications(notifRes.value.data);
      if (attRes.status === 'fulfilled')    setAttendanceStats(attRes.value.data);
      if (loyaltyRes?.status === 'fulfilled') setLoyaltyData(loyaltyRes.value.data);

      if (showToast) toast.success('تم تحديث البيانات بنجاح');
    } catch (error) {
      console.error('Failed to fetch data');
      if (showToast) toast.error('فشل في تحديث البيانات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [member?.id]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
  }, [fetchData]);

  const quickLinks = [
    { to: '/subscriptions',   icon: CreditCard, label: language === 'ar' ? 'اشتراكاتي'       : 'My Subs',   color: 'bg-gray-900' },
    { to: '/member-schedule', icon: Calendar,   label: language === 'ar' ? 'جدول التدريبات'  : 'Schedule',  color: 'bg-amber-600' },
    { to: '/card',            icon: QrCode,     label: language === 'ar' ? 'بطاقة العضوية'   : 'My Card',   color: 'bg-yellow-600' },
  ];

  // last attendance from recent list
  const lastAttendance = attendanceStats?.recent?.[0];

  if (loading) {
    return (
      <MemberLayout>
        <LoadingSkeleton darkMode={darkMode} />
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <PullToRefresh onRefresh={handleRefresh} disabled={refreshing} className="min-h-[calc(100vh-200px)]">
        <div className="space-y-5">

          {/* Real-time hooks */}
          <AttendanceToast language={language} />
          <HeroBannerAds branchId={member?.branch_id} />
          <PopupAd branchId={member?.branch_id} />
          <TrainingReminder language={language} />
          <PushNotificationManager memberId={member?.id} />

          {/* ── Welcome Card ── */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white border border-amber-500/10 overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  {/* Initials Avatar */}
                  <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/30">
                    <span className="text-gray-900 font-black text-xl sm:text-2xl leading-none">
                      {getInitials(member?.name_ar || member?.name)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h1 className="text-lg sm:text-xl font-bold truncate">
                      {language === 'ar' ? `مرحباً ${member?.name_ar || member?.name}` : `Hello, ${member?.name || member?.name_ar}`}
                    </h1>
                    <p className="text-gray-400 text-sm">{language === 'ar' ? 'رقم العضوية' : 'Member ID'}: <span className="text-amber-400 font-bold">#{member?.member_code}</span></p>
                  </div>
                </div>

                {/* Terms Notice — compact */}
                <div className="mt-4 p-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg">
                  <p className="text-amber-300 text-xs flex items-start gap-1.5">
                    <span className="shrink-0">⚠️</span>
                    <span>{language === 'ar'
                      ? 'الاعتماد يكون على تاريخ بداية ونهاية الاشتراك الموضّح في الفاتورة، وليس على عدد الحصص.'
                      : 'Subscription validity is based on the start/end dates on the invoice, not session count.'
                    }</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Info Cards Row: Attendance + Loyalty + Active subs count ── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Last Attendance */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <Link to="/member-attendance">
                <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <Activity className="w-4 h-4 text-blue-600" />
                      </div>
                      <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {language === 'ar' ? 'الحضور' : 'Attendance'}
                      </span>
                    </div>
                    <p className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {attendanceStats?.this_month?.count ?? 0}
                    </p>
                    <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {language === 'ar' ? 'جلسة هذا الشهر' : 'sessions this month'}
                    </p>
                    {lastAttendance && (
                      <p className={`text-xs mt-2 truncate ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {language === 'ar' ? 'آخر حضور: ' : 'Last: '}{formatDate(lastAttendance.date)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </motion.div>

            {/* Loyalty Points */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Link to="/loyalty-points">
                {loyaltyData ? (() => {
                  const style = loyaltyLevelStyle(loyaltyData.level);
                  return (
                    <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow overflow-hidden bg-gradient-to-br ${style.bg} border-0`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xl">{style.icon}</span>
                          <span className={`text-xs font-medium ${style.textColor} opacity-80`}>
                            {loyaltyData.level || (language === 'ar' ? 'مستواك' : 'Your Level')}
                          </span>
                        </div>
                        <p className={`text-2xl font-black ${style.textColor}`}>
                          {(loyaltyData.total_points ?? 0).toLocaleString()}
                        </p>
                        <p className={`text-xs mt-0.5 ${style.textColor} opacity-80`}>
                          {language === 'ar' ? 'نقطة ولاء' : 'loyalty points'}
                        </p>
                        {loyaltyData.points_to_next > 0 && (
                          <p className={`text-xs mt-2 ${style.textColor} opacity-60`}>
                            {language === 'ar'
                              ? `${loyaltyData.points_to_next} نقطة للمستوى التالي`
                              : `${loyaltyData.points_to_next} pts to next level`}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })() : (
                  <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-amber-50 border-amber-200'}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                          <Star className="w-4 h-4 text-amber-600" />
                        </div>
                        <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-amber-700'}`}>
                          {language === 'ar' ? 'نقاط الولاء' : 'Loyalty Points'}
                        </span>
                      </div>
                      <p className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-amber-700'}`}>0</p>
                      <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-amber-600'}`}>
                        {language === 'ar' ? 'نقطة ولاء' : 'loyalty points'}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </Link>
            </motion.div>

            {/* Active subs count */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <Link to="/subscriptions">
                <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-green-50 border-green-200'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </div>
                      <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-green-700'}`}>
                        {language === 'ar' ? 'اشتراكات سارية' : 'Active Subs'}
                      </span>
                    </div>
                    <p className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-green-700'}`}>
                      {subscriptions.total_active}
                    </p>
                    <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-green-600'}`}>
                      {language === 'ar' ? 'اشتراك ساري' : 'active subscriptions'}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>

            {/* Notifications */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Link to="/notifications">
                <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : notifications.unread_count > 0 ? 'bg-orange-50 border-orange-200' : 'bg-white'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${notifications.unread_count > 0 ? 'bg-orange-100' : 'bg-gray-100'}`}>
                        <Bell className={`w-4 h-4 ${notifications.unread_count > 0 ? 'text-orange-600' : 'text-gray-500'}`} />
                      </div>
                      <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : notifications.unread_count > 0 ? 'text-orange-700' : 'text-gray-500'}`}>
                        {language === 'ar' ? 'إشعارات' : 'Notifications'}
                      </span>
                    </div>
                    <p className={`text-2xl font-black ${darkMode ? 'text-white' : notifications.unread_count > 0 ? 'text-orange-700' : 'text-gray-700'}`}>
                      {notifications.unread_count}
                    </p>
                    <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : notifications.unread_count > 0 ? 'text-orange-600' : 'text-gray-500'}`}>
                      {language === 'ar' ? 'إشعار غير مقروء' : 'unread notifications'}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          </div>

          {/* ── Active Subscriptions with Progress Bars ── */}
          {subscriptions.active.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    {language === 'ar' ? 'اشتراكاتي السارية' : 'Active Subscriptions'}
                  </CardTitle>
                  <Link to="/subscriptions" className="text-amber-600 text-xs flex items-center gap-1">
                    {language === 'ar' ? 'عرض الكل' : 'View all'} <ChevronLeft className="w-3 h-3" />
                  </Link>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {subscriptions.active.slice(0, 3).map((sub, idx) => {
                    const totalDays = daysDiff(sub.start_date, sub.end_date);
                    const elapsedDays = daysDiff(sub.start_date, today);
                    const remaining = daysDiff(today, sub.end_date);
                    const progressPct = totalDays > 0
                      ? Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)))
                      : 0;
                    const colors = remainingDaysColor(remaining);

                    return (
                      <div key={idx} className={`rounded-xl p-3.5 border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <div className="flex-1 min-w-0">
                            <p className={`font-bold text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {sub.activity_name}
                            </p>
                            {sub.schedule && (
                              <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                                <Clock className="w-3 h-3 inline" /> {sub.schedule}
                              </p>
                            )}
                          </div>
                          {/* Remaining days badge */}
                          <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full border ${colors.badge}`}>
                            {remaining > 0
                              ? (language === 'ar' ? `${remaining} يوم` : `${remaining}d`)
                              : (language === 'ar' ? 'ينتهي اليوم' : 'ends today')
                            }
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="mb-2">
                          <div className={`w-full h-2 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-200'} overflow-hidden`}>
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${colors.bg}`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Date row */}
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {sub.start_date}
                          </span>
                          <span className={`text-[10px] ${colors.text} font-medium`}>
                            {language === 'ar' ? 'ينتهي:' : 'ends:'} {sub.end_date}
                          </span>
                        </div>

                        {sub.coach_name && (
                          <p className={`text-[11px] mt-1.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            🏋️ {sub.coach_name}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Quick Links ── */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <div className="grid grid-cols-3 gap-3">
              {quickLinks.map((link) => (
                <Link key={link.to} to={link.to}>
                  <Card className={`hover:shadow-lg transition-shadow cursor-pointer h-full ${darkMode ? 'bg-gray-800 border-gray-700' : ''}`}>
                    <CardContent className="p-4 text-center">
                      <div className={`w-11 h-11 ${link.color} rounded-full flex items-center justify-center mx-auto mb-2.5 shadow-sm`}>
                        <link.icon className="w-5 h-5 text-white" />
                      </div>
                      <p className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{link.label}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </motion.div>

          {/* ── Inline Ads ── */}
          <InlineAds branchId={member?.branch_id} maxAds={2} />

          {/* ── Recent Notifications ── */}
          {notifications.notifications.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
              <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <Bell className="w-4 h-4 text-orange-600" />
                    {language === 'ar' ? 'آخر الإشعارات' : 'Recent Notifications'}
                  </CardTitle>
                  <Link to="/notifications" className="text-amber-600 text-xs flex items-center gap-1">
                    {language === 'ar' ? 'عرض الكل' : 'View all'} <ChevronLeft className="w-3 h-3" />
                  </Link>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {notifications.notifications.slice(0, 3).map((notif, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.08 }}
                        className={`flex items-start gap-3 p-3 rounded-xl border ${
                          notif.priority === 'danger'  ? (darkMode ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200') :
                          notif.priority === 'warning' ? (darkMode ? 'bg-orange-900/20 border-orange-800' : 'bg-orange-50 border-orange-200') :
                                                         (darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200')
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          notif.priority === 'danger'  ? 'bg-red-500' :
                          notif.priority === 'warning' ? 'bg-orange-500' : 'bg-blue-500'
                        }`}>
                          {notif.priority === 'danger'  ? <AlertTriangle className="w-4 h-4 text-white" /> :
                           notif.priority === 'warning' ? <Clock className="w-4 h-4 text-white" /> :
                                                          <Bell className="w-4 h-4 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>{notif.title}</p>
                          <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'} line-clamp-2`}>{notif.message}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

        </div>
      </PullToRefresh>
    </MemberLayout>
  );
};

export default MemberDashboard;
