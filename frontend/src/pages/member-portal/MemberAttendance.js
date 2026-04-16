import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CheckCircle, Calendar, Clock, Loader2, 
  CalendarDays, Activity, Award, Flame, TrendingUp, Star,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode, getLanguage } from './MemberLayout';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AR_MONTHS = {
  'January': 'يناير', 'February': 'فبراير', 'March': 'مارس',
  'April': 'أبريل', 'May': 'مايو', 'June': 'يونيو',
  'July': 'يوليو', 'August': 'أغسطس', 'September': 'سبتمبر',
  'October': 'أكتوبر', 'November': 'نوفمبر', 'December': 'ديسمبر'
};
const AR_DAYS_SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
const EN_DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Format ISO week label "2026-W16" → "الأسبوع 16 / Week 16"
const formatWeekLabel = (weekLabel, language) => {
  if (!weekLabel) return '';
  const m = weekLabel.match(/(\d{4})-W(\d+)/);
  if (!m) return weekLabel;
  const weekNum = parseInt(m[2], 10);
  return language === 'ar' ? `الأسبوع ${weekNum}` : `Week ${weekNum}`;
};

const arabicMonth = (str) => {
  if (!str) return '';
  const parts = str.split(' ');
  return parts.length === 2 ? `${AR_MONTHS[parts[0]] || parts[0]} ${parts[1]}` : str;
};

// Build a month grid: returns array of {dateStr, dayOfWeek, isAttended, isPast, isToday}
const buildMonthGrid = (year, month, attendedDates) => {
  const attendedSet = new Set(attendedDates);
  const todayStr = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      dateStr,
      day: d,
      dow: (startDow + d - 1) % 7,
      isAttended: attendedSet.has(dateStr),
      isPast: dateStr < todayStr,
      isToday: dateStr === todayStr,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

// ── Streak Calendar Component ─────────────────────────────────────────────────

const StreakCalendar = ({ dates, year, month, monthName, darkMode, language }) => {
  const cells = buildMonthGrid(year, month, dates || []);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const dayLabels = language === 'ar' ? AR_DAYS_SHORT : EN_DAYS_SHORT;
  const displayName = language === 'ar' ? arabicMonth(monthName) : monthName;

  return (
    <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
      <CardHeader className="pb-3">
        <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
          <Flame className="w-4 h-4 text-orange-500" />
          {language === 'ar' ? `تقويم الحضور — ${displayName}` : `Attendance Calendar — ${displayName}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {dayLabels.map((d, i) => (
            <div key={i} className={`text-center text-[10px] font-bold py-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((cell, di) => {
                if (!cell) return <div key={di} />;
                let bg, textColor;
                if (cell.isAttended) {
                  bg = 'bg-green-500 shadow-sm shadow-green-500/40';
                  textColor = 'text-white font-bold';
                } else if (cell.isToday) {
                  bg = darkMode ? 'bg-amber-500/30 border border-amber-500' : 'bg-amber-100 border border-amber-400';
                  textColor = 'text-amber-600 font-bold';
                } else if (cell.isPast) {
                  bg = darkMode ? 'bg-gray-700' : 'bg-gray-100';
                  textColor = darkMode ? 'text-gray-500' : 'text-gray-400';
                } else {
                  bg = darkMode ? 'bg-gray-700/40' : 'bg-gray-50';
                  textColor = darkMode ? 'text-gray-600' : 'text-gray-300';
                }
                return (
                  <div
                    key={di}
                    className={`aspect-square rounded-lg flex items-center justify-center text-xs transition-all ${bg} ${textColor}`}
                  >
                    {cell.day}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 justify-center">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {language === 'ar' ? 'حضور' : 'Attended'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`} />
            <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {language === 'ar' ? 'غائب' : 'Absent'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded border ${darkMode ? 'border-amber-500 bg-amber-500/30' : 'border-amber-400 bg-amber-100'}`} />
            <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {language === 'ar' ? 'اليوم' : 'Today'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// ── Circular Progress ─────────────────────────────────────────────────────────

const CircularProgress = ({ pct, attended, expected, darkMode, language }) => {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10"
            stroke={darkMode ? '#374151' : '#e5e7eb'} />
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10"
            stroke={pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-black ${darkMode ? 'text-white' : 'text-gray-800'}`}>{pct}%</span>
        </div>
      </div>
      <p className={`text-xs mt-2 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {attended} / {expected} {language === 'ar' ? 'جلسة' : 'sessions'}
      </p>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const MemberAttendance = () => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const darkMode = getDarkMode();
  const language = getLanguage();

  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === (today.getMonth() + 1);

  const fetchStats = useCallback(async (year, month, isInitial = false) => {
    if (isInitial) setLoading(true);
    else setMonthLoading(true);
    try {
      const res = await memberAPI.get(`/api/member-portal/attendance-stats?year=${year}&month=${month}`);
      setStats(res.data);
    } catch (error) {
      console.error('Failed to fetch attendance stats');
    } finally {
      if (isInitial) setLoading(false);
      else setMonthLoading(false);
    }
  }, []);

  const isFirstMount = useRef(true);
  useEffect(() => {
    const initial = isFirstMount.current;
    isFirstMount.current = false;
    fetchStats(viewYear, viewMonth, initial);
  }, [viewYear, viewMonth, fetchStats]);

  const goToPrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear(y => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (isCurrentMonth) return;
    if (viewMonth === 12) {
      setViewYear(y => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const goToCurrentMonth = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth() + 1);
  };

  // Build display month name
  const displayMonthName = `${MONTH_NAMES_EN[viewMonth - 1]} ${viewYear}`;
  const displayMonthNameAr = `${AR_MONTHS[MONTH_NAMES_EN[viewMonth - 1]]} ${viewYear}`;

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
        </div>
      </MemberLayout>
    );
  }

  // Compute expected sessions for the viewed month
  const scheduledPerWeek = stats?.scheduled_per_week || 0;
  let expectedThisMonth = 0;
  if (scheduledPerWeek > 0) {
    if (isCurrentMonth) {
      const dayOfMonth = today.getDate();
      const weeksElapsed = dayOfMonth / 7;
      expectedThisMonth = Math.max(1, Math.round(scheduledPerWeek * weeksElapsed));
    } else {
      const daysInViewedMonth = new Date(viewYear, viewMonth, 0).getDate();
      expectedThisMonth = Math.round(scheduledPerWeek * (daysInViewedMonth / 7));
    }
  }

  const attended = stats?.this_month?.count || 0;
  const attendancePct = expectedThisMonth > 0
    ? Math.min(100, Math.round((attended / expectedThisMonth) * 100))
    : 0;

  const bestWeek = stats?.best_week;

  return (
    <MemberLayout>
      <div className="space-y-5">
        <h1 className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
          {language === 'ar' ? 'سجل الحضور' : 'Attendance Record'}
        </h1>

        {/* ── Month Navigation ── */}
        <div className={`relative flex items-center justify-between p-3 rounded-2xl ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'} shadow-sm`}>
          <button
            onClick={goToPrevMonth}
            disabled={monthLoading}
            className={`p-2 rounded-xl transition-colors ${monthLoading ? 'opacity-40 cursor-not-allowed' : darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
            aria-label={language === 'ar' ? 'الشهر السابق' : 'Previous month'}
          >
            {language === 'ar' ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>

          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <span className={`text-base font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                {language === 'ar' ? displayMonthNameAr : displayMonthName}
              </span>
              {monthLoading && <Loader2 className="w-4 h-4 animate-spin text-green-500" />}
            </div>
            {!isCurrentMonth && (
              <button
                onClick={goToCurrentMonth}
                className="text-[11px] text-green-600 hover:text-green-500 font-medium transition-colors"
              >
                {language === 'ar' ? 'العودة للشهر الحالي' : 'Back to current month'}
              </button>
            )}
          </div>

          <button
            onClick={goToNextMonth}
            disabled={isCurrentMonth || monthLoading}
            className={`p-2 rounded-xl transition-colors ${
              isCurrentMonth || monthLoading
                ? 'opacity-30 cursor-not-allowed'
                : darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'
            }`}
            aria-label={language === 'ar' ? 'الشهر التالي' : 'Next month'}
          >
            {language === 'ar' ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
        </div>

        {/* ── Top Stats Row ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Selected Month */}
          <Card className="bg-gradient-to-br from-green-500 to-emerald-600 text-white border-0">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm">
                    {isCurrentMonth
                      ? (language === 'ar' ? 'هذا الشهر' : 'This Month')
                      : (language === 'ar' ? 'الشهر المختار' : 'Selected Month')}
                  </p>
                  <p className="text-4xl font-black mt-1">{attended}</p>
                  <p className="text-green-100 text-sm mt-1">{language === 'ar' ? 'حصة' : 'sessions'}</p>
                </div>
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                  <CalendarDays className="w-7 h-7" />
                </div>
              </div>
              <p className="text-green-100 text-xs mt-3">
                {language === 'ar' ? displayMonthNameAr : displayMonthName}
              </p>
            </CardContent>
          </Card>

          {/* Previous Month */}
          <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm">{language === 'ar' ? 'الشهر السابق' : 'Previous Month'}</p>
                  <p className="text-4xl font-black mt-1">{stats?.last_month?.count || 0}</p>
                  <p className="text-blue-100 text-sm mt-1">{language === 'ar' ? 'حصة' : 'sessions'}</p>
                </div>
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                  <Calendar className="w-7 h-7" />
                </div>
              </div>
              <p className="text-blue-100 text-xs mt-3">{arabicMonth(stats?.last_month?.month_name)}</p>
            </CardContent>
          </Card>

          {/* Total */}
          <Card className="bg-gradient-to-br from-orange-500 to-amber-600 text-white border-0">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-orange-100 text-sm">{language === 'ar' ? 'إجمالي الحضور' : 'Total Sessions'}</p>
                  <p className="text-4xl font-black mt-1">{stats?.total || 0}</p>
                  <p className="text-orange-100 text-sm mt-1">{language === 'ar' ? 'حصة' : 'sessions'}</p>
                </div>
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                  <Award className="w-7 h-7" />
                </div>
              </div>
              <p className="text-orange-100 text-xs mt-3">{language === 'ar' ? 'منذ الاشتراك' : 'since joining'}</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Attendance Rate + Best Week ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Attendance Rate */}
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <TrendingUp className="w-4 h-4 text-green-600" />
                {language === 'ar' ? 'نسبة الالتزام' : 'Attendance Rate'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-col items-center pb-5">
              {scheduledPerWeek > 0 ? (
                <>
                  <CircularProgress
                    pct={attendancePct}
                    attended={attended}
                    expected={expectedThisMonth}
                    darkMode={darkMode}
                    language={language}
                  />
                  <p className={`text-xs mt-3 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {language === 'ar'
                      ? `${scheduledPerWeek} أيام/أسبوع مجدولة`
                      : `${scheduledPerWeek} days/week scheduled`}
                  </p>
                </>
              ) : (
                <div className="py-6 text-center">
                  <div className={`text-4xl font-black mb-1 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                    {attended}
                  </div>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {language === 'ar'
                      ? `جلسة — ${displayMonthNameAr}`
                      : `sessions — ${displayMonthName}`}
                  </p>
                  <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {language === 'ar' ? 'لا يوجد جدول محدد' : 'No schedule set'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Best Week */}
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Star className="w-4 h-4 text-amber-500" />
                {language === 'ar' ? 'أفضل أسبوع' : 'Best Week'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-col items-center justify-center pb-5 min-h-[140px]">
              {bestWeek ? (
                <>
                  <div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-full flex items-center justify-center shadow-lg shadow-amber-400/30 mb-3">
                    <span className="text-3xl font-black text-gray-900">{bestWeek.count}</span>
                  </div>
                  <p className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                    {language === 'ar' ? `${bestWeek.count} جلسات` : `${bestWeek.count} sessions`}
                  </p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatWeekLabel(bestWeek.week_label, language)}
                  </p>
                  <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {language === 'ar'
                      ? `في أسبوع واحد — ${displayMonthNameAr}`
                      : `in one week — ${displayMonthName}`}
                  </p>
                </>
              ) : (
                <div className="text-center py-4">
                  <Calendar className={`w-10 h-10 mx-auto mb-2 opacity-30 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                  <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {language === 'ar'
                      ? `لا يوجد حضور — ${displayMonthNameAr}`
                      : `No attendance — ${displayMonthName}`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Streak Calendar ── */}
        <StreakCalendar
          dates={stats?.this_month?.dates || []}
          year={viewYear}
          month={viewMonth}
          monthName={stats?.this_month?.month_name || displayMonthName}
          darkMode={darkMode}
          language={language}
        />

        {/* ── Activities Breakdown ── */}
        {stats?.this_month?.activities && Object.keys(stats.this_month.activities).length > 0 && (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardHeader>
              <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
                <Activity className="w-4 h-4 text-green-600" />
                {language === 'ar' ? 'حضور حسب النشاط' : 'Attendance by Activity'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {Object.entries(stats.this_month.activities).map(([activity, count], idx) => {
                  const totalMonth = stats.this_month.count || 1;
                  const pct = Math.round((count / totalMonth) * 100);
                  return (
                    <div key={idx} className={`p-3 rounded-xl ${darkMode ? 'bg-gray-700/60' : 'bg-green-50'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-medium text-sm ${darkMode ? 'text-white' : 'text-gray-800'}`}>{activity}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xl font-black text-green-600">{count}</span>
                          <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {language === 'ar' ? 'حصة' : 'sessions'}
                          </span>
                        </div>
                      </div>
                      <div className={`w-full h-1.5 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-green-100'}`}>
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Recent Attendance ── */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
              <Clock className="w-4 h-4 text-blue-600" />
              {language === 'ar' ? 'آخر الحضور' : 'Recent Attendance'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {stats?.recent && stats.recent.length > 0 ? (
              <div className="space-y-2">
                {stats.recent.map((att, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-xl border ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${darkMode ? 'bg-green-900' : 'bg-green-100'}`}>
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <p className={`font-medium text-sm ${darkMode ? 'text-white' : 'text-gray-800'}`}>{att.activity_name || (language === 'ar' ? 'نشاط' : 'Activity')}</p>
                        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{att.time || ''}</p>
                      </div>
                    </div>
                    <p className={`font-bold text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{att.date}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{language === 'ar' ? 'لا يوجد سجل حضور' : 'No attendance records'}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Motivational Card ── */}
        {attended > 0 && (
          <Card className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
            <CardContent className="p-5 text-center">
              <Award className="w-10 h-10 mx-auto mb-2" />
              <h3 className="text-lg font-bold">
                {attended >= 12 ? '🏆 ممتاز! أداء رائع هذا الشهر!' :
                 attended >= 8  ? '💪 جيد جداً! استمر!'          :
                 attended >= 4  ? '👍 بداية جيدة!'                :
                                  '🎯 حاول زيادة حضورك!'}
              </h3>
              <p className="text-purple-100 mt-1 text-sm">
                {language === 'ar'
                  ? `حضرت ${attended} حصة — ${displayMonthNameAr}`
                  : `You attended ${attended} sessions — ${displayMonthName}`}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberAttendance;
