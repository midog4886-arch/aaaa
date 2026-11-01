const WEEKDAY_IDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const weekdayForISODate = (isoDate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return null;
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate
    ? null : WEEKDAY_IDS[parsed.getUTCDay()];
};

const activityCoversDate = (activity, date) => {
  if (activity?.status && activity.status !== 'active') return false;
  const start = String(activity?.start_date || '').slice(0, 10);
  const end = String(activity?.end_date || '').slice(0, 10);
  return (!start || start <= date) && (!end || end >= date);
};

export const forecastLevelForDate = (level, membersById, date, day, matchesMemberDay) => {
  if (Array.isArray(level.days) && level.days.length && !level.days.includes(day)) return null;
  const details = (level.members_details || []).filter(detail => {
    if (!matchesMemberDay(detail, day)) return false;
    const member = membersById.get(detail.member_id);
    if (!member) return false;
    const activities = member.activities || [];
    const linked = activities.filter(activity => activity.level_id === level.id);
    // Legacy level rows without explicit links can still have one activity.
    const relevant = linked.length ? linked : activities.length === 1 ? activities : [];
    return relevant.some(activity => activityCoversDate(activity, date));
  });
  return { ...level, members_details: details, members: details.map(detail => detail.member_id) };
};
