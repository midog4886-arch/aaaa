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
