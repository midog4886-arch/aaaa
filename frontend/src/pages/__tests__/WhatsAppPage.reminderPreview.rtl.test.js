import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../../services/api', () => ({
  whatsappAPI: {
    getStatus: jest.fn(),
    getSettings: jest.fn(),
    getLogs: jest.fn(),
    getTargetCount: jest.fn(),
    getCloudInboxConversations: jest.fn(),
    previewReminders: jest.fn(),
    sendNow: jest.fn(),
  },
  branchesAPI: { getAll: jest.fn() },
  membersAPI: {},
  activitiesAPI: {},
  messagesAPI: {},
  pushNotificationsAPI: {},
  levelsAPI: {},
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'ar' }),
}));

let mockSelectedBranchId = 'branch-a';
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { is_admin: true },
    selectedBranchId: mockSelectedBranchId,
  }),
}));

jest.mock('../../components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const { branchesAPI, whatsappAPI } = require('../../services/api');

const preview = {
  preview_id: 'preview-1',
  expires_at: '2026-06-01T12:00:00Z',
  recipients: [{
    member_id: 'member-1',
    member_name: 'سارة',
    activity_id: 'activity-1',
    activity_name: 'السباحة',
    end_date: '2026-06-07',
    attended_sessions: 8,
    branch_name: 'الفرع الرئيسي',
  }],
  member_count: 1,
  channels: ['whatsapp', 'push', 'portal'],
  count: 3,
};

const deferred = () => {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedBranchId = 'branch-a';
  whatsappAPI.getStatus.mockResolvedValue({ data: { connected: true, qr: null, connecting: false } });
  whatsappAPI.getSettings.mockResolvedValue({
    data: {
      enabled: true,
      days_before: 3,
      days_before_2: 1,
      reminder_2_enabled: true,
      offsets: [{ days: 7, enabled: true }, { days: 3, enabled: true }],
      message_template: '',
      templates: {},
      manual_reminder_template: '',
      manual_reminder_expired_template: '',
      welcome_template: '',
      send_hour: 9,
      push_enabled: true,
      portal_enabled: true,
      push_title_template: '',
      push_body_template: '',
      admin_alert_enabled: false,
      admin_alert_phone: '',
    },
  });
  whatsappAPI.getLogs.mockResolvedValue({ data: [] });
  whatsappAPI.getTargetCount.mockResolvedValue({ data: { count: 99 } });
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({ data: { conversations: [], unread_count: 0 } });
  branchesAPI.getAll.mockResolvedValue({ data: [] });
  whatsappAPI.previewReminders.mockResolvedValue({ data: preview });
  whatsappAPI.sendNow.mockResolvedValue({ data: { accepted: true } });
});

test('يعرض معاينة RTL الموثوقة ويرسل معرّفها بعد التأكيد الصريح', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);

  await user.click(screen.getByRole('button', { name: 'الإعدادات' }));
  expect(screen.getByText('إعدادات التذكيرات التلقائية')).toBeInTheDocument();
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'إرسال التذكيرات الآن' }));

  expect(await screen.findByText('سارة')).toBeInTheDocument();
  expect(whatsappAPI.previewReminders).toHaveBeenCalledWith({ branch_id: 'branch-a' });
  const dialog = screen.getByTestId('reminder-preview-dialog');
  expect(dialog).toHaveAttribute('dir', 'rtl');
  expect(screen.getByText('السباحة')).toBeInTheDocument();
  expect(screen.getByText('الفرع الرئيسي')).toBeInTheDocument();
  expect(screen.getByText('2026-06-07')).toBeInTheDocument();
  expect(screen.getByText('8')).toBeInTheDocument();
  expect(screen.getByText('3 تذكير مستهدف')).toBeInTheDocument();
  expect(within(dialog).getByText('واتساب')).toBeInTheDocument();
  expect(within(dialog).getByText('إشعار Push')).toBeInTheDocument();
  expect(within(dialog).getByText('بوابة العضو')).toBeInTheDocument();

  await user.click(screen.getByTestId('confirm-reminder-send'));
  await waitFor(() => expect(whatsappAPI.sendNow).toHaveBeenCalledWith({
    preview_id: 'preview-1',
    confirm: true,
  }));
  expect(screen.queryByTestId('reminder-preview-dialog')).not.toBeInTheDocument();
});

test('يغلق المعاينة عند تغيير الفرع ويتجاهل استجابة الفرع القديمة', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const oldBranchRequest = deferred();
  whatsappAPI.previewReminders
    .mockReturnValueOnce(oldBranchRequest.promise)
    .mockResolvedValueOnce({ data: { ...preview, preview_id: 'preview-2' } });

  const WhatsAppPage = require('../WhatsAppPage').default;
  const view = render(<WhatsAppPage />);
  await user.click(screen.getByRole('button', { name: 'الإعدادات' }));
  await user.click(screen.getByRole('button', { name: 'إرسال التذكيرات الآن' }));
  expect(await screen.findByText('جاري إعداد المعاينة...')).toBeInTheDocument();

  mockSelectedBranchId = 'branch-b';
  view.rerender(<WhatsAppPage />);
  await waitFor(() => expect(screen.queryByTestId('reminder-preview-dialog')).not.toBeInTheDocument());

  await act(async () => {
    oldBranchRequest.resolve({ data: { ...preview, member_name: 'بيانات قديمة' } });
  });
  expect(screen.queryByText('بيانات قديمة')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'إرسال التذكيرات الآن' }));
  await screen.findByText('سارة');
  expect(whatsappAPI.previewReminders).toHaveBeenLastCalledWith({ branch_id: 'branch-b' });
});