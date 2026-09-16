import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ProfileOverview from '../ProfileOverview';
import { membersAPI } from '../../../services/api';

jest.mock('../../../services/api', () => ({ membersAPI: { getProfileSummary: jest.fn() } }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-16T09:00:00Z'));
});
afterEach(() => jest.useRealTimers());

const member = {
  notes: 'Bring medical clearance',
  activities: [
    { activity_id: 'swim', activity_name: 'Swimming', status: 'active', schedule: 'Sun 18:00', start_date: '2020-01-01', end_date: '2030-02-02' },
    { activity_id: 'swim', activity_name: 'Swimming old', status: 'active', schedule: 'Old', start_date: '2020-01-01', end_date: '2029-01-01' },
    { activity_id: 'karate', activity_name: 'Karate', status: 'active', schedule: 'Tue 17:00', start_date: '2020-01-01', end_date: '2030-04-01' },
  ],
};

test('gates financial and attendance snapshots without requesting a restricted financial summary', () => {
  const onTab = jest.fn();
  render(<ProfileOverview member={member} attendance={{ summary: { present_count: 6 } }} canViewFinancial={false} canViewAttendance={false} language="en" onTab={onTab} scopeKey="a" />);
  expect(screen.getAllByText('Not available')).toHaveLength(2);
  expect(membersAPI.getProfileSummary).not.toHaveBeenCalled();
  expect(screen.getByText('2 active')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /open & edit/i }));
  expect(onTab).toHaveBeenCalledWith('info');
});

test('uses the member profile summary count, never a passed invoice total', async () => {
  membersAPI.getProfileSummary.mockResolvedValue({ data: { paid_invoice_count: 1 } });
  render(<ProfileOverview member={member} attendance={{ summary: { present_count: 6 } }} canViewFinancial canViewAttendance language="en" onTab={jest.fn()} scopeKey="a" />);
  expect(await screen.findByText('1 invoices')).toBeInTheDocument();
  expect(screen.getByText('6 present')).toBeInTheDocument();
});

const future = { activity_id: 'swim', activity_name: 'Future swimming', status: 'active', schedule: 'Mon & Wed 17:00', start_date: '2026-09-28', end_date: '2026-10-21' };
const overview = activities => render(<ProfileOverview member={{ activities }} canViewFinancial={false} canViewAttendance={false} language="en" onTab={jest.fn()} />);

test('shows a future subscription, its schedule and dates without calling it active', () => {
  overview([future]);
  expect(screen.getByText('1 upcoming — not started yet')).toBeInTheDocument();
  expect(screen.queryByText('No active subscription')).not.toBeInTheDocument();
  expect(screen.getByText('Next subscription starts')).toBeInTheDocument();
  expect(screen.getByText('28/09/2026')).toBeInTheDocument();
  expect(screen.getByText(/Ends: 21\/10\/2026/)).toBeInTheDocument();
  expect(screen.getByText('Upcoming schedule')).toBeInTheDocument();
  expect(screen.getAllByText(future.schedule)).toHaveLength(2);
});

test('a future renewal does not hide the current period of the same activity', () => {
  overview([{ ...future, start_date: '2026-09-01', end_date: '2026-09-27', schedule: 'Current Monday 16:00' }, future]);
  expect(screen.getByText('1 active · 1 upcoming — not started yet')).toBeInTheDocument();
  expect(screen.getByText('Current schedule')).toBeInTheDocument();
  expect(screen.getByText('Current Monday 16:00')).toBeInTheDocument();
  expect(screen.getByText('27/09/2026')).toBeInTheDocument();
  expect(screen.getByText(future.schedule)).toBeInTheDocument();
});

test('expired and cancelled subscriptions are not counted as upcoming', () => {
  overview([{ ...future, status: 'cancelled' }, { ...future, start_date: '2026-08-01', end_date: '2026-08-31' }]);
  expect(screen.getByText('No active subscription')).toBeInTheDocument();
  expect(screen.queryByText('Upcoming schedule')).not.toBeInTheDocument();
});

test('a subscription starting today is current, including timestamp dates', () => {
  overview([{ ...future, start_date: '2026-09-16T00:00:00' }]);
  expect(screen.getByText('1 active')).toBeInTheDocument();
  expect(screen.getByText('Current schedule')).toBeInTheDocument();
});