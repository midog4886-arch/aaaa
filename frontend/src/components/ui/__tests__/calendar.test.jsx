import React from 'react';
import { render, screen } from '@testing-library/react';
import { Calendar } from '../calendar';

test('renders an interactive month with the updated DayPicker', () => {
  render(<Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} />);
  expect(screen.getByRole('grid')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /next month/i })).toBeInTheDocument();
});
