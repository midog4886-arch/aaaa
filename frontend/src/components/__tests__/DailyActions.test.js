import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DailyActions, { pageFor } from '../DailyActions';

jest.mock('../../services/api', () => ({ dashboardAPI: { getActions: jest.fn() } }));
jest.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
let mockBranch = 'north';
let mockUserId = 0;
const mockSwitchBranch = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ selectedBranchId: mockBranch, switchBranch: mockSwitchBranch, user: { id: `u${mockUserId}` } }) }));
jest.mock('../ui/button', () => ({ Button: ({ children, ...props }) => <button type="button" {...props}>{children}</button> }));
jest.mock('../ui/card', () => ({ Card: ({ children, ...props }) => <div {...props}>{children}</div>, CardContent: ({ children, ...props }) => <div {...props}>{children}</div> }));

const { dashboardAPI } = require('../../services/api');
const response = groups => ({ data: { generated_at: '2025-01-01T10:00:00Z', groups } });
const expiring = { key: 'expiring', count: 2, status: 'ready', items: [{ id: 'm1', title: 'Lina S.', detail: 'Swimming · 4 days', kind: 'member', entity_id: 'm1', branch_id: 'north' }], has_more: false };
const allGroups = [
  expiring,
  { key: 'absence', count: 1, status: 'ready', items: [{ id: 'a1', title: 'Absent member', detail: '3 absences', kind: 'attendance', entity_id: 'm2', branch_id: 'north' }], has_more: false },
  { key: 'registrations', count: 1, status: 'ready', items: [{ id: 'r1', title: 'Registration', detail: 'Pending review', kind: 'registration_request', entity_id: 'r1', branch_id: 'north' }], has_more: false },
  { key: 'conversations', count: 1, status: 'ready', items: [{ id: 'c1', title: 'Inbound contact', detail: 'Last inbound message', kind: 'whatsapp', entity_id: 'c1', branch_id: 'north' }], has_more: false },
  { key: 'failures', count: 1, status: 'ready', items: [{ id: 'f1', title: 'Failed payment', detail: 'Declined', kind: 'failed_payment', entity_id: 'f1' }], has_more: false },
];

beforeEach(() => {
  mockBranch = 'north';
  mockUserId += 1;
  jest.clearAllMocks();
  dashboardAPI.getActions.mockResolvedValue(response([expiring]));
});

test('inbound Open targets the exact conversation and branch without a phone lookup', () => {
  const target = pageFor('conversations', { entity_id: 'branch-a:966500000000', branch_id: 'branch-a' });
  const url = new URL(target, 'https://example.test');
  expect(url.pathname).toBe('/admin/whatsapp');
  expect(url.searchParams.get('conversation')).toBe('branch-a:966500000000');
  expect(url.searchParams.get('branch')).toBe('branch-a');
  expect(pageFor('registrations', { entity_id: 'r1' })).toBe('/admin/registration-requests');
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

test('all five cards open their current API-supplied lists, including an empty list', async () => {
  dashboardAPI.getActions.mockResolvedValueOnce(response(allGroups.map(group => (
    group.key === 'conversations' ? { ...group, count: 0, items: [] } : group
  ))));
  render(<DailyActions />);

  const expectations = [
    ['Renewals due', 'Lina S.'],
    ['Attendance follow-up', 'Absent member'],
    ['Pending registrations', 'Registration'],
    ['Latest inbound', 'There are no items to show.'],
    ['Confirmed failures', 'Failed payment'],
  ];
  for (const [card, item] of expectations) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${card}:`) }));
    expect(await screen.findByText(item)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  }
});

test('routes every backend action kind only to an existing matching list page', () => {
  expect(pageFor('expiring', { kind: 'member' })).toBe('/admin/renewals');
  expect(pageFor('absence', { kind: 'attendance' })).toBe('/admin/attendance');
  expect(pageFor('registrations', { kind: 'registration_request' })).toBe('/admin/registration-requests');
  expect(pageFor('conversations', { kind: 'whatsapp' })).toBe('/admin/whatsapp');
  expect(pageFor('failures', { kind: 'failed_send' })).toBe('/admin/whatsapp');
  expect(pageFor('failures', { kind: 'failed_payment' })).toBe('/admin/settings#billing');
  expect(pageFor('failures', { kind: 'payment' })).toBe('/admin/settings#billing');
  expect(pageFor('failures', { kind: 'billing_payment' })).toBe('/admin/settings#billing');
});

test('manual refresh is deduped in flight and keeps cards and an open dialog live', async () => {
  const refreshed = { ...expiring, count: 3, items: [{ ...expiring.items[0], title: 'Updated member' }] };
  let resolveRefresh;
  dashboardAPI.getActions
    .mockResolvedValueOnce(response([expiring]))
    .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
  render(<DailyActions />);
  fireEvent.click(await screen.findByRole('button', { name: /Renewals due: 2/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh daily actions' }));
  await waitFor(() => expect(dashboardAPI.getActions).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Lina S.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Loading actions')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh daily actions' }));
  expect(dashboardAPI.getActions).toHaveBeenCalledTimes(2);
  await act(async () => { resolveRefresh(response([refreshed])); });
  expect(await screen.findByText('Updated member')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Renewals due: 3/ })).toBeInTheDocument();
});

test('polls every 60 seconds only while the dashboard document is visible', async () => {
  jest.useFakeTimers();
  let visibility = 'visible';
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  render(<DailyActions />);
  await act(async () => {});
  expect(dashboardAPI.getActions).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(dashboardAPI.getActions).toHaveBeenCalledTimes(2);
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(dashboardAPI.getActions).toHaveBeenCalledTimes(2);
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  jest.useRealTimers();
});
