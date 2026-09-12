import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockNavigate = jest.fn();

jest.mock('../../services/api', () => ({
  whatsappAPI: {
    getStatus: jest.fn(),
    getSettings: jest.fn(),
    getLogs: jest.fn(),
    getTargetCount: jest.fn(),
    getCloudInboxConversations: jest.fn(),
    getCloudInboxThread: jest.fn(),
    getCloudInboxMedia: jest.fn(),
    replyCloudInbox: jest.fn(),
    sendCloudInboxMedia: jest.fn(),
  },
  branchesAPI: { getAll: jest.fn() },
  membersAPI: {
    lookupByPhone: jest.fn(),
  },
  activitiesAPI: {},
  messagesAPI: {},
  pushNotificationsAPI: {},
  levelsAPI: {},
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'ar' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { is_admin: true },
    selectedBranchId: 'branch-a',
  }),
}));

jest.mock('../../components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const { branchesAPI, membersAPI, whatsappAPI } = require('../../services/api');
const { toast } = require('sonner');

const conversation = {
  id: 'branch-a:966501234567',
  branch_id: 'branch-a',
  provider: 'waha',
  phone: '966501234567',
  contact_name: 'أحمد',
  branch_name: 'الفرع الرئيسي',
  last_message: 'صورة',
  last_message_at: '2026-01-01T12:00:00Z',
  unread_count: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  membersAPI.lookupByPhone.mockResolvedValue({ data: { members: [] } });
  whatsappAPI.getStatus.mockResolvedValue({
    data: { connected: true, qr: null, connecting: false },
  });
  whatsappAPI.getSettings.mockResolvedValue({
    data: {
      enabled: true,
      days_before: 3,
      days_before_2: 1,
      reminder_2_enabled: true,
      offsets: [],
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
  whatsappAPI.getTargetCount.mockResolvedValue({ data: { count: 0 } });
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [conversation], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [] },
  });
  whatsappAPI.getCloudInboxMedia.mockResolvedValue({
    data: new Blob(['image'], { type: 'image/png' }),
  });
  branchesAPI.getAll.mockResolvedValue({ data: [] });
});

async function renderOpenCloudThread() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);
  await user.click(screen.getByRole('button', { name: /شات واتساب/ }));
  await screen.findByText('أحمد');
  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  await screen.findByTestId('input-cloud-image');
  return user;
}

async function renderCloudInbox() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);
  await user.click(screen.getByRole('button', { name: /شات واتساب/ }));
  await screen.findByText('أحمد');
  return user;
}

test('does not refetch the inbox or branches when opening a read-only thread', async () => {
  await renderOpenCloudThread();

  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(1);
  expect(branchesAPI.getAll).toHaveBeenCalledTimes(1);
  expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(1);
});

test('loads unread conversations for the selected branch and keeps the branch selector visible', async () => {
  const unreadConversation = {
    ...conversation,
    unread_count: 2,
  };
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [unreadConversation], unread_count: 2 },
    });
  const user = await renderCloudInbox();

  await user.click(screen.getByRole('button', { name: /غير مقروءة/ }));

  await screen.findByText('أحمد');
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenNthCalledWith(1, 'branch-a', false);
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith('branch-a', true);
  expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  expect(screen.getByRole('combobox')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /الفرع الحالي/ }));
  await waitFor(() => expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith('branch-a', false));
});

test('opening an unread thread refreshes the selected branch unread list and count after it is marked read', async () => {
  const unreadConversation = {
    ...conversation,
    unread_count: 2,
  };
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [unreadConversation], unread_count: 2 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [], unread_count: 0 },
    });
  const user = await renderCloudInbox();
  await user.click(screen.getByRole('button', { name: /غير مقروءة/ }));
  await screen.findByText('أحمد');
  await user.click(screen.getByRole('button', { name: /أحمد/ }));

  await waitFor(() => expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(3));
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith('branch-a', true);
  await user.click(screen.getByRole('button', { name: /رجوع/ }));
  expect(await screen.findByText('لا توجد محادثات واتساب واردة بعد')).toBeInTheDocument();
});

test('uses the backend match flag for orange cloud phone styling without a render lookup', async () => {
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: {
      conversations: [{ ...conversation, member_phone_match: true }],
      unread_count: 0,
    },
  });
  await renderCloudInbox();

  const phone = screen.getByTestId('cloud-conversation-phone');
  expect(phone).toHaveClass('text-orange-600');
  expect(phone).toHaveClass('hover:text-orange-700');
  expect(membersAPI.lookupByPhone).not.toHaveBeenCalled();
});

test('keeps unknown cloud phones neutral, including on hover', async () => {
  await renderCloudInbox();

  const phone = screen.getByTestId('cloud-conversation-phone');
  expect(phone).toHaveClass('text-muted-foreground');
  expect(phone).not.toHaveClass('text-orange-600');
  expect(phone).not.toHaveClass('hover:text-orange-700');
});

function validPngFile() {
  return new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])],
    'offer.png',
    { type: 'image/png' },
  );
}

test('clears text after successful reply and preserves it on failure', async () => {
  whatsappAPI.replyCloudInbox.mockResolvedValueOnce({ data: { success: true } });
  const user = await renderOpenCloudThread();
  let input = screen.getByPlaceholderText(/اكتب الرد/);
  fireEvent.change(input, { target: { value: 'موعد التدريب' } });
  await user.click(screen.getByRole('button', { name: 'إرسال الرد' }));
  await waitFor(() => expect(screen.getByPlaceholderText(/اكتب الرد/)).toHaveValue(''));
  expect(whatsappAPI.replyCloudInbox).toHaveBeenCalledWith(conversation.id, 'موعد التدريب');
  whatsappAPI.replyCloudInbox.mockRejectedValueOnce({ response: { data: { detail: 'تعذر الإرسال' } } });
  input = screen.getByPlaceholderText(/اكتب الرد/);
  fireEvent.change(input, { target: { value: 'احتفظ بهذه الرسالة' } });
  await user.click(screen.getByRole('button', { name: 'إرسال الرد' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('تعذر الإرسال'));
  expect(screen.getByPlaceholderText(/اكتب الرد/)).toHaveValue('احتفظ بهذه الرسالة');
});

test('selects one image, previews its caption, sends multipart data, and refreshes', async () => {
  whatsappAPI.sendCloudInboxMedia.mockResolvedValue({
    data: { success: true, used_template: false },
  });
  const user = await renderOpenCloudThread();
  const file = validPngFile();

  fireEvent.change(screen.getByTestId('input-cloud-image'), {
    target: { files: [file] },
  });
  expect((await screen.findAllByText('offer.png')).length).toBeGreaterThan(0);
  const caption = await screen.findByPlaceholderText('تعليق اختياري للصورة…');
  await user.type(caption, 'عرض خاص');
  await user.click(screen.getByTestId('button-send-cloud-image'));

  await waitFor(() => expect(whatsappAPI.sendCloudInboxMedia).toHaveBeenCalledTimes(1));
  const [conversationId, formData] = whatsappAPI.sendCloudInboxMedia.mock.calls[0];
  expect(conversationId).toBe(conversation.id);
  expect(formData.get('attachments')).toBe(file);
  expect(formData.get('caption')).toBe('عرض خاص');
  await waitFor(() => expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(2));
  expect(toast.success).toHaveBeenCalled();
});

test('renders structured backend send errors as safe toast text and does not retry', async () => {
  whatsappAPI.sendCloudInboxMedia.mockRejectedValue({
    response: {
      data: {
        detail: [{ msg: 'delivery outcome is unknown; no automatic retry was attempted' }],
      },
    },
  });
  const user = await renderOpenCloudThread();

  fireEvent.change(screen.getByTestId('input-cloud-image'), {
    target: { files: [validPngFile()] },
  });
  await screen.findByTestId('button-send-cloud-image');
  await user.click(screen.getByTestId('button-send-cloud-image'));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
    'delivery outcome is unknown; no automatic retry was attempted',
  ));
  expect(whatsappAPI.sendCloudInboxMedia).toHaveBeenCalledTimes(1);
});

test('looks up a single cloud phone and opens the member focus deeplink', async () => {
  membersAPI.lookupByPhone.mockResolvedValue({
    data: {
      members: [{
        id: 'member-saudi-a',
        name: 'أحمد عضو',
        branch_id: 'branch-a',
        branch_name: 'الفرع الرئيسي',
      }],
    },
  });
  const user = await renderCloudInbox();

  await user.click(screen.getByText(conversation.phone));

  await waitFor(() => expect(membersAPI.lookupByPhone).toHaveBeenCalledWith(
    conversation.phone,
  ));
  expect(mockNavigate).toHaveBeenCalledWith('/admin/members?focus=member-saudi-a');
  expect(whatsappAPI.getCloudInboxThread).not.toHaveBeenCalled();
});

test('shows an explicit chooser when a shared cloud phone has multiple members', async () => {
  membersAPI.lookupByPhone.mockResolvedValue({
    data: {
      members: [
        {
          id: 'member-shared-a',
          name: 'عضو الفرع الأول',
          branch_id: 'branch-a',
          branch_name: 'الفرع الأول',
        },
        {
          id: 'member-shared-b',
          name: 'عضو الفرع الثاني',
          branch_id: 'branch-b',
          branch_name: 'الفرع الثاني',
        },
      ],
    },
  });
  const user = await renderCloudInbox();

  await user.click(screen.getByText(conversation.phone));

  expect(await screen.findByText('اختيار ملف العضو')).toBeInTheDocument();
  expect(screen.getByTestId('phone-member-choice-member-shared-a')).toBeInTheDocument();
  expect(screen.getByTestId('phone-member-choice-member-shared-b')).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();

  await user.click(screen.getByTestId('phone-member-choice-member-shared-b'));
  expect(mockNavigate).toHaveBeenCalledWith('/admin/members?focus=member-shared-b');
});

test('shows a clear toast and does not navigate when the cloud phone has no member', async () => {
  const user = await renderCloudInbox();

  await user.click(screen.getByText(conversation.phone));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
    'لم يتم العثور على عضو بهذا الرقم',
  ));
  expect(mockNavigate).not.toHaveBeenCalled();
});