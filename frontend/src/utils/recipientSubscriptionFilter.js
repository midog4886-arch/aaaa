const datePart = value => {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
};

export const subscriptionIsActive = (activity, today) => {
  const end = datePart(activity?.end_date);
  return end ? end >= today : activity?.status === 'active';
};

export const subscriptionIsExpired = (activity, today) => {
  const end = datePart(activity?.end_date);
  return Boolean(end && end < today);
};

export const memberMatchesSubscriptionFilter = (member, filter, today) => {
  if (filter === 'all') return true;
  const activities = member?.activities || [];
  const hasActive = activities.some(activity => subscriptionIsActive(activity, today));
  if (filter === 'active') return hasActive;
  return !hasActive && activities.length > 0 && activities.every(activity => subscriptionIsExpired(activity, today));
};
