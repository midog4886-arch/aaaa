import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockNotificationsAPI = {
  getExpiringSubscriptions: jest.fn(),
};
const mockBranchesAPI = { getAll: jest.fn() };
const mockWhatsappAPI = {
  getReminderTemplate: jest.fn(),
  getLastRemindersFiltered: jest.fn(),
  getLastReminders: jest.fn(),
};
const mockAuth = {
  selectedBranchId: 'branch-a',
  user: {
    id: 'renewals-test-user',
    tenant_id: 'tenant-a',
    is_admin: true,
    permissions: ['member-phones'],
  },
};

jest.mock('../../services/api', () => ({
  notificationsAPI: mockNotificationsAPI,
  branchesAPI: mockBranchesAPI,
  whatsappAPI: mockWhatsappAPI,
  invoicesAPI: {},
  membersAPI: {},
  discountsAPI: {},
  activitiesAPI: {},
  levelsAPI: {},
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key) => key }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
}));

jest.mock('../../components/Layout', () => ({
  Layout: ({ children }) => <main>{children}</main>,
}));

jest.mock('../../components/MemberAvatar', () => () => <span data-testid="member-avatar" />);
jest.mock('../../components/ScheduleDaysTimeEditor', () => ({
  __esModule: true,
  default: () => null,
  buildMemberSchedule: jest.fn(() => ''),
}));

jest.mock('../../components/ui/card', () => ({
  Card: ({ children, ...props }) => <section {...props}>{children}</section>,
  CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
}));
jest.mock('../../components/ui/button', () => ({
  Button: ({ children, asChild, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../components/ui/input', () => ({
  Input: (props) => <input {...props} />,
}));
jest.mock('../../components/ui/badge', () => ({
  Badge: ({ children, ...props }) => <span {...props}>{children}</span>,
}));
jest.mock('../../components/ui/textarea', () => ({
  Textarea: (props) => <textarea {...props} />,
}));
jest.mock('../../components/ui/dialog', () => ({
  Dialog: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../components/ui/select', () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const RenewalsPage = require('../RenewalsPage').default;

const expiring = {
  member_id: 'member-expiring',
  member_code: 'E-100',
  member_name: 'Expiring Member',
  phone: '',
  branch_id: 'branch-a',
  activity_name: 'Swimming',
  fee: 0,
  nationality: 'Saudi',
  end_date: '2026-04-10',
  days_remaining: 5,
};

const renewedFromServer = {
  member_id: 'member-renewed',
  member_code: 'R-200',
  member_name: 'Invoice Renewed Member',
  phone: '',
  branch_id: 'branch-a',
  activity_name: 'Football',
  fee: 175,
  nationality: 'Jordanian',
  end_date: '2026-05-20',
  days_remaining: 45,
  _renewed: true,
};

const expiredEvidence = {
  member_id: 'member-expired',
  member_code: 'X-300',
  member_name: 'Expired Evidence Member',
  phone: '',
  branch_id: 'branch-a',
  activity_name: 'Gym',
  fee: 90,
  nationality: 'Egyptian',
  end_date: '2026-02-01',
  days_remaining: -12,
  // Historical renewal evidence must not override an actually expired end date.
  _renewed: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { ...mockAuth.user, id: `renewals-test-user-${Date.now()}-${Math.random()}` };
  mockNotificationsAPI.getExpiringSubscriptions.mockResolvedValue({
    data: [expiring, renewedFromServer, expiredEvidence],
  });
  mockBranchesAPI.getAll.mockResolvedValue({ data: [] });
  mockWhatsappAPI.getReminderTemplate.mockResolvedValue({ data: {} });
  mockWhatsappAPI.getLastRemindersFiltered.mockResolvedValue({ data: [] });
  mockWhatsappAPI.getLastReminders.mockResolvedValue({ data: [] });
});

const renderLoadedPage = async () => {
  const view = render(<RenewalsPage />);
  await screen.findByText('Expiring Member');
  return view;
};

test('requests renewed records and renders activity, a zero fee, and nationality on the card', async () => {
  await renderLoadedPage();

  expect(mockNotificationsAPI.getExpiringSubscriptions).toHaveBeenCalledWith({
    days: 7,
    include_renewed: true,
    branch_filter: 'branch-a',
  });
  expect(screen.getByText('Activity: Swimming')).toBeInTheDocument();
  expect(screen.getByTestId('renewal-price-member-expiring')).toHaveTextContent('Activity price:');
  expect(screen.getByTestId('renewal-price-member-expiring')).toHaveTextContent('0 SAR');
  expect(screen.getByTestId('renewal-nationality-member-expiring')).toHaveTextContent('Nationality: Saudi');
});

test('server _renewed entries appear only under Renewed, including after a remount', async () => {
  const first = await renderLoadedPage();

  expect(screen.queryByText('Invoice Renewed Member')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Renewed ✓ (1)' }));
  expect(await screen.findByText('Invoice Renewed Member')).toBeInTheDocument();
  expect(screen.queryByText('Expiring Member')).not.toBeInTheDocument();

  first.unmount();
  const second = render(<RenewalsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Renewed ✓ (1)' }));
  expect(await screen.findByText('Invoice Renewed Member')).toBeInTheDocument();
  expect(screen.queryByText('Expiring Member')).not.toBeInTheDocument();
  await waitFor(() => expect(mockNotificationsAPI.getExpiringSubscriptions).toHaveBeenCalledTimes(2));
  second.unmount();
});

test('expired date evidence remains in Expired even when the server marks it _renewed', async () => {
  await renderLoadedPage();

  fireEvent.click(screen.getByRole('button', { name: 'Expired (1)' }));
  expect(await screen.findByText('Expired Evidence Member')).toBeInTheDocument();
  expect(screen.getByText('Expired 12 days ago')).toBeInTheDocument();
  expect(screen.queryByText('Invoice Renewed Member')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Renewed ✓ (1)' }));
  expect(await screen.findByText('Invoice Renewed Member')).toBeInTheDocument();
  expect(screen.queryByText('Expired Evidence Member')).not.toBeInTheDocument();
});