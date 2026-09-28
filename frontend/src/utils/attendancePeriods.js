// Mirrors the read-only history count window, including consumed off-day sessions.
export const attendanceForPeriod = (records, period) => records.filter(record => {
  const ids = period.count_activity_ids || [period.activity_id];
  const date = (record.date || '').slice(0, 10);
  return ids.includes(record.activity_id) && (!record.status || record.status === 'present')
    && date >= period.start_date
    && (!period.attendance_before || date < period.attendance_before)
    && (date <= period.end_date || record.off_schedule);
});

export const periodIsReadOnly = (period, today) =>
  Boolean(period.read_only || period.expired || period.upcoming || period.start_date > today
    || (period.attendance_before && today >= period.attendance_before));

// A current purchased card can request today's attendance without enabling
// historical edits. The attendance endpoint remains the authority on eligibility.
export const canRecordToday = (period, today) => Boolean(period.activity_id
  && period.start_date && period.end_date
  && period.start_date <= today && today <= period.end_date
  && (!period.attendance_before || today < period.attendance_before)
  && !period.expired && !period.upcoming && period.remaining > 0);

export const sortAttendancePeriods = (periods, today) => {
  const group = period => {
    if (period.expired || period.end_date < today
      || (period.attendance_before && period.attendance_before <= today)) return 2;
    if (period.upcoming || period.start_date > today) return 1;
    return 0;
  };
  return [...periods].sort((a, b) => {
    const difference = group(a) - group(b);
    if (difference) return difference;
    const aStart = a.start_date || '';
    const bStart = b.start_date || '';
    return group(a) === 1 ? aStart.localeCompare(bStart) : bStart.localeCompare(aStart);
  });
};
