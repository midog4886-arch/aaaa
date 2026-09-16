import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
let objectUrlCounter = 0;

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

const deferred = () => {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  objectUrlCounter = 0;
  URL.createObjectURL = jest.fn(() => `blob:cloud-media-${++objectUrlCounter}`);
  URL.revokeObjectURL = jest.fn();
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

test('refreshes the current branch inbox after opening a read-only thread and preserves it', async () => {
  await renderOpenCloudThread();

  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(2);
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenNthCalledWith(2, 'branch-a', false);
  expect(branchesAPI.getAll).toHaveBeenCalledTimes(1);
  expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(1);
  expect(screen.getByPlaceholderText(/اكتب الرد/)).toBeInTheDocument();
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

test('loads the independent needs-reply filter with the optional API argument and its count', async () => {
  const needsReplyConversation = {
    ...conversation,
    needs_reply: true,
  };
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0, needs_reply_count: 1 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [needsReplyConversation], unread_count: 0, needs_reply_count: 1 },
    });
  const user = await renderCloudInbox();

  expect(screen.getByRole('button', { name: /تحتاج ردًا.*1/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /تحتاج ردًا/ }));

  await waitFor(() => expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith(
    'branch-a',
    false,
    true,
  ));
  expect(screen.getAllByText(/تحتاج ردًا/).length).toBeGreaterThan(1);
});

test('marking an unread thread read retains the needs-reply count and filter', async () => {
  const unreadNeedsReplyConversation = {
    ...conversation,
    unread_count: 2,
    needs_reply: true,
  };
  const needsReplyConversation = {
    ...conversation,
    needs_reply: true,
  };
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0, needs_reply_count: 1 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [unreadNeedsReplyConversation], unread_count: 2, needs_reply_count: 1 },
    })
    // Authoritative post-open refresh: reading does not clear needs_reply.
    .mockResolvedValueOnce({
      data: { conversations: [], unread_count: 0, needs_reply_count: 1 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [], unread_count: 0, needs_reply_count: 1 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [needsReplyConversation], unread_count: 0, needs_reply_count: 1 },
    });
  whatsappAPI.getCloudInboxThread.mockResolvedValueOnce({
    data: { conversation: unreadNeedsReplyConversation, messages: [] },
  });
  const user = await renderCloudInbox();

  await user.click(screen.getByRole('button', { name: /غير مقروءة/ }));
  await screen.findByText('أحمد');
  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  await waitFor(() => expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(3));
  await user.click(screen.getByRole('button', { name: /رجوع/ }));

  expect(await screen.findByRole('button', { name: /تحتاج ردًا.*1/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /تحتاج ردًا/ }));
  await waitFor(() => expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith(
    'branch-a',
    false,
    true,
  ));
  expect(screen.getByText('أحمد')).toBeInTheDocument();
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

test('keeps an unread conversation until the authoritative refresh removes it', async () => {
  const unreadConversation = {
    ...conversation,
    unread_count: 2,
  };
  const unreadRefresh = deferred();
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0 },
    })
    .mockResolvedValueOnce({
      data: { conversations: [unreadConversation], unread_count: 2 },
    })
    .mockReturnValueOnce(unreadRefresh.promise);
  whatsappAPI.getCloudInboxThread.mockResolvedValueOnce({
    data: { conversation: unreadConversation, messages: [] },
  });
  const user = await renderCloudInbox();

  await user.click(screen.getByRole('button', { name: /غير مقروءة/ }));
  await screen.findByText('أحمد');
  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  await screen.findByTestId('input-cloud-image');
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(3);

  await user.click(screen.getByRole('button', { name: /رجوع/ }));
  expect(screen.getByText('أحمد')).toBeInTheDocument();

  await act(async () => {
    unreadRefresh.resolve({
      data: { conversations: [], unread_count: 0 },
    });
  });
  expect(await screen.findByText('لا توجد محادثات واتساب واردة بعد')).toBeInTheDocument();
});

test('ignores an old branch inbox response after the branch changes again', async () => {
  branchesAPI.getAll.mockResolvedValue({
    data: [
      { id: 'branch-a', name: 'الفرع الرئيسي' },
      { id: 'branch-b', name: 'الفرع الثاني' },
    ],
  });
  const branchBRefresh = deferred();
  const branchBConversation = {
    ...conversation,
    id: 'branch-b:966501234568',
    branch_id: 'branch-b',
    branch_name: 'الفرع الثاني',
    contact_name: 'سارة',
  };
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0 },
    })
    .mockReturnValueOnce(branchBRefresh.promise)
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0 },
    });
  const user = await renderCloudInbox();

  await user.click(screen.getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: 'الفرع الثاني' }));
  await waitFor(() => expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(2));

  await user.click(screen.getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: 'الفرع الرئيسي' }));
  await screen.findByText('أحمد');
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(3);

  await act(async () => {
    branchBRefresh.resolve({
      data: { conversations: [branchBConversation], unread_count: 0 },
    });
  });
  expect(screen.queryByText('سارة')).not.toBeInTheDocument();
  expect(screen.getByText('أحمد')).toBeInTheDocument();
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

const inboundAttachment = overrides => ({
  id: 'incoming-media-1',
  media_id: 'provider-media-1',
  type: 'document',
  direction: 'inbound',
  status: 'received',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

test('uses the response PDF filename on an incoming document download link', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment()] },
  });
  whatsappAPI.getCloudInboxMedia.mockResolvedValue({
    data: new Blob(['pdf'], { type: 'application/pdf' }),
    headers: { 'content-disposition': 'attachment; filename="training-plan.pdf"' },
  });

  await renderOpenCloudThread();

  const link = await screen.findByRole('link', { name: 'تحميل الملف' });
  expect(link).toHaveAttribute('href', 'blob:cloud-media-1');
  expect(link).toHaveAttribute('download', 'training-plan.pdf');
});

test('shows a failed incoming attachment and retries only that attachment', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment({ file_name: 'receipt.pdf' })] },
  });
  whatsappAPI.getCloudInboxMedia
    .mockRejectedValueOnce(new Error('media unavailable'))
    .mockResolvedValueOnce({
      data: new Blob(['pdf'], { type: 'application/pdf' }),
    });
  const user = await renderOpenCloudThread();

  const retry = await screen.findByTestId('retry-cloud-media-incoming-media-1');
  expect(screen.getByText('تعذر تحميل المرفق')).toBeInTheDocument();
  await user.click(retry);

  expect(await screen.findByRole('link', { name: 'تحميل الملف' })).toHaveAttribute(
    'download',
    'receipt.pdf',
  );
  expect(whatsappAPI.getCloudInboxMedia).toHaveBeenCalledTimes(2);
});

test('renders incoming audio controls with a download fallback', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation,
      messages: [inboundAttachment({ id: 'incoming-audio-1', type: 'audio', filename: 'voice.ogg' })],
    },
  });
  whatsappAPI.getCloudInboxMedia.mockResolvedValue({
    data: new Blob(['audio'], { type: 'audio/ogg' }),
  });

  await renderOpenCloudThread();

  expect(await screen.findByRole('link', { name: 'تحميل المقطع الصوتي' }))
    .toHaveAttribute('download', 'voice.ogg');
  expect(document.querySelector('audio[controls]')).toBeInTheDocument();
});

test('keeps fetched incoming media URLs across a current-thread refresh and revokes them on exit', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment({ filename: 'keep.pdf' })] },
  });
  whatsappAPI.getCloudInboxMedia.mockResolvedValue({
    data: new Blob(['pdf'], { type: 'application/pdf' }),
  });
  const user = await renderOpenCloudThread();
  await screen.findByRole('link', { name: 'تحميل الملف' });

  const refresh = screen.getByRole('button', { name: 'تحديث المحادثات' });
  await waitFor(() => expect(refresh).not.toBeDisabled());
  await user.click(refresh);
  await waitFor(() => expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(2));
  expect(whatsappAPI.getCloudInboxMedia).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole('button', { name: 'رجوع' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-media-1');
});

test('discards a late incoming media response after leaving its thread', async () => {
  const lateMedia = deferred();
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment()] },
  });
  whatsappAPI.getCloudInboxMedia.mockReturnValue(lateMedia.promise);
  const user = await renderOpenCloudThread();
  await waitFor(() => expect(whatsappAPI.getCloudInboxMedia).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole('button', { name: 'رجوع' }));
  await act(async () => {
    lateMedia.resolve({ data: new Blob(['pdf'], { type: 'application/pdf' }) });
  });

  expect(URL.createObjectURL).not.toHaveBeenCalled();
});