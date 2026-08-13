import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CreditCard, Calendar, QrCode, Bell, CheckCircle, 
  AlertTriangle, Clock, ChevronLeft, ChevronRight, Star, Activity, Trophy
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import MemberLayout, { memberAPI, getMemberData, getDarkMode, getLanguage } from './MemberLayout';
import { useBrandColor } from '../../services/branding';
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

const remainingDaysColor = (days, darkMode = false) => {
  if (days > 14) return {
    text:  darkMode ? 'text-green-400'  : 'text-green-600',
    bg:    'bg-green-500',
    badge: darkMode ? 'bg-green-900/40 text-green-300 border-green-700' : 'bg-green-100 text-green-700 border-green-300',
  };
  if (days > 7) return {
    text:  darkMode ? 'text-yellow-400' : 'text-yellow-600',
    bg:    'bg-yellow-500',
    badge: darkMode ? 'bg-yellow-900/40 text-yellow-200 border-yellow-700' : 'bg-yellow-100 text-yellow-700 border-yellow-300',
  };
  return {
    text:  darkMode ? 'text-red-400'    : 'text-red-600',
    bg:    'bg-red-500',
    badge: darkMode ? 'bg-red-900/40 text-red-300 border-red-700' : 'bg-red-100 text-red-700 border-red-300',
  };
};

const loyaltyLevelStyle = (level, darkMode = false) => {
  const key = (level || '').toLowerCase();
  const map = {
    'bronze':  {
      bg: darkMode ? 'from-amber-800 to-amber-950'  : 'from-amber-700 to-amber-900',
      icon: '🥉',
      textColor: 'text-amber-100',
    },
    'silver':  {
      bg: darkMode ? 'from-slate-600 to-slate-800'   : 'from-slate-400 to-slate-600',
      icon: '🥈',
      textColor: 'text-slate-100',
    },
    'gold':    {
      bg: darkMode ? 'from-yellow-600 to-yellow-800' : 'from-yellow-500 to-yellow-700',
      icon: '🥇',
      textColor: 'text-yellow-100',
    },
    'diamond': {
      bg: darkMode ? 'from-blue-600 to-indigo-800'   : 'from-blue-400 to-indigo-600',
      icon: '💎',
      textColor: 'text-blue-100',
    },
  };
  return map[key] || {
    bg: darkMode ? 'from-amber-800 to-amber-950' : 'from-amber-700 to-amber-900',
    icon: '🥉',
    textColor: 'text-amber-100',
  };
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
};

// ── Attendance Calendar ───────────────────────────────────────────────────────

const AttendanceCalendar = ({ attendanceStats, darkMode, language, refreshToken, primary }) => {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [monthDates, setMonthDates] = useState(null);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const monthCacheRef = useRef({});

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  // Clear entire cache when a pull-to-refresh happens
  useEffect(() => {
    monthCacheRef.current = {};
    setMonthDates(null);
  }, [refreshToken]);

  // Fetch attendance dates when month changes (not the current month)
  useEffect(() => {
    if (isCurrentMonth) {
      setMonthDates(null);
      return;
    }
    const cacheKey = `${viewYear}-${viewMonth + 1}`;
    if (monthCacheRef.current[cacheKey] !== undefined) {
      setMonthDates(monthCacheRef.current[cacheKey]);
      return;
    }
    let cancelled = false;
    setLoadingMonth(true);
    memberAPI.get(`/api/member-portal/attendance-stats?year=${viewYear}&month=${viewMonth + 1}`)
      .then(res => {
        if (!cancelled) {
          const dates = new Set((res.data?.this_month?.dates || []).map(d => d.slice(0, 10)));
          monthCacheRef.current[cacheKey] = dates;
          setMonthDates(dates);
        }
      })
      .catch(() => {
        if (!cancelled) setMonthDates(new Set());
      })
      .finally(() => { if (!cancelled) setLoadingMonth(false); });
    return () => { cancelled = true; };
  }, [viewYear, viewMonth, isCurrentMonth, refreshToken]);

  const attendedDates = isCurrentMonth
    ? new Set([
        ...(attendanceStats?.this_month?.dates || []).map(d => d.slice(0, 10)),
        ...(attendanceStats?.recent || []).map(r => r.date?.slice(0, 10)).filter(Boolean)
      ])
    : (monthDates || new Set());

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const totalDays = lastDay.getDate();
  const startOffset = firstDay.getDay();

  const allCells = [];
  for (let i = 0; i < startOffset; i++) allCells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    allCells.push({ day: d, dateStr });
  }
  const grid = allCells.slice(0, 35);
  while (grid.length < 35) grid.push(null);
  const hiddenDays = Math.max(0, allCells.filter(c => c !== null).length - grid.filter(c => c !== null).length);

  const dayLabels = language === 'ar'
    ? ['أح', 'اث', 'ث', 'أر', 'خ', 'ج', 'س']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    language === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-US',
    { month: 'long', year: 'numeric' }
  );

  const goPrev = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };

  const goNext = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCurrentMonth) return;
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={goPrev}
          className={`p-1 rounded-full transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          aria-label={language === 'ar' ? 'الشهر السابق' : 'Previous month'}
        >
          {language === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        <p className={`text-xs font-semibold text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {loadingMonth ? '...' : monthLabel}
        </p>
        <button
          onClick={goNext}
          disabled={isCurrentMonth}
          className={`p-1 rounded-full transition-colors ${isCurrentMonth ? 'opacity-30 cursor-not-allowed' : darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          aria-label={language === 'ar' ? 'الشهر التالي' : 'Next month'}
        >
          {language === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {dayLabels.map((d, i) => (
          <div key={i} className={`text-center text-[10px] font-medium py-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className={`grid grid-cols-7 gap-0.5 transition-opacity ${loadingMonth ? 'opacity-40' : 'opacity-100'}`} style={{ gridTemplateRows: 'repeat(5, 1fr)' }}>
        {grid.map((cell, idx) => {
          if (!cell) {
            return <div key={idx} className="aspect-square" />;
          }
          const isToday = cell.dateStr === todayStr;
          const isAttended = attendedDates.has(cell.dateStr);
          const isFuture = cell.dateStr > todayStr;

          let dotColor = '';
          let textColor = '';
          let ring = '';

          if (isToday) {
            ring = primary ? 'ring-2' : 'ring-2 ring-amber-400';
            textColor = darkMode ? 'text-white' : 'text-gray-900';
            dotColor = isAttended ? 'bg-green-500' : 'bg-gray-400';
          } else if (isAttended) {
            dotColor = 'bg-green-500';
            textColor = darkMode ? 'text-green-300' : 'text-green-700';
          } else if (isFuture) {
            dotColor = darkMode ? 'bg-gray-700' : 'bg-gray-200';
            textColor = darkMode ? 'text-gray-600' : 'text-gray-300';
          } else {
            dotColor = 'bg-gray-300';
            textColor = darkMode ? 'text-gray-500' : 'text-gray-400';
          }

          const todayBgStyle = isToday && primary && !darkMode ? { backgroundColor: `${primary}1A` } : undefined;
          const todayRingStyle = isToday && primary ? { boxShadow: `0 0 0 2px ${primary}` } : undefined;
          return (
            <div
              key={idx}
              className={`aspect-square flex flex-col items-center justify-center rounded-md ${primary && isToday ? '' : ring} ${
                isAttended && !isToday ? (darkMode ? 'bg-green-900/30' : 'bg-green-50') :
                isToday && !primary ? (darkMode ? 'bg-gray-700' : 'bg-amber-50') :
                isToday && darkMode ? 'bg-gray-700' :
                ''
              }`}
              style={{ ...(todayBgStyle || {}), ...(todayRingStyle || {}) }}
            >
              <span className={`text-[10px] font-medium leading-none ${textColor}`}>{cell.day}</span>
              {dotColor && (
                <span className={`mt-0.5 w-1 h-1 rounded-full ${dotColor}`} />
              )}
            </div>
          );
        })}
      </div>
      {hiddenDays > 0 && (
        <p className={`text-center text-[10px] mt-1.5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
          {language === 'ar'
            ? `+ ${hiddenDays} ${hiddenDays === 1 ? 'يوم' : 'أيام'} من نهاية الشهر`
            : `+ ${hiddenDays} more day${hiddenDays === 1 ? '' : 's'} at month end`}
        </p>
      )}
    </div>
  );
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

const DASH_CACHE_KEY = 'member_dashboard_cache_v1';
const _readDashCache = (memberId) => {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.member_id !== memberId) return null;
    return parsed;
  } catch { return null; }
};
const _writeDashCache = (memberId, payload) => {
  try {
    const existing = _readDashCache(memberId) || { member_id: memberId };
    const next = { ...existing, ...payload, member_id: memberId, ts: Date.now() };
    localStorage.setItem(DASH_CACHE_KEY, JSON.stringify(next));
  } catch {}
};

const MemberDashboard = () => {
  const member = getMemberData();
  const _initialCache = _readDashCache(member?.id);
  const _hasCache = !!_initialCache;

  const [loading, setLoading] = useState(!_hasCache);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [subscriptions, setSubscriptions] = useState(
    _initialCache?.subscriptions || { active: [], expired: [], total_active: 0, total_expired: 0 }
  );
  const [notifications, setNotifications] = useState(
    _initialCache?.notifications || { notifications: [], unread_count: 0 }
  );
  const [attendanceStats, setAttendanceStats] = useState(_initialCache?.attendanceStats || null);
  const [loyaltyData, setLoyaltyData] = useState(_initialCache?.loyaltyData || null);
  const [myTournaments, setMyTournaments] = useState(_initialCache?.myTournaments || null);

  const darkMode = getDarkMode();
  const language = getLanguage();
  const today = new Date().toISOString().slice(0, 10);
  const primary = useBrandColor();

  useEffect(() => { fetchData(); }, []);

  const fetchData = useCallback(async (showToast = false) => {
    const memberId = member?.id;
    const subsP = memberAPI.get('/api/member-portal/subscriptions')
      .then(res => {
        setSubscriptions(res.data);
        _writeDashCache(memberId, { subscriptions: res.data });
        return { ok: true };
      })
      .catch(() => ({ ok: false }));

    const notifP = memberAPI.get('/api/member-portal/notifications')
      .then(res => {
        setNotifications(res.data);
        _writeDashCache(memberId, { notifications: res.data });
        return { ok: true };
      })
      .catch(() => ({ ok: false }));

    const attP = memberAPI.get('/api/member-portal/attendance-stats')
      .then(res => {
        setAttendanceStats(res.data);
        _writeDashCache(memberId, { attendanceStats: res.data });
        return { ok: true };
      })
      .catch(() => ({ ok: false }));

    const loyaltyP = memberId
      ? memberAPI.get(`/api/loyalty/members/${memberId}/points`)
          .then(res => {
            setLoyaltyData(res.data);
            _writeDashCache(memberId, { loyaltyData: res.data });
            return { ok: true };
          })
          .catch(() => ({ ok: false }))
      : Promise.resolve({ ok: true });

    const tournamentsP = memberAPI.get('/api/member-portal/my-tournaments')
      .then(res => {
        setMyTournaments(res.data);
        _writeDashCache(memberId, { myTournaments: res.data });
        return { ok: true };
      })
      .catch(() => ({ ok: false }));

    Promise.race([subsP, notifP, attP]).then(() => setLoading(false));

    const [subsR, notifR] = await Promise.all([subsP, notifP, attP, loyaltyP, tournamentsP]);

    if (showToast) {
      (subsR.ok && notifR.ok)
        ? toast.success('تم تحديث البيانات بنجاح')
        : toast.error('فشل في تحديث بعض البيانات');
    }
    setLoading(false);
    setRefreshing(false);
  }, [member?.id]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshToken(t => t + 1);
  }, [fetchData]);

  const quickLinks = [
    { to: '/subscriptions',   icon: CreditCard, label: language === 'ar' ? 'اشتراكاتي'       : 'My Subs',   color: 'bg-gray-900',  bgStyle: null },
    { to: '/member-schedule', icon: Calendar,   label: language === 'ar' ? 'جدول التدريبات'  : 'Schedule',  color: primary ? '' : 'bg-amber-600',  bgStyle: primary ? { backgroundColor: primary } : null },
    { to: '/card',            icon: QrCode,     label: language === 'ar' ? 'بطاقة العضوية'   : 'My Card',   color: primary ? '' : 'bg-yellow-600', bgStyle: primary ? { backgroundColor: primary } : null },
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
                  {/* Avatar (photo with initials fallback) */}
                  {member?.photo ? (
                    <img
                      src={member.photo}
                      alt={member?.name_ar || member?.name || ''}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'flex';
                      }}
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover flex-shrink-0 shadow-lg border-2 ${primary ? '' : 'shadow-amber-500/30 border-amber-400'}`}
                      style={primary ? { borderColor: primary, boxShadow: `0 10px 15px -3px ${primary}4D` } : undefined}
                    />
                  ) : null}
                  <div
                    className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full items-center justify-center flex-shrink-0 shadow-lg ${primary ? '' : 'bg-gradient-to-br from-amber-400 to-yellow-600 shadow-amber-500/30'}`}
                    style={{
                      display: member?.photo ? 'none' : 'flex',
                      ...(primary ? { background: primary } : {}),
                    }}
                  >
                    <span className="text-gray-900 font-black text-xl sm:text-2xl leading-none">
                      {getInitials(member?.name_ar || member?.name)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h1 className="text-lg sm:text-xl font-bold truncate">
                      {language === 'ar' ? `مرحباً ${member?.name_ar || member?.name}` : `Hello, ${member?.name || member?.name_ar}`}
                    </h1>
                    <p className="text-gray-400 text-sm">{language === 'ar' ? 'رقم العضوية' : 'Member ID'}: <span className={`font-bold ${primary ? '' : 'text-amber-400'}`} style={primary ? { color: primary } : undefined}>#{member?.member_code}</span></p>
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

          {/* ── Remaining sessions + renew (prominent) ── */}
          {(() => {
            const RENEW_WA = `https://wa.me/966566238384?text=${encodeURIComponent(
              `السلام عليكم، أرغب بتجديد الاشتراك.\nالاسم: ${member?.name_ar || member?.name || ''}\nرقم العضوية: #${member?.member_code || ''}`
            )}`;
            const quotaSubs = (subscriptions.active || []).filter(s => s.sessions_total != null);
            const hasExpired = (subscriptions.expired || []).length > 0;
            const noActive = (subscriptions.active || []).length === 0;
            if (!quotaSubs.length && !(hasExpired && noActive)) return null;
            const low = quotaSubs.some(s => (s.sessions_remaining ?? 99) <= 2);
            const urgent = (hasExpired && noActive) || low;
            return (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}>
                <Card data-testid="sessions-remaining-card" className={`${urgent
                  ? (darkMode ? 'bg-red-900/20 border-red-700' : 'bg-red-50 border-red-200')
                  : (darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white')}`}>
                  <CardContent className="p-4">
                    {quotaSubs.length > 0 ? (
                      <div className="space-y-2">
                        {quotaSubs.map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`text-xs truncate ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{s.activity_name}{s._owner_name ? ` — ${s._owner_name}` : ''}</p>
                              <p className={`text-xl font-black ${((s.sessions_remaining ?? 99) <= 2) ? 'text-red-500' : (darkMode ? 'text-white' : 'text-gray-900')}`}>
                                {language === 'ar'
                                  ? `متبقي ${s.sessions_remaining} من ${s.sessions_total} حصة`
                                  : `${s.sessions_remaining} of ${s.sessions_total} sessions left`}
                              </p>
                            </div>
                            <div className={`h-2 flex-1 max-w-[120px] rounded-full overflow-hidden ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                              <div
                                className={`h-full rounded-full ${((s.sessions_remaining ?? 99) <= 2) ? 'bg-red-500' : 'bg-green-500'}`}
                                style={{ width: `${s.sessions_total ? Math.min(100, Math.round(100 * (s.sessions_remaining || 0) / s.sessions_total)) : 0}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={`font-bold ${darkMode ? 'text-red-300' : 'text-red-700'}`}>
                        {language === 'ar' ? '⚠️ اشتراكك منتهي — جدّد الآن لمواصلة التدريب' : '⚠️ Your subscription has expired — renew to keep training'}
                      </p>
                    )}
                    {(urgent || hasExpired) && (
                      <a
                        href={RENEW_WA}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="renew-subscription-btn"
                        className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-white bg-green-600 hover:bg-green-700 transition-colors"
                      >
                        💬 {language === 'ar' ? 'تجديد الاشتراك عبر واتساب' : 'Renew via WhatsApp'}
                      </a>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })()}

          {/* ── Info Cards Row: Attendance + Loyalty + Active subs count ── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Last Attendance */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <Link to="/member-attendance">
                <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'bg-blue-900/40' : 'bg-blue-100'}`}>
                        <Activity className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
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
                  const style = loyaltyLevelStyle(loyaltyData.level, darkMode);
                  const levelLabel = language === 'ar'
                    ? (loyaltyData.level_ar || loyaltyData.level_en || loyaltyData.level || 'برونزي')
                    : (loyaltyData.level_en || loyaltyData.level_ar || loyaltyData.level || 'Bronze');
                  return (
                    <Card className={`h-full cursor-pointer hover:shadow-md transition-shadow overflow-hidden bg-gradient-to-br ${style.bg} border-0`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xl">{style.icon}</span>
                          <span className={`text-xs font-medium ${style.textColor} opacity-80`}>
                            {levelLabel}
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
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'bg-amber-900/40' : 'bg-amber-100'}`}>
                          <Star className={`w-4 h-4 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
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
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'bg-green-900/40' : 'bg-green-100'}`}>
                        <CheckCircle className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
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
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        notifications.unread_count > 0
                          ? (darkMode ? 'bg-orange-900/40' : 'bg-orange-100')
                          : (darkMode ? 'bg-gray-700' : 'bg-gray-100')
                      }`}>
                        <Bell className={`w-4 h-4 ${notifications.unread_count > 0 ? (darkMode ? 'text-orange-400' : 'text-orange-600') : (darkMode ? 'text-gray-400' : 'text-gray-500')}`} />
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

          {/* ── Attendance Calendar ── */}
          {attendanceStats && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
              <Link to="/member-attendance">
                <Card className={`cursor-pointer hover:shadow-md transition-shadow ${darkMode ? 'bg-gray-800 border-gray-700' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                      <Activity className="w-4 h-4 text-green-600" />
                      {language === 'ar' ? 'سجل الحضور الشهري' : 'Monthly Attendance'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-4 px-4">
                    <AttendanceCalendar
                      attendanceStats={attendanceStats}
                      darkMode={darkMode}
                      language={language}
                      refreshToken={refreshToken}
                      primary={primary}
                    />
                    <div className="flex items-center gap-4 mt-3 justify-center">
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {language === 'ar' ? 'حضور' : 'Attended'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                        <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {language === 'ar' ? 'غياب' : 'Absent'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-3 h-3 rounded-md inline-block ${primary ? '' : 'ring-2 ring-amber-400'}`}
                          style={primary ? { boxShadow: `0 0 0 2px ${primary}` } : undefined}
                        />
                        <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {language === 'ar' ? 'اليوم' : 'Today'}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          )}

          {/* ── Active Subscriptions with Progress Bars ── */}
          {subscriptions.active.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    {language === 'ar' ? 'اشتراكاتي السارية' : 'Active Subscriptions'}
                  </CardTitle>
                  <Link
                    to="/subscriptions"
                    className={`text-xs flex items-center gap-1 ${primary ? '' : 'text-amber-600'}`}
                    style={primary ? { color: primary } : undefined}
                  >
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
                    const colors = remainingDaysColor(remaining, darkMode);

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

          {/* ── My Tournaments ── */}
          {myTournaments && myTournaments.tournaments?.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
              <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader className="pb-3">
                  <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    {language === 'ar' ? 'بطولاتي' : 'My Tournaments'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {/* Medal totals row */}
                  <div className="grid grid-cols-4 gap-2 mb-1">
                    {[
                      { emoji: '🥇', count: myTournaments.totals?.gold || 0, label_ar: 'ذهبية', label_en: 'Gold' },
                      { emoji: '🥈', count: myTournaments.totals?.silver || 0, label_ar: 'فضية', label_en: 'Silver' },
                      { emoji: '🥉', count: myTournaments.totals?.bronze || 0, label_ar: 'برونزية', label_en: 'Bronze' },
                      { emoji: '🎯', count: myTournaments.totals?.participations || 0, label_ar: 'مشاركة', label_en: 'Total' },
                    ].map((s, i) => (
                      <div key={i} className={`rounded-xl p-2 text-center border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="text-xl leading-none">{s.emoji}</div>
                        <div className={`text-base font-black mt-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{s.count}</div>
                        <div className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{language === 'ar' ? s.label_ar : s.label_en}</div>
                      </div>
                    ))}
                  </div>

                  {/* Tournament list */}
                  {myTournaments.tournaments.slice(0, 5).map((tr, idx) => {
                    const medal = tr.position === '1' ? '🥇' : tr.position === '2' ? '🥈' : tr.position === '3' ? '🥉' : '🎯';
                    const posLabel = (language === 'ar' ? tr.position_label_ar : tr.position_label_en)
                      || (language === 'ar' ? 'مشاركة' : 'Participation');
                    return (
                      <div key={`${tr.tournament_id}-${idx}`} className={`flex items-center gap-3 p-3 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                        <span className="text-2xl leading-none shrink-0" aria-hidden>{medal}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold text-sm truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {tr.tournament_name}
                          </p>
                          <div className={`text-[11px] mt-0.5 flex items-center gap-2 flex-wrap ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {tr.date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {tr.date}</span>}
                            {tr.place && <span>· {tr.place}</span>}
                            {tr.activity_name && <span>· {tr.activity_name}</span>}
                          </div>
                        </div>
                        <span className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-full border ${
                          tr.position === '1' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                          tr.position === '2' ? 'bg-slate-100 text-slate-700 border-slate-300' :
                          tr.position === '3' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                          (darkMode ? 'bg-gray-600 text-gray-200 border-gray-500' : 'bg-gray-100 text-gray-600 border-gray-300')
                        }`}>
                          {posLabel}
                        </span>
                      </div>
                    );
                  })}
                  {myTournaments.tournaments.length > 5 && (
                    <p className={`text-center text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      {language === 'ar'
                        ? `+ ${myTournaments.tournaments.length - 5} بطولة أخرى`
                        : `+ ${myTournaments.tournaments.length - 5} more tournaments`}
                    </p>
                  )}
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
                      <div
                        className={`w-11 h-11 ${link.color} rounded-full flex items-center justify-center mx-auto mb-2.5 shadow-sm`}
                        style={link.bgStyle || undefined}
                      >
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
                  <Link
                    to="/notifications"
                    className={`text-xs flex items-center gap-1 ${primary ? '' : 'text-amber-600'}`}
                    style={primary ? { color: primary } : undefined}
                  >
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
