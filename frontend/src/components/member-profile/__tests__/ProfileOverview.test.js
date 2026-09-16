import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ProfileOverview from '../ProfileOverview';
import { membersAPI } from '../../../services/api';

jest.mock('../../../services/api', () => ({ membersAPI: { getProfileSummary: jest.fn() } }));

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