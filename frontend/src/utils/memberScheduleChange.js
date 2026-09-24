// Compare weekdays, not the free-form training-hour text. Older subscriptions
// may have a schedule string without a training_days array.
const DAY_ALIASES = [
  ['الأحد', 'الاحد', 'sunday'],
  ['الإثنين', 'الاثنين', 'monday'],
  ['الثلاثاء', 'tuesday'],
  ['الأربعاء', 'الاربعاء', 'wednesday'],
  ['الخميس', 'thursday'],
  ['الجمعة', 'friday'],
  ['السبت', 'saturday'],
];

export const scheduleWeekdayKey = (activity = {}) => {
  const days = activity.training_days?.length
    ? activity.training_days
    : (activity.schedule || '').split(/[\s،,-]+/);
  const text = days.join(' ').toLowerCase();
  return DAY_ALIASES.map((aliases, index) =>
    aliases.some(alias => text.includes(alias)) ? index : null
  ).filter(index => index !== null).join(',');
};

export const activityWeekdaysChanged = (before, after) =>
  scheduleWeekdayKey(before) !== scheduleWeekdayKey(after);

export const scheduleChangeError = (error, language = 'ar') => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(item => item.msg || item.message).filter(Boolean).join('؛ ');
  }
  return language === 'ar' ? 'تعذّرت مراجعة تعديل الموعد؛ لم يُحفظ التعديل' : 'Schedule review failed; nothing was saved';
};