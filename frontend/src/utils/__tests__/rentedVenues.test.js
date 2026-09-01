import {
  monthDates,
  slotOccursOnDate,
  slotsOverlap,
  venueSlotsForDate,
  weekdayIdForDate,
  serializeVenues,
} from '../rentedVenues';

describe('rented venue monthly bookings', () => {
  const tuesdayBooking = {
    id: 'booking-1',
    weekday: 'tuesday',
    start_time: '18:00',
    end_time: '19:00',
    start_date: '2026-09-01',
    end_date: '2026-09-01',
  };

  test('creates every day in the selected month', () => {
    expect(monthDates(new Date(2026, 8, 1))).toHaveLength(30);
    expect(monthDates(new Date(2026, 1, 1))).toHaveLength(28);
  });

  test('a one-day booking appears only on its exact date', () => {
    expect(weekdayIdForDate(new Date('2026-09-01T12:00:00'))).toBe('tuesday');
    expect(slotOccursOnDate(tuesdayBooking, new Date('2026-09-01T12:00:00'))).toBe(true);
    expect(slotOccursOnDate(tuesdayBooking, new Date('2026-09-08T12:00:00'))).toBe(false);
  });

  test('rejects overlapping hours for the same venue date', () => {
    expect(slotsOverlap(tuesdayBooking, {
      ...tuesdayBooking,
      id: 'booking-2',
      start_time: '18:30',
      end_time: '19:30',
    })).toBe(true);
    expect(slotsOverlap(tuesdayBooking, {
      ...tuesdayBooking,
      id: 'booking-3',
      start_time: '19:00',
      end_time: '20:00',
    })).toBe(false);
  });

  test('keeps bookings on different dates separate', () => {
    expect(slotsOverlap(tuesdayBooking, {
      ...tuesdayBooking,
      id: 'booking-4',
      start_date: '2026-09-08',
      end_date: '2026-09-08',
    })).toBe(false);
  });

  test('returns a day slots in time order', () => {
    const venue = {
      booking_slots: [
        { ...tuesdayBooking, id: 'late', start_time: '20:00', end_time: '21:00' },
        tuesdayBooking,
      ],
    };
    expect(venueSlotsForDate(venue, new Date('2026-09-01T12:00:00')).map(slot => slot.id))
      .toEqual(['booking-1', 'late']);
  });

  test('keeps hourly price, total, and payment data when saving', () => {
    const [venue] = serializeVenues([{
      id: 'venue-1',
      name: 'Court',
      number: '1',
      size: '20x40',
      contract_start_date: '2026-09-01',
      contract_end_date: '2026-09-30',
      cost: 100,
      cost_type: 'hourly',
      warning_days: 30,
      booking_slots: [{
        ...tuesdayBooking,
        hourly_rate: 175,
        duration_hours: 1,
        total_cost: 175,
        payment_status: 'paid',
        payment_method: 'card',
      }],
    }]);

    expect(venue.booking_slots[0]).toEqual(expect.objectContaining({
      hourly_rate: 175,
      duration_hours: 1,
      total_cost: 175,
      payment_status: 'paid',
      payment_method: 'card',
    }));
  });
});