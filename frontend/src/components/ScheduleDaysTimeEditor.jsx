import React, { useState } from 'react';
import { Label } from './ui/label';
import { Input } from './ui/input';

const DAY_ORDER = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const hourOf = (timeStr) => {
  const m = (timeStr || '').match(/(\d+)/);
  return m ? m[1] : '';
};

const timeFromHour = (hour) => (hour ? `${hour}:00 م` : '');

// Build the human-readable schedule string from selected days, a common time, and
// an optional per-day time map (Arabic day name -> "5:00 م"). Keeps the legacy
// compact format ("السبت و الجمعة - 4:00 م") when every day shares the same time,
// and switches to a per-day list ("السبت 5:00 م، الجمعة 3:00 م") when they differ.
export const buildMemberSchedule = (days, commonTime, dayTimes) => {
  const list = (days || []).filter(Boolean);
  const common = (commonTime || '').trim();
  if (list.length === 0) return common;
  const sorted = [...list].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  const dt = dayTimes || {};
  const eff = sorted.map((d) => ({ day: d, time: ((dt[d] || common) || '').trim() }));
  const distinct = new Set(eff.map((e) => e.time));
  const hasVariation = distinct.size > 1;

  if (!hasVariation) {
    const time = eff[0].time;
    let daysStr;
    if (sorted.length === 1) {
      daysStr = sorted[0];
    } else {
      const s = [...sorted];
      const last = s.pop();
      daysStr = s.join('، ') + ' و ' + last;
    }
    return time ? `${daysStr} - ${time}` : daysStr;
  }

  return eff.map((e) => (e.time ? `${e.day} ${e.time}` : e.day)).join('، ');
};

/**
 * Reusable editor for a member's training days + time, with optional per-day times.
 *
 * Reads from `value`: { training_days: string[], training_time: string, day_times: {} }
 * Calls `onChange(patch)` with the changed subset of
 * { training_days, training_time, day_times, schedule }.
 */
export default function ScheduleDaysTimeEditor({ value, onChange, language = 'ar' }) {
  const days = value?.training_days || [];
  const commonTime = value?.training_time || '';
  const dayTimes = value?.day_times || {};
  const [perDay, setPerDay] = useState(() => Object.keys(dayTimes).length > 0);

  const emit = (nextDays, nextCommon, nextDayTimes) => {
    onChange({
      training_days: nextDays,
      training_time: nextCommon,
      day_times: nextDayTimes,
      schedule: buildMemberSchedule(nextDays, nextCommon, nextDayTimes),
    });
  };

  const toggleDay = (day) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    const prunedDayTimes = {};
    next.forEach((d) => {
      if (dayTimes[d]) prunedDayTimes[d] = dayTimes[d];
    });
    emit(next, commonTime, prunedDayTimes);
  };

  const changeCommon = (hour) => {
    emit(days, timeFromHour(hour), dayTimes);
  };

  const changePerDay = (day, hour) => {
    const next = { ...dayTimes };
    if (hour) next[day] = timeFromHour(hour);
    else delete next[day];
    emit(days, commonTime, next);
  };

  const togglePerDay = (checked) => {
    setPerDay(checked);
    if (!checked) {
      // Collapsing per-day mode clears overrides so every day falls back to the common time.
      emit(days, commonTime, {});
    } else {
      emit(days, commonTime, dayTimes);
    }
  };

  const sortedSelected = [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  const preview = buildMemberSchedule(days, commonTime, perDay ? dayTimes : {});

  return (
    <div className="space-y-3">
      {/* Training days */}
      <div className="space-y-2">
        <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
        <div className="flex flex-wrap gap-1">
          {DAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                days.includes(day)
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {/* Common time */}
      <div className="space-y-2">
        <Label className="text-xs">
          {language === 'ar' ? 'الساعة (لكل الأيام)' : 'Time (all days)'}
        </Label>
        <Input
          type="number"
                onWheel={(e) => e.currentTarget.blur()}
          min="1"
          max="12"
          value={hourOf(commonTime)}
          onChange={(e) => changeCommon(e.target.value)}
          className="h-8 text-sm"
          placeholder={language === 'ar' ? 'مثال: 4' : 'e.g. 4'}
        />
      </div>

      {/* Per-day override toggle */}
      {days.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={perDay}
            onChange={(e) => togglePerDay(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          {language === 'ar' ? 'تحديد وقت مختلف لكل يوم' : 'Set a different time per day'}
        </label>
      )}

      {/* Per-day inputs */}
      {perDay && days.length > 0 && (
        <div className="space-y-2 rounded-md border border-dashed border-blue-200 p-2">
          {sortedSelected.map((day) => (
            <div key={day} className="flex items-center gap-2">
              <span className="text-xs w-14 shrink-0 text-gray-700">{day}</span>
              <Input
                type="number"
                onWheel={(e) => e.currentTarget.blur()}
                min="1"
                max="12"
                value={hourOf(dayTimes[day])}
                onChange={(e) => changePerDay(day, e.target.value)}
                className="h-8 text-sm flex-1"
                placeholder={hourOf(commonTime) || (language === 'ar' ? 'الساعة' : 'Hour')}
              />
            </div>
          ))}
          <p className="text-[11px] text-gray-400">
            {language === 'ar'
              ? 'اترك اليوم فارغاً ليأخذ الساعة الموحّدة بالأعلى'
              : 'Leave a day empty to use the common time above'}
          </p>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <p className="text-xs text-muted-foreground" dir="rtl">
          {language === 'ar' ? 'الموعد: ' : 'Schedule: '}
          {preview}
        </p>
      )}
    </div>
  );
}
