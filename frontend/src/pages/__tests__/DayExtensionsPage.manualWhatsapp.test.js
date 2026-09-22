import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
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
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

const closure = {
  id: 'closure-1',
  title_ar: 'إغلاق',
  title_en: 'Holiday',
  start_date: '2026-01-01',
  end_date: '2026-01-02',
  days: 2,
  applied: false,
  notice_summary: { jobs: [], state: 'not_queued', scope_branch_ids: [] },
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
  preview_token: 'preview-token-1',
  extended_count: previewMembers.length,
  extended_members: previewMembers,
  skipped_count: 0,
  skipped_members: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
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

test('manual reopen remains opened-only across page remount and requires confirmation', async () => {
  await openManualPreview();
  fireEvent.click(screen.getByTestId('manual-whatsapp-member-1'));
  expect(screen.getByTestId('manual-whatsapp-member-1')).toHaveTextContent('Opened only');
  cleanup();
  await openManualPreview();
  expect(screen.getByTestId('manual-whatsapp-member-1')).toHaveTextContent('Opened only');
  window.confirm.mockReturnValue(false);
  expect(fireEvent.click(screen.getByTestId('manual-whatsapp-member-1'))).toBe(false);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('sending is unverified'));
});

test('automatic double click queues only once while the request is in flight', async () => {
  mockWhatsappAPI.enqueueClosureNotices.mockImplementation(() => new Promise(() => {}));
  render(<DayExtensionsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Preview & WhatsApp/i }));
  const send = await screen.findByRole('button', { name: /Send WhatsApp to All/i });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  fireEvent.click(send);
  expect(mockWhatsappAPI.enqueueClosureNotices).toHaveBeenCalledTimes(1);
});

test('closures paint without auxiliary reads or waiting for notice evidence; unknown evidence blocks sends', async () => {
  mockApi.dayExtensions.getClosures.mockImplementation(params => (
    params?.summary_only ? new Promise(() => {}) : Promise.resolve({ data: [{
      ...closure, notice_summary: { state: 'loading', jobs: [] }
    }] })
  ));
  render(<DayExtensionsPage />);
  const previewButton = await screen.findByRole('button', { name: /Preview & WhatsApp/i });
  expect(mockMembersAPI.getAll).not.toHaveBeenCalled();
  expect(mockActivitiesAPI.getAll).not.toHaveBeenCalled();
  expect(mockApi.dayExtensions.getLogs).not.toHaveBeenCalled();
  expect(mockApi.dayExtensions.getAvailableTimes).not.toHaveBeenCalled();
  expect(screen.getByTestId('closure-notice-status-closure-1')).toHaveTextContent('Checking message status');
  fireEvent.click(previewButton);
  expect(await screen.findByRole('button', { name: /Send WhatsApp to All/i })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Open chats manually/i }));
  expect(screen.queryByTestId('manual-whatsapp-member-1')).not.toBeInTheDocument();
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
});

test('manual member picker is fetched only when opened, without photos or full member documents', async () => {
  render(<DayExtensionsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /^Manual Extension$/i }));
  await waitFor(() => expect(mockMembersAPI.getAll).toHaveBeenCalledWith({
    exclude_photo: true, picker_only: true
  }));
  expect(mockApi.dayExtensions.getLogs).not.toHaveBeenCalled();
  expect(mockApi.dayExtensions.getAvailableTimes).not.toHaveBeenCalled();
});

test.each(['sent', 'failed', 'cancelled', 'unknown', 'pending'])('existing %s branch job is visible immediately and locks automatic and manual repeat', async (state) => {
  const job = { id: 'j1', branch_id: 'branch-a', idempotency_key: 'closure_notice_closure-1',
    status: 'completed', sent: 1, recipient_states: { 'member-1': state } };
  mockApi.dayExtensions.getClosures.mockResolvedValue({ data: [{
    ...closure, branch_id: 'branch-a', branch_name: 'Branch A',
    notice_summary: { jobs: [job], sent: 1, state: 'completed', scope_branch_ids: ['branch-a'] },
  }] });
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  expect(await screen.findByText('Branch A')).toBeInTheDocument();
  expect(screen.getByTestId('closure-notice-status-closure-1')).toHaveTextContent('Accepted, not confirmed delivered');
  await user.click(screen.getByRole('button', { name: /Preview & WhatsApp/i }));
  expect(await screen.findByRole('button', { name: /Send WhatsApp to All/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /Open chats manually/i }));
  expect(screen.queryByTestId('manual-whatsapp-member-1')).not.toBeInTheDocument();
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
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
    preview_token: 'preview-token-1',
  }));
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
});