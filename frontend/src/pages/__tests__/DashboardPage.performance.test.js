import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../services/api', () => ({
  dashboardAPI: {
    getSettings: jest.fn(),
    getStats: jest.fn(),
    getActions: jest.fn(),
  },
  reportsAPI: {
    getExpiringSubscriptions: jest.fn(),
  },
  discountsAPI: {
    getAll: jest.fn(),
  },
  tournamentsAPI: {
    getRecentMedalists: jest.fn(),
  },
  attendanceAPI: {
    getTodaySummary: jest.fn(),
  },
  membersAPI: { getAll: jest.fn() },
  activitiesAPI: { getAll: jest.fn() },
  invoicesAPI: {},
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: key => key,
  }),
}));

let mockSelectedBranchId = 'branch-a';
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    selectedBranchId: mockSelectedBranchId,
  }),
}));

jest.mock('../../components/Layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../components/WelcomeOnboardingDialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../components/ui/card', () => {
  const React = require('react');
  const passthrough = ({ children, ...props }) => <div {...props}>{children}</div>;
  return {
    Card: passthrough,
    CardContent: passthrough,
    CardHeader: passthrough,
    CardTitle: passthrough,
  };
});

jest.mock('../../components/ui/badge', () => {
  const React = require('react');
  return { Badge: ({ children, ...props }) => <span {...props}>{children}</span> };
});

jest.mock('../../components/ui/button', () => {
  const React = require('react');
  return {
    Button: ({ children, onClick, ...props }) => (
      <button type="button" onClick={onClick} {...props}>{children}</button>
    ),
  };
});

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const {
  dashboardAPI,
  reportsAPI,
  discountsAPI,
  tournamentsAPI,
  attendanceAPI,
} = require('../../services/api');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const makeBranchRequests = () => ({
  stats: deferred(),
  expiring: deferred(),
  discounts: deferred(),
  champions: deferred(),
  attendance: deferred(),
});

let pending;

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedBranchId = 'branch-a';
  pending = {
    'branch-a': makeBranchRequests(),
    'branch-b': makeBranchRequests(),
  };

  dashboardAPI.getSettings.mockResolvedValue({ data: { widgets: [] } });
  dashboardAPI.getActions.mockResolvedValue({ data: { groups: [] } });
  dashboardAPI.getStats.mockImplementation((params = {}) => (
    pending[params.branch_filter || 'all'].stats.promise
  ));
  reportsAPI.getExpiringSubscriptions.mockImplementation((days, branch) => (
    pending[branch || 'all'].expiring.promise
  ));
  discountsAPI.getAll.mockImplementation((params = {}) => (
    pending[params.branch_filter || 'all'].discounts.promise
  ));
  tournamentsAPI.getRecentMedalists.mockImplementation((params = {}) => (
    pending[params.branch_filter || 'all'].champions.promise
  ));
  attendanceAPI.getTodaySummary.mockImplementation((params = {}) => (
    pending[params.branch_filter || 'all'].attendance.promise
  ));
});

const resolveBranch = (branch, label) => {
  pending[branch].stats.resolve({ data: { members_count: label } });
  pending[branch].expiring.resolve({
    data: [{ member_name: `${label} expiring`, activity_name: 'Swimming', phone: '0500', days_remaining: 2 }],
  });
  pending[branch].discounts.resolve({ data: [] });
  pending[branch].champions.resolve({ data: [] });
  pending[branch].attendance.resolve({ data: null });
};

test('dedupes an in-flight branch bundle and ignores an older branch response', async () => {
  const DashboardPage = require('../DashboardPage').default;
  const view = render(<DashboardPage />);

  mockSelectedBranchId = 'branch-b';
  view.rerender(<DashboardPage />);
  mockSelectedBranchId = 'branch-a';
  view.rerender(<DashboardPage />);

  // Returning to branch A while its first request is still pending reuses that
  // request instead of sending a second five-read bundle.
  expect(dashboardAPI.getStats).toHaveBeenCalledTimes(2);
  expect(reportsAPI.getExpiringSubscriptions).toHaveBeenCalledTimes(2);
  expect(discountsAPI.getAll).toHaveBeenCalledTimes(2);
  expect(tournamentsAPI.getRecentMedalists).toHaveBeenCalledTimes(2);
  expect(attendanceAPI.getTodaySummary).toHaveBeenCalledTimes(2);

  await act(async () => {
    resolveBranch('branch-b', 'Branch B');
    await Promise.resolve();
  });
  await act(async () => {
    resolveBranch('branch-a', 'Branch A');
    await Promise.resolve();
  });

  await waitFor(() => expect(screen.getByText('Branch A expiring')).toBeInTheDocument());
  expect(screen.queryByText('Branch B expiring')).not.toBeInTheDocument();
});

test('shows Daily Actions before the dashboard reads settle', async () => {
  dashboardAPI.getActions.mockResolvedValue({
    data: {
      groups: [{ key: 'expiring', count: 3, status: 'ready', items: [], has_more: false }],
    },
  });
  const DashboardPage = require('../DashboardPage').default;

  render(<DashboardPage />);

  expect(await screen.findByRole('button', { name: /Renewals due: 3/ })).toBeInTheDocument();
  expect(dashboardAPI.getStats).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Loading today's attendance…")).toBeInTheDocument();
});

test('renders stats when ready while attendance stays independent and shows its error', async () => {
  const DashboardPage = require('../DashboardPage').default;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<DashboardPage />);

  // Wait for the effect to subscribe to this deferred request before settling
  // it. Resolving during the initial render can predate that subscription.
  await waitFor(() => expect(dashboardAPI.getStats).toHaveBeenCalledTimes(1));
  await act(async () => {
    pending['branch-a'].stats.resolve({ data: { members_count: 12 } });
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Show Numbers' }));
  fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: '242456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  expect(await screen.findByText('12')).toBeInTheDocument();
  expect(screen.getByText("Loading today's attendance…")).toBeInTheDocument();

  await act(async () => {
    pending['branch-a'].attendance.reject(new Error('offline'));
    await Promise.resolve();
  });
  expect(await screen.findByText("Today's attendance could not be loaded.")).toBeInTheDocument();
  expect(screen.queryByText('No attendance recorded yet today')).not.toBeInTheDocument();
  expect(consoleError).toHaveBeenCalledWith('Failed to load today attendance:', expect.any(Error));
  consoleError.mockRestore();
});