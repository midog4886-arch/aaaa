import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockApi = {
  dayExtensions: {
    getClosures: jest.fn(),
    getLogs: jest.fn(),
    getAvailableTimes: jest.fn(),
    applyExtension: jest.fn(),
  },
};
const mockMembersAPI = { getAll: jest.fn() };
const mockBranchesAPI = { getAll: jest.fn() };
const mockActivitiesAPI = { getAll: jest.fn() };
const mockWhatsappAPI = {
  listBranchCloudJobs: jest.fn(),
  enqueueClosureNotices: jest.fn(),
  getBranchCloudJob: jest.fn(),
  cancelBranchCloudJob: jest.fn(),
};

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: mockApi,
  membersAPI: mockMembersAPI,
  branchesAPI: mockBranchesAPI,
  activitiesAPI: mockActivitiesAPI,
  whatsappAPI: mockWhatsappAPI,
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    selectedBranchId: 'branch-a',
    isAdmin: true,
    user: { is_admin: true, permissions: ['member-phones'] },
  }),
}));

jest.mock('../../components/Layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../components/ui/dialog', () => ({
  Dialog: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../utils/whatsapp', () => ({
  whatsappChatUrl: jest.fn((phone, text) => {
    const normalized = phone === '0501234567' ? '966501234567' : phone;
    return `https://wa.me/${normalized}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const closure = {
  id: 'closure-1',
  title_ar: 'إغلاق',
  title_en: 'Holiday',
  start_date: '2026-01-01',
  end_date: '2026-01-02',
  days: 2,
  applied: false,
};

const previewMembers = [
  {
    member_id: 'member-1',
    name: 'Sara',
    phone: '0501234567',
    details: [{
      activity: 'Swimming',
      missed_sessions: 3,
      old_end: '2026-02-01',
      new_end: '2026-02-08',
    }],
  },
  {
    member_id: 'member-2',
    name: 'Excluded',
    phone: '0502222222',
    details: [{
      activity: 'Football',
      missed_sessions: 2,
      old_end: '2026-02-03',
      new_end: '2026-02-10',
    }],
  },
  {
    member_id: 'member-3',
    name: 'Invalid',
    phone: '123',
    details: [{
      activity: 'Tennis',
      missed_sessions: 1,
      old_end: '2026-02-04',
      new_end: '2026-02-05',
    }],
  },
  {
    member_id: 'member-4',
    name: 'Missing phone',
    phone: '',
    details: [{
      activity: 'Gym',
      missed_sessions: 1,
      old_end: '2026-02-04',
      new_end: '2026-02-05',
    }],
  },
];

const preview = {
  extended_count: previewMembers.length,
  extended_members: previewMembers,
  skipped_count: 0,
  skipped_members: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.dayExtensions.getClosures.mockResolvedValue({ data: [closure] });
  mockApi.dayExtensions.getLogs.mockResolvedValue({ data: [] });
  mockApi.dayExtensions.getAvailableTimes.mockResolvedValue({ data: [] });
  mockMembersAPI.getAll.mockResolvedValue({ data: [] });
  mockBranchesAPI.getAll.mockResolvedValue({ data: [] });
  mockActivitiesAPI.getAll.mockResolvedValue({ data: [] });
  mockApi.dayExtensions.applyExtension.mockImplementation(({ dry_run }) => (
    Promise.resolve({ data: dry_run ? preview : { extended_count: 1 } })
  ));
  window.confirm = jest.fn(() => true);
});

const DayExtensionsPage = require('../DayExtensionsPage').default;

const openManualPreview = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  await user.click(await screen.findByRole('button', { name: /Preview & WhatsApp/i }));
  await screen.findByTestId('closure-whatsapp-mode');
  await user.click(screen.getByRole('button', { name: /Open chats manually/i }));
  return user;
};

test('manual mode opens one personalized wa.me chat without queueing', async () => {
  await openManualPreview();

  const link = await screen.findByTestId('manual-whatsapp-member-1');
  expect(link).toHaveAttribute('href', expect.stringContaining('wa.me/966501234567'));
  const decodedHref = decodeURIComponent(link.getAttribute('href'));
  expect(decodedHref).toContain('Sara');
  expect(decodedHref).toContain('3');
  expect(decodedHref).toContain('2026-02-01');
  expect(decodedHref).toContain('2026-02-08');
  expect(decodedHref).toContain('Swimming');
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
});

test('manual mode preserves exclusions and disables missing or invalid phones', async () => {
  const user = await openManualPreview();

  await user.click(screen.getAllByTitle('Exclude')[1]);
  expect(screen.queryByTestId('manual-whatsapp-member-2')).not.toBeInTheDocument();
  expect(screen.getByTestId('manual-whatsapp-member-1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Invalid phone number' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'No phone number' })).toBeDisabled();
});

test('manual mode does not couple opening chats to applying the extension', async () => {
  const user = await openManualPreview();

  await user.click(screen.getByRole('button', { name: /Confirm Extension/i }));
  await waitFor(() => expect(mockApi.dayExtensions.applyExtension).toHaveBeenLastCalledWith({
    closure_id: 'closure-1',
    days: 2,
    branch_id: 'branch-a',
    dry_run: false,
    excluded_member_ids: [],
  }));
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
});