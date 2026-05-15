import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { 
  CheckCircle, Calendar, Clock, Loader2, 
  CalendarDays, Activity, Award, Flame, TrendingUp, Star,
  ChevronLeft, ChevronRight, ChevronDown, BarChart2
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import MemberLayout, { memberAPI, getDarkMode, getLanguage } from './MemberLayout';
import { useBrandColor } from '../../services/branding';

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

const StreakCalendar = ({ dates, year, month, monthName, darkMode, language, primary }) => {
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
                let bg, textColor, inlineStyle;
                if (cell.isAttended) {
                  bg = 'bg-green-500 shadow-sm shadow-green-500/40';
                  textColor = 'text-white font-bold';
                } else if (cell.isToday) {
                  if (primary) {
                    bg = 'border';
                    textColor = 'font-bold';
                    inlineStyle = { backgroundColor: `${primary}33`, borderColor: primary, color: primary };
                  } else {
                    bg = darkMode ? 'bg-amber-500/30 border border-amber-500' : 'bg-amber-100 border border-amber-400';
                    textColor = 'text-amber-600 font-bold';
                  }
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
                    style={inlineStyle}
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
            <div
              className={`w-3 h-3 rounded border ${primary ? '' : (darkMode ? 'border-amber-500 bg-amber-500/30' : 'border-amber-400 bg-amber-100')}`}
              style={primary ? { borderColor: primary, backgroundColor: `${primary}33` } : undefined}
            />
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

// Short month labels for chart X-axis
const MONTH_SHORT_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_SHORT_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ── Attendance Trend Chart Component ──────────────────────────────────────────

const AttendanceTrendChart = ({ darkMode, language }) => {
  const [trendData, setTrendData] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);

  useEffect(() => {
    const fetchTrend = async () => {
      setTrendLoading(true);
      try {
        const today = new Date();
        // Build last 6 months (oldest first)
        const months = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
          months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
        }

        const results = await Promise.all(
          months.map(({ year, month }) =>
            memberAPI.get(`/api/member-portal/attendance-stats?year=${year}&month=${month}`)
              .then(r => ({ year, month, count: r.data?.this_month?.count || 0 }))
              .catch(() => ({ year, month, count: 0 }))
          )
        );

        setTrendData(
          results.map(({ year, month, count }) => ({
            label: language === 'ar' ? MONTH_SHORT_AR[month - 1] : MONTH_SHORT_EN[month - 1],
            count,
            key: `${year}-${month}`,
          }))
        );
      } catch {
        setTrendData([]);
      } finally {
        setTrendLoading(false);
      }
    };

    fetchTrend();
  }, [language]);

  const textColor = darkMode ? '#9ca3af' : '#6b7280';
  const gridColor = darkMode ? '#374151' : '#e5e7eb';
  const maxCount = Math.max(...trendData.map(d => d.count), 1);
  const currentMonthKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${t.getMonth() + 1}`;
  })();

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className={`px-3 py-2 rounded-xl shadow-lg text-sm font-semibold border ${darkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-200 text-gray-800'}`}>
        <p>{label}</p>
        <p className="text-green-500">{payload[0].value} {language === 'ar' ? 'حصة' : 'sessions'}</p>
      </div>
    );
  };

  return (
    <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className={`text-base flex items-center gap-2 ${darkMode ? 'text-white' : ''}`}>
          <BarChart2 className="w-4 h-4 text-green-600" />
          {language === 'ar' ? 'اتجاه الحضور — آخر 6 أشهر' : 'Attendance Trend — Last 6 Months'}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {trendLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: textColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: textColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                domain={[0, Math.max(maxCount + 1, 4)]}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={40}>
                {trendData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={entry.key === currentMonthKey ? '#22c55e' : darkMode ? '#4b7a5e' : '#86efac'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {!trendLoading && (
          <div className="flex items-center gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ background: '#22c55e' }} />
              <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {language === 'ar' ? 'الشهر الحالي' : 'Current month'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded" style={{ background: darkMode ? '#4b7a5e' : '#86efac' }} />
              <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {language === 'ar' ? 'الأشهر السابقة' : 'Previous months'}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const pickerRef = useRef(null);
  const darkMode = getDarkMode();
  const language = getLanguage();
  const primary = useBrandColor();

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

  const openPicker = () => {
    setPickerYear(viewYear);
    setPickerOpen(true);
  };

  const selectPickerMonth = (month) => {
    setViewYear(pickerYear);
    setViewMonth(month);
    setPickerOpen(false);
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const handleOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pickerOpen]);

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

          <div ref={pickerRef} className="relative flex flex-col items-center gap-1">
            <button
              onClick={openPicker}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              aria-label={language === 'ar' ? 'اختر الشهر والسنة' : 'Select month and year'}
            >
              <span className={`text-base font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                {language === 'ar' ? displayMonthNameAr : displayMonthName}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${pickerOpen ? 'rotate-180' : ''} ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
              {monthLoading && <Loader2 className="w-4 h-4 animate-spin text-green-500" />}
            </button>

            {!isCurrentMonth && (
              <button
                onClick={goToCurrentMonth}
                className="text-[11px] text-green-600 hover:text-green-500 font-medium transition-colors"
              >
                {language === 'ar' ? 'العودة للشهر الحالي' : 'Back to current month'}
              </button>
            )}

            {/* ── Month/Year Picker Dropdown ── */}
            {pickerOpen && (
              <div
                className={`absolute top-full mt-2 z-50 w-64 rounded-2xl shadow-xl border p-4 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                style={{ left: '50%', transform: 'translateX(-50%)' }}
              >
                {/* Year selector */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setPickerYear(y => y - 1)}
                    className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
                    aria-label={language === 'ar' ? 'السنة السابقة' : 'Previous year'}
                  >
                    {language === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  </button>
                  <span className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-gray-800'}`}>{pickerYear}</span>
                  <button
                    onClick={() => setPickerYear(y => y + 1)}
                    disabled={pickerYear >= today.getFullYear()}
                    className={`p-1.5 rounded-lg transition-colors ${pickerYear >= today.getFullYear() ? 'opacity-30 cursor-not-allowed' : darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
                    aria-label={language === 'ar' ? 'السنة التالية' : 'Next year'}
                  >
                    {language === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>

                {/* Month grid */}
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTH_NAMES_EN.map((name, idx) => {
                    const monthNum = idx + 1;
                    const isFuture = pickerYear > today.getFullYear() ||
                      (pickerYear === today.getFullYear() && monthNum > today.getMonth() + 1);
                    const isSelected = pickerYear === viewYear && monthNum === viewMonth;
                    const label = language === 'ar' ? AR_MONTHS[name] : name.slice(0, 3);
                    return (
                      <button
                        key={name}
                        onClick={() => !isFuture && selectPickerMonth(monthNum)}
                        disabled={isFuture}
                        className={`py-1.5 rounded-xl text-xs font-medium transition-colors ${
                          isFuture
                            ? 'opacity-30 cursor-not-allowed ' + (darkMode ? 'text-gray-500' : 'text-gray-400')
                            : isSelected
                              ? 'bg-green-500 text-white'
                              : darkMode
                                ? 'hover:bg-gray-700 text-gray-300'
                                : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
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
          <Card
            className={`text-white border-0 ${primary ? '' : 'bg-gradient-to-br from-orange-500 to-amber-600'}`}
            style={primary ? { background: primary } : undefined}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm">{language === 'ar' ? 'إجمالي الحضور' : 'Total Sessions'}</p>
                  <p className="text-4xl font-black mt-1">{stats?.total || 0}</p>
                  <p className="text-white/80 text-sm mt-1">{language === 'ar' ? 'حصة' : 'sessions'}</p>
                </div>
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                  <Award className="w-7 h-7" />
                </div>
              </div>
              <p className="text-white/80 text-xs mt-3">{language === 'ar' ? 'منذ الاشتراك' : 'since joining'}</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Attendance Trend Chart ── */}
        <AttendanceTrendChart darkMode={darkMode} language={language} />

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
                  <div
                    className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg mb-3 ${primary ? '' : 'bg-gradient-to-br from-amber-400 to-yellow-600 shadow-amber-400/30'}`}
                    style={primary ? { background: primary } : undefined}
                  >
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
          primary={primary}
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
                        <p className={`font-medium text-sm ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                          {att.activity_name || (language === 'ar' ? 'نشاط' : 'Activity')}
                          {att._owner_name && (
                            <span className={`ms-2 inline-flex items-center gap-1 ps-0.5 pe-1.5 py-0.5 rounded-full text-[10px] font-bold ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                              {att._owner_photo ? (
                                <img
                                  src={att._owner_photo}
                                  alt={att._owner_name}
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'inline';
                                  }}
                                  className="w-4 h-4 rounded-full object-cover"
                                />
                              ) : null}
                              <span aria-hidden style={{ display: att._owner_photo ? 'none' : 'inline' }}>👤</span>
                              {att._owner_name}
                            </span>
                          )}
                        </p>
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
