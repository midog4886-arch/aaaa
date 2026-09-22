import { attendanceForPeriod, periodIsReadOnly } from './attendancePeriods';

const period = {
  activity_id: 'swim', count_activity_ids: ['swim', 'legacy'],
  start_date: '2026-10-01', end_date: '2026-10-24', attendance_before: '2026-11-01',
};
test('chips stay within their purchased period, preserving consumed off-days', () => {
  const records = [
    { id: 'previous', activity_id: 'swim', date: '2026-09-15' },
    { id: 'current', activity_id: 'legacy', date: '2026-10-10' },
    { id: 'off', activity_id: 'swim', date: '2026-10-26', off_schedule: true },
    { id: 'late', activity_id: 'swim', date: '2026-10-27' },
    { id: 'next', activity_id: 'swim', date: '2026-11-02', off_schedule: true },
  ];
  expect(attendanceForPeriod(records, period).map(r => r.id)).toEqual(['current', 'off']);
});
test('future cards are never actionable even with attendance records', () => {
  expect(periodIsReadOnly(period, '2026-09-30')).toBe(true);
  expect(periodIsReadOnly({ ...period, read_only: true }, '2026-10-10')).toBe(true);
  expect(periodIsReadOnly(period, '2026-10-10')).toBe(false);
});