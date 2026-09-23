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
let mockLanguage = 'en';
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
  useLanguage: () => ({ language: mockLanguage }),
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
  whatsappChatUrl: jest.fn(() => ''),
}));
const mockToast = { error: jest.fn(), success: jest.fn() };
jest.mock('sonner', () => ({ toast: mockToast }));

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
    branch_id: 'branch-a',
    branch_name: 'North branch',
    activity_changes: [{
      activity_id: 'swim',
      activity_name: 'Swimming',
      old_end_date: '2026-02-01',
      new_end_date: '2026-02-08',
      missed_sessions: 3,
    }],
    deferred_periods: [{
      activity_id: 'swim',
      activity_name: 'Swimming',
      invoice_id: 'INV-22',
      old_start_date: '2026-02-02',
      old_end_date: '2026-03-01',
      new_start_date: '2026-02-09',
      new_end_date: '2026-03-08',
    }],
    warnings: [],
  },
  {
    member_id: 'member-2',
    name: 'Omar',
    branch_id: 'branch-b',
    branch_name: 'South branch',
    activity_changes: [{
      activity_id: 'gym',
      activity_name: 'Gym',
      old_end_date: '2026-02-05',
      new_end_date: '2026-02-07',
      missed_sessions: 2,
    }],
    deferred_periods: [],
    warnings: ['Training schedule is unknown'],
  },
];

const preview = (token = 'preview-token-1') => ({
  preview_token: token,
  extended_count: previewMembers.length,
  extended_members: previewMembers,
  skipped_count: 0,
  skipped_members: [],
});

beforeEach(() => {
  mockLanguage = 'en';
  jest.clearAllMocks();
  mockApi.dayExtensions.getClosures.mockResolvedValue({ data: [closure] });
  mockApi.dayExtensions.getLogs.mockResolvedValue({ data: [] });
  mockApi.dayExtensions.getAvailableTimes.mockResolvedValue({ data: [] });
  mockMembersAPI.getAll.mockResolvedValue({ data: [] });
  mockBranchesAPI.getAll.mockResolvedValue({
    data: [
      { id: 'branch-a', name_ar: 'North branch' },
      { id: 'branch-b', name_ar: 'South branch' },
    ],
  });
  mockActivitiesAPI.getAll.mockResolvedValue({ data: [] });
  mockWhatsappAPI.listBranchCloudJobs.mockResolvedValue({ data: [] });
  mockApi.dayExtensions.applyExtension.mockImplementation(payload => (
    Promise.resolve({ data: payload.dry_run ? preview('preview-token-1') : { extended_count: 2 } })
  ));
  window.confirm = jest.fn(() => true);
});

const DayExtensionsPage = require('../DayExtensionsPage').default;

test.each([
  ['en', 'skipped'], ['ar', 'skipped'], ['en', 'affected'], ['ar', 'affected'],
])('makes duplicate warnings and uncompensated count explicit (%s, %s)', async (language, location) => {
  mockLanguage = language;
  const ar = language === 'ar';
  const reason = 'Swimming: duplicate overlapping subscriptions; resolve activity duplicates before compensation';
  const response = {
    ...preview(),
    extended_members: previewMembers.map((m, i) => ({
      ...m, warnings: location === 'affected' && i === 0 ? [reason] : [],
    })),
    skipped_count: 1,
    skipped_members: [{ member_id: 'skipped-1', name: 'Skipped member', reason: location === 'skipped' ? reason : 'No overlap' }],
  };
  mockApi.dayExtensions.applyExtension.mockResolvedValue({ data: response });
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  await user.click((await screen.findAllByRole('button', { name: ar ? 'معاينة وإرسال واتساب' : /Preview & WhatsApp/i }))[0]);
  const warning = await screen.findByTestId('duplicate-subscription-warning');
  expect(warning).toHaveTextContent(ar ? 'تتطلب التصحيح قبل التعويض' : 'require correction before compensation');
  expect(warning).toHaveTextContent(ar ? 'لن يتم دمجها تلقائياً' : 'will not be merged automatically');
  if (location === 'skipped') {
    await user.click(screen.getByRole('button', { name: ar ? /المستثنون تلقائياً/ : /Auto-skipped/ }));
  }
  expect(screen.getByText(ar
    ? /Swimming: سجلات نشاط مكررة ومتداخلة/
    : /Swimming: Duplicate overlapping activity records/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: ar ? 'تأكيد الترحيل' : /Confirm Extension/i }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(ar
    ? 'لن يتم تعويض 1 من المشتركين المستثنين'
    : '1 skipped members will not be compensated in this operation'));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(ar
    ? 'لن تُعوّض سجلات الأنشطة المكررة قبل تصحيحها'
    : 'Duplicate activity records will not be compensated until corrected'));
  expect(await screen.findByText(ar
    ? 'مشتركون لم يتم تعويضهم في هذه العملية (1)'
    : 'Members not compensated in this operation (1)')).toBeInTheDocument();
  if (location === 'skipped') {
    expect(screen.getByText(ar
      ? /Swimming: سجلات نشاط مكررة ومتداخلة/
      : /Swimming: Duplicate overlapping activity records/)).toBeInTheDocument();
  }
});

test('groups closure impacts by branch and shows activity and postponed prepaid dates', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);

  await user.click((await screen.findAllByRole('button', { name: /Preview & WhatsApp/i }))[0]);

  expect(await screen.findByText(/Branch: North branch/)).toBeInTheDocument();
  expect(screen.getByText(/Branch: South branch/)).toBeInTheDocument();
  expect(screen.getAllByText(/Subscription end:/)[0]).toHaveTextContent('2026-02-01 → 2026-02-08');
  expect(screen.getByText(/Prepaid period postponed/)).toBeInTheDocument();
  expect(screen.getByText(/Start:/)).toHaveTextContent('2026-02-02 → 2026-02-09');
  expect(screen.getByText(/End:/)).toHaveTextContent('2026-03-01 → 2026-03-08');
  expect(screen.getByText(/Invoices and paid totals remain unchanged/)).toBeInTheDocument();
  expect(screen.getByText(/Unknown schedule warning:/)).toBeInTheDocument();

  expect(mockApi.dayExtensions.applyExtension).toHaveBeenCalledTimes(1);
  expect(mockApi.dayExtensions.applyExtension).toHaveBeenCalledWith({
    closure_id: 'closure-1',
    days: 2,
    branch_id: 'branch-a',
    dry_run: true,
    excluded_member_ids: [],
  });
});

test('refreshes after exclusions and applies only with the latest exact preview token', async () => {
  let previewNumber = 0;
  mockApi.dayExtensions.applyExtension.mockImplementation(payload => {
    if (payload.dry_run) {
      previewNumber += 1;
      return Promise.resolve({ data: preview(`preview-token-${previewNumber}`) });
    }
    return Promise.resolve({ data: { extended_count: 1 } });
  });
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  await user.click((await screen.findAllByRole('button', { name: /Preview & WhatsApp/i }))[0]);
  await screen.findByText('Sara');

  await user.selectOptions(screen.getByLabelText('Branch included in preview'), 'branch-b');
  await waitFor(() => expect(mockApi.dayExtensions.applyExtension).toHaveBeenCalledWith({
    closure_id: 'closure-1',
    days: 2,
    branch_id: 'branch-b',
    dry_run: true,
    excluded_member_ids: [],
  }));
  await user.click(screen.getAllByTitle('Exclude')[0]);
  // The debounce window is not permission to confirm the previous token.
  expect(screen.getByRole('button', { name: /Confirm Extension/i })).toBeDisabled();
  await waitFor(() => expect(mockApi.dayExtensions.applyExtension).toHaveBeenCalledWith({
    closure_id: 'closure-1',
    days: 2,
    branch_id: 'branch-b',
    dry_run: true,
    excluded_member_ids: ['member-1'],
  }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Confirm Extension/i })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /Confirm Extension/i }));

  await waitFor(() => expect(mockApi.dayExtensions.applyExtension).toHaveBeenLastCalledWith({
    closure_id: 'closure-1',
    days: 2,
    branch_id: 'branch-b',
    dry_run: false,
    excluded_member_ids: ['member-1'],
    preview_token: 'preview-token-3',
  }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Invoices and paid totals will not change'));
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
});

test('refresh after 409 never applies without another reviewed confirmation', async () => {
  mockApi.dayExtensions.applyExtension.mockImplementation(payload => (
    payload.dry_run
      ? Promise.resolve({ data: preview('fresh-token') })
      : Promise.reject({ response: { status: 409 } })
  ));
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  await user.click((await screen.findAllByRole('button', { name: /Preview & WhatsApp/i }))[0]);
  await screen.findByText('Sara');
  await user.click(screen.getByRole('button', { name: /Confirm Extension/i }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: /Refresh preview/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Confirm Extension/i })).toBeEnabled());
  expect(mockApi.dayExtensions.applyExtension.mock.calls.filter(([p]) => !p.dry_run)).toHaveLength(1);
  expect(window.confirm).toHaveBeenCalledTimes(1);
});

test('409 stale preview is not reported as success and requires refresh before retry', async () => {
  mockApi.dayExtensions.applyExtension.mockImplementation(payload => {
    if (payload.dry_run) return Promise.resolve({ data: preview() });
    return Promise.reject({ response: { status: 409 } });
  });
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  await user.click((await screen.findAllByRole('button', { name: /Preview & WhatsApp/i }))[0]);
  await screen.findByText('Sara');
  await user.click(screen.getByRole('button', { name: /Confirm Extension/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('preview is no longer valid');
  expect(screen.getByRole('button', { name: /Confirm Extension/i })).toBeDisabled();
  expect(mockToast.success).not.toHaveBeenCalled();
  expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('Refresh and review'));
  expect(mockWhatsappAPI.enqueueClosureNotices).not.toHaveBeenCalled();
});

test.each([
  ['Compensation uniqueness conflict; review duplicate subscriptions or existing compensation', 'Compensation uniqueness conflict. Review duplicate subscriptions'],
  ['Concurrent write conflict; refresh and review before confirming again', 'Another write conflicted with saving'],
  ['Transaction was aborted; no extension was committed; refresh and review before confirming again', 'The transaction was aborted and no extension was committed'],
  ['Level subscription changed; preview again', 'A level subscription could not be matched'],
  ['Member subscriptions changed; preview again', 'Member subscriptions could not be matched'],
  ['Closure was already applied', 'This closure was already applied'],
  ['Subscriptions changed concurrently; preview again', 'A conflict occurred while saving'],
  ['Unexpected distinct conflict', 'Application conflict: Unexpected distinct conflict'],
])('shows the actual 409 reason: %s', async (detail, expected) => {
  mockApi.dayExtensions.applyExtension.mockImplementation(payload => (
    payload.dry_run
      ? Promise.resolve({ data: preview() })
      : Promise.reject({ response: { status: 409, data: { detail } } })
  ));
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<DayExtensionsPage />);
  await user.click((await screen.findAllByRole('button', { name: /Preview & WhatsApp/i }))[0]);
  await screen.findByText('Sara');
  await user.click(screen.getByRole('button', { name: /Confirm Extension/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining(expected));
  expect(screen.getByRole('button', { name: /Confirm Extension/i })).toBeDisabled();
  expect(mockToast.success).not.toHaveBeenCalled();
});