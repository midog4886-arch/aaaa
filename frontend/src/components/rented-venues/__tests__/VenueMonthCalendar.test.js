import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VenueMonthCalendar from '../VenueMonthCalendar';

test('opens a day to inspect bookings and shows each booker on the calendar', () => {
  const onViewDay = jest.fn();
  render(<VenueMonthCalendar
    ar={false}
    month={new Date(2026, 10, 1)}
    venues={[{
      id: 'court-1', name: 'Court 1', booking_slots: [{
        id: 'booking-1', weekday: 'sunday', start_date: '2026-11-01', end_date: '2026-11-01',
        start_time: '20:00', end_time: '22:00', booker_name: 'Ahmed', booker_phone: '0501234567',
      }],
    }]}
    isSlotReserved={() => false}
    onMonthChange={jest.fn()}
    onViewDay={onViewDay}
    onAddBooking={jest.fn()}
    onEditBooking={jest.fn()}
  />);

  expect(screen.getByText('Ahmed')).toBeInTheDocument();
  expect(screen.getByText('0501234567')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View bookings for 2026-11-01 - Court 1' }));
  expect(onViewDay).toHaveBeenCalledWith(expect.objectContaining({ id: 'court-1' }), '2026-11-01');
});
