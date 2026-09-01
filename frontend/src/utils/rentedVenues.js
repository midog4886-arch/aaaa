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
    hourly_rate: slot.hourly_rate ?? (slot.cost_type === 'hourly' ? slot.cost : venue.cost) ?? '',
    duration_hours: slot.duration_hours ?? '',
    total_cost: slot.total_cost ?? '',
    payment_status: slot.payment_status || 'unpaid',
    payment_method: slot.payment_method || '',
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
        hourly_rate: slot.hourly_rate === '' || slot.hourly_rate === undefined
          ? null
          : Number(slot.hourly_rate),
        duration_hours: slot.duration_hours === '' || slot.duration_hours === undefined
          ? null
          : Number(slot.duration_hours),
        total_cost: slot.total_cost === '' || slot.total_cost === undefined
          ? null
          : Number(slot.total_cost),
        payment_status: slot.payment_status || 'unpaid',
        payment_method: slot.payment_status === 'paid' ? (slot.payment_method || 'cash') : null,
      }))
  ),
}));

export const venueState = (venue, levels, now = new Date()) => {
  const end = venue.contract_end_date || venue.booking_slots?.[0]?.end_date;
  if (end && new Date(`${end}T23:59:59`) < now) return 'expired';
  if ((levels || []).some(level => level.is_active !== false && level.venue_id === venue.id)) return 'reserved';
  return 'available';
};

const pad = value => String(value).padStart(2, '0');

export const toLocalDateKey = date =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const monthDates = monthDate => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => new Date(year, month, index + 1));
};

export const weekdayIdForDate = date => [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
][date.getDay()];

export const slotOccursOnDate = (slot, date) => {
  const key = toLocalDateKey(date);
  return (slot.weekday || slot.day) === weekdayIdForDate(date) &&
    (!slot.start_date || slot.start_date <= key) &&
    (!slot.end_date || slot.end_date >= key);
};

export const venueSlotsForDate = (venue, date) =>
  (venue.booking_slots || [])
    .filter(slot => slotOccursOnDate(slot, date))
    .sort((left, right) => left.start_time.localeCompare(right.start_time));

export const slotsOverlap = (left, right) => {
  const leftStart = left.start_date || '';
  const leftEnd = left.end_date || leftStart;
  const rightStart = right.start_date || '';
  const rightEnd = right.end_date || rightStart;
  return (left.weekday || left.day) === (right.weekday || right.day) &&
    leftStart <= rightEnd && rightStart <= leftEnd &&
    left.start_time < right.end_time && right.start_time < left.end_time;
};