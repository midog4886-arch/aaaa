import { forecastLevelForDate, weekdayForISODate } from './levelsDateForecast';

test('maps 10 November 2026 to Tuesday without local timezone drift', () => {
  expect(weekdayForISODate('2026-11-10')).toBe('tuesday');
  expect(weekdayForISODate('2026-11-31')).toBeNull();
});

test('counts only subscriptions covering the selected training date', () => {
  const level = {
    id: 'level-1', days: ['tuesday'], members_details: [
      { member_id: 'current', schedule: 'الثلاثاء' },
      { member_id: 'expired', schedule: 'الثلاثاء' },
      { member_id: 'other-day', schedule: 'الخميس' },
    ]
  };
  const members = new Map([
    ['current', { activities: [{ level_id: 'level-1', status: 'active', start_date: '2026-10-01', end_date: '2026-11-30' }] }],
    ['expired', { activities: [{ level_id: 'level-1', status: 'active', start_date: '2026-10-01', end_date: '2026-11-09' }] }],
    ['other-day', { activities: [{ level_id: 'level-1', status: 'active', start_date: '2026-10-01', end_date: '2026-11-30' }] }],
  ]);
  const matchesDay = detail => detail.schedule.includes('الثلاثاء');
  expect(forecastLevelForDate(level, members, '2026-11-10', 'tuesday', matchesDay).members).toEqual(['current']);
  expect(forecastLevelForDate(level, members, '2026-11-10', 'monday', matchesDay)).toBeNull();
});
