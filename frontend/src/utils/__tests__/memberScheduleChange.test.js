import { activityWeekdaysChanged, scheduleWeekdayKey, scheduleChangeError } from '../memberScheduleChange';

test('time-only edits and reordered weekdays do not trigger the reviewed schedule flow', () => {
  const old = { schedule: 'الإثنين و الأربعاء - 9:00 م', training_days: ['الإثنين', 'الأربعاء'] };
  expect(activityWeekdaysChanged(old, {
    schedule: 'الأربعاء و الإثنين - 5:00 م', training_days: ['الأربعاء', 'الإثنين'],
  })).toBe(false);
  expect(activityWeekdaysChanged(old, {
    schedule: 'الإثنين و الخميس - 9:00 م', training_days: ['الإثنين', 'الخميس'],
  })).toBe(true);
});

test('older subscriptions without training_days compare weekdays in the schedule text', () => {
  expect(scheduleWeekdayKey({ schedule: 'الاثنين و الثلاثاء - 9:00 م' }))
    .toBe(scheduleWeekdayKey({ training_days: ['الإثنين', 'الثلاثاء'] }));
  expect(activityWeekdaysChanged(
    { schedule: 'الاثنين و الثلاثاء - 9:00 م' },
    { schedule: 'الإثنين و الأربعاء - 9:00 م' },
  )).toBe(true);
});

test('backend conflict detail is displayed without a misleading generic success', () => {
  expect(scheduleChangeError({ response: { data: { detail: 'schedule_preview_required' } } }))
    .toBe('schedule_preview_required');
});