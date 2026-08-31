export const WEEKDAYS = [
  { id: 'saturday', ar: 'السبت', en: 'Saturday' },
  { id: 'sunday', ar: 'الأحد', en: 'Sunday' },
  { id: 'monday', ar: 'الاثنين', en: 'Monday' },
  { id: 'tuesday', ar: 'الثلاثاء', en: 'Tuesday' },
  { id: 'wednesday', ar: 'الأربعاء', en: 'Wednesday' },
  { id: 'thursday', ar: 'الخميس', en: 'Thursday' },
  { id: 'friday', ar: 'الجمعة', en: 'Friday' },
];

export const emptyVenue = () => ({
  id: '',
  name: '',
  number: '',
  size: '',
  contract_start_date: '',
  contract_end_date: '',
  cost: '',
  cost_type: 'monthly',
  warning_days: '30',
  booking_slots: [],
});

export const branchVenues = (branch = {}) => {
  if (Array.isArray(branch.venues) && branch.venues.length) return branch.venues;
  if (Array.isArray(branch.rented_venues)) return branch.rented_venues;
  return Array.isArray(branch.venues) ? branch.venues : [];
};

export const normalizeVenue = (venue = {}) => ({
  ...emptyVenue(),
  ...venue,
  id: venue.id || '',
  size: venue.size ?? '',
  cost: venue.cost ?? venue.booking_slots?.[0]?.cost ?? '',
  cost_type: venue.cost_type || venue.booking_slots?.[0]?.cost_type || 'monthly',
  warning_days: venue.warning_days ?? 30,
  contract_start_date: venue.contract_start_date || venue.booking_slots?.[0]?.start_date || '',
  contract_end_date: venue.contract_end_date || venue.booking_slots?.[0]?.end_date || '',
  booking_slots: (venue.booking_slots || []).map(slot => ({
    id: slot.id || '',
    weekday: slot.weekday || slot.day || slot.day_of_week || '',
    start_time: slot.start_time || slot.start || '',
    end_time: slot.end_time || slot.end || '',
    start_date: slot.start_date || venue.contract_start_date || '',
    end_date: slot.end_date || venue.contract_end_date || '',
    cost: slot.cost ?? venue.cost ?? '',
    cost_type: slot.cost_type || venue.cost_type || 'monthly',
  })).filter(slot => slot.weekday),
});

export const serializeVenues = venues => venues.map(venue => ({
  ...(venue.id ? { id: venue.id } : {}),
  name: venue.name.trim(),
  number: (venue.number || '').trim(),
  size: String(venue.size || venue.number || venue.name).trim(),
  contract_start_date: venue.contract_start_date,
  contract_end_date: venue.contract_end_date,
  cost: Number(venue.cost),
  cost_type: venue.cost_type,
  warning_days: Number(venue.warning_days),
  booking_slots: WEEKDAYS.flatMap(day =>
    venue.booking_slots
      .filter(slot => slot.weekday === day.id)
      .map(slot => ({
        ...(slot.id ? { id: slot.id } : {}),
        day: day.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        start_date: slot.start_date || venue.contract_start_date,
        end_date: slot.end_date || venue.contract_end_date,
        cost: Number(slot.cost ?? venue.cost),
        cost_type: slot.cost_type || venue.cost_type,
      }))
  ),
}));

export const venueState = (venue, levels, now = new Date()) => {
  const end = venue.contract_end_date || venue.booking_slots?.[0]?.end_date;
  if (end && new Date(`${end}T23:59:59`) < now) return 'expired';
  if ((levels || []).some(level => level.is_active !== false && level.venue_id === venue.id)) return 'reserved';
  return 'available';
};