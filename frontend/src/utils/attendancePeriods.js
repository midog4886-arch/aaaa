// Mirrors the read-only history count window, including consumed off-day sessions.
export const attendanceForPeriod = (records, period) => records.filter(record => {
  const ids = period.count_activity_ids || [period.activity_id];
  const date = (record.date || '').slice(0, 10);
  return ids.includes(record.activity_id) && (!record.status || record.status === 'present')
    && date >= period.start_date
    && (date <= period.end_date || (record.off_schedule
      && (!period.attendance_before || date < period.attendance_before)));
});

export const periodIsReadOnly = (period, today) =>
  Boolean(period.read_only || period.expired || period.upcoming || period.start_date > today);