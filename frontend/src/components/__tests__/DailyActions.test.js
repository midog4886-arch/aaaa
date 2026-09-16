import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DailyActions, { pageFor } from '../DailyActions';

jest.mock('../../services/api', () => ({ dashboardAPI: { getActions: jest.fn() } }));
jest.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
let mockBranch = 'north';
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ selectedBranchId: mockBranch, switchBranch: jest.fn(), user: { id: 'u1' } }) }));
jest.mock('../ui/button', () => ({ Button: ({ children, ...props }) => <button type="button" {...props}>{children}</button> }));
jest.mock('../ui/card', () => ({ Card: ({ children, ...props }) => <div {...props}>{children}</div>, CardContent: ({ children, ...props }) => <div {...props}>{children}</div> }));

const { dashboardAPI } = require('../../services/api');
const response = groups => ({ data: { generated_at: '2025-01-01T10:00:00Z', groups } });
const expiring = { key: 'expiring', count: 2, status: 'ready', items: [{ id: 'm1', title: 'Lina S.', detail: 'Swimming · 4 days', kind: 'member', entity_id: 'm1', branch_id: 'north' }], has_more: false };

beforeEach(() => {
  mockBranch = 'north';
  jest.clearAllMocks();
  dashboardAPI.getActions.mockResolvedValue(response([expiring]));
});

test('opens the API-supplied actionable list and omits unavailable permission groups', async () => {
  render(<DailyActions />);
  await screen.findByText('Renewals due');
  expect(screen.queryByText('Confirmed failures')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Renewals due: 2/ }));
  expect(await screen.findByText('Lina S.')).toBeInTheDocument();
  expect(screen.getByText('Swimming · 4 days')).toBeInTheDocument();
});

test('distinguishes API errors and a ready zero state', async () => {
  dashboardAPI.getActions.mockRejectedValueOnce(new Error('offline'));
  const view = render(<DailyActions />);
  expect(await screen.findByText('Daily actions could not be loaded.')).toBeInTheDocument();
  dashboardAPI.getActions.mockResolvedValueOnce(response([]));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/No daily actions are available/)).toBeInTheDocument();
  view.unmount();
});

test('does not let a late former-branch response replace the current branch', async () => {
  let resolveNorth;
  const north = new Promise(resolve => { resolveNorth = resolve; });
  dashboardAPI.getActions.mockImplementation(params => params.branch_filter === 'north' ? north : Promise.resolve(response([{ ...expiring, count: 7 }])));
  const view = render(<DailyActions />);
  mockBranch = 'south';
  view.rerender(<DailyActions />);
  await screen.findByRole('button', { name: /Renewals due: 7/ });
  await act(async () => { resolveNorth(response([expiring])); });
  await waitFor(() => expect(screen.getByRole('button', { name: /Renewals due: 7/ })).toBeInTheDocument());
});

test('dedupes an in-flight request across a quick remount for the same auth and branch', async () => {
  let resolve;
  dashboardAPI.getActions.mockImplementation(() => new Promise(nextResolve => { resolve = nextResolve; }));

  const firstView = render(<DailyActions />);
  await waitFor(() => expect(dashboardAPI.getActions).toHaveBeenCalledTimes(1));
  firstView.unmount();
  render(<DailyActions />);

  expect(dashboardAPI.getActions).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(response([expiring]));
  });
  expect(await screen.findByRole('button', { name: /Renewals due: 2/ })).toBeInTheDocument();
});

test('keeps partial and all group errors visible instead of treating them as zero work', async () => {
  dashboardAPI.getActions.mockResolvedValueOnce(response([
    expiring,
    { key: 'absence', count: null, status: 'error', items: [], has_more: false },
  ]));
  const view = render(<DailyActions />);
  expect(await screen.findByText('Attendance follow-up')).toBeInTheDocument();
  expect(screen.getByText('Unavailable right now — retry')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry unavailable' })).toBeInTheDocument();
  view.unmount();

  dashboardAPI.getActions.mockResolvedValueOnce(response([
    { key: 'absence', count: null, status: 'error', items: [], has_more: false },
  ]));
  render(<DailyActions />);
  expect(await screen.findByText('Attendance follow-up')).toBeInTheDocument();
  expect(screen.queryByText(/No daily actions are available/)).not.toBeInTheDocument();
});

test('sends renewals-only actions to the supported renewals page', async () => {
  expect(pageFor('expiring', { kind: 'member', entity_id: 'm1' })).toBe('/admin/renewals');
});