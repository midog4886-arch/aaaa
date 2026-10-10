import { campaignCalendar, riyadhMonth, shiftMonth } from '../campaignCalendar';

test('splits a campaign across Riyadh dates and shows days without sending', () => {
  const days = campaignCalendar([
    { id: 'one', title: 'Campaign', status: 'queued', count: 120, daily_recipients: 50, start_date: '2026-10-10' },
    { id: 'two', title: 'Review', status: 'pending_review', count: 20, daily_recipients: 20, start_date: '2026-10-11' },
    { id: 'cancelled', title: 'Cancelled', status: 'cancelled', count: 100, daily_recipients: 50, start_date: '2026-10-10' },
  ], '2026-10');
  expect(days.find(day => day.date === '2026-10-10')).toMatchObject({ approved: 50, awaiting: 0 });
  expect(days.find(day => day.date === '2026-10-11')).toMatchObject({ approved: 50, awaiting: 20 });
  expect(days.find(day => day.date === '2026-10-12')).toMatchObject({ approved: 20, awaiting: 0 });
  expect(days.find(day => day.date === '2026-10-13')).toMatchObject({ approved: 0, awaiting: 0, campaigns: [] });
});

test('direct campaign uses Riyadh date and month navigation crosses years', () => {
  const days = campaignCalendar([{ id: 'direct', title: 'Direct', status: 'scheduled', count: 7, schedule_at: '2026-10-09T22:30:00Z' }], '2026-10');
  expect(days.find(day => day.date === '2026-10-10').approved).toBe(7);
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  expect(riyadhMonth(new Date('2026-10-09T22:30:00Z'))).toBe('2026-10');
});
