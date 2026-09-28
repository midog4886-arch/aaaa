import { attendanceForPeriod, periodIsReadOnly, canRecordToday, sortAttendancePeriods } from './attendancePeriods';

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
    { id: 'overlap', activity_id: 'swim', date: '2026-11-05' },
  ];
  expect(attendanceForPeriod(records, period).map(r => r.id)).toEqual(['current', 'off']);
});
test('future cards are never actionable even with attendance records', () => {
  expect(periodIsReadOnly(period, '2026-09-30')).toBe(true);
  expect(periodIsReadOnly({ ...period, read_only: true }, '2026-10-10')).toBe(true);
  expect(periodIsReadOnly(period, '2026-10-10')).toBe(false);
});

test('a renewed period owns attendance from its start even when the old end overlaps', () => {
  const old = { ...period, start_date: '2026-09-01', end_date: '2026-10-15', attendance_before: '2026-09-28' };
  const records = [{ id: 'old', activity_id: 'swim', date: '2026-09-21' },
    { id: 'renewal', activity_id: 'swim', date: '2026-09-28' }];
  expect(attendanceForPeriod(records, old).map(r => r.id)).toEqual(['old']);
});

test('today action allows a current purchased period while retaining historical read-only rules', () => {
  const purchased = { ...period, read_only: true, remaining: 3 };
  expect(canRecordToday(purchased, '2026-10-10')).toBe(true);
  expect(periodIsReadOnly(purchased, '2026-10-10')).toBe(true);
  expect(canRecordToday(purchased, '2026-09-30')).toBe(false);
  expect(canRecordToday(purchased, '2026-10-25')).toBe(false);
  expect(canRecordToday({ ...purchased, remaining: 0 }, '2026-10-10')).toBe(false);
  expect(canRecordToday({ ...purchased, upcoming: true }, '2026-10-10')).toBe(false);
  expect(canRecordToday({ ...purchased, expired: true }, '2026-10-10')).toBe(false);
  const renewed = { ...purchased, attendance_before: '2026-10-10' };
  expect(periodIsReadOnly(renewed, '2026-10-10')).toBe(true);
  expect(canRecordToday(renewed, '2026-10-10')).toBe(false);
});

test('current and upcoming subscriptions precede expired ones, newest history first', () => {
  const periods = [
    { id: 'july', start_date: '2026-07-13', end_date: '2026-08-08', expired: true },
    { id: 'august', start_date: '2026-08-10', end_date: '2026-09-05', expired: true },
    { id: 'september', start_date: '2026-09-06', end_date: '2026-10-10' },
    { id: 'november', start_date: '2026-11-01', end_date: '2026-11-30', upcoming: true },
  ];
  expect(sortAttendancePeriods(periods, '2026-09-28').map(p => p.id))
    .toEqual(['september', 'november', 'august', 'july']);
  expect(periods[0].id).toBe('july');
});
