import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockNavigate = jest.fn();
let mockUser = { is_admin: true };

jest.mock('../../services/api', () => ({
  whatsappAPI: {
    getStatus: jest.fn(),
    getSettings: jest.fn(),
    getLogs: jest.fn(),
    getTargetCount: jest.fn(),
    getCloudInboxConversations: jest.fn(),
    getCloudInboxThread: jest.fn(),
    syncCloudInboxPhoneReplies: jest.fn(),
    getCloudInboxMedia: jest.fn(),
    retryCloudInboxMediaArchive: jest.fn(),
    recoverCloudInboxMessageText: jest.fn(),
    deleteCloudInboxMediaArchive: jest.fn(),
    replyCloudInbox: jest.fn(),
    sendCloudInboxMedia: jest.fn(),
    sendCloudInboxVoice: jest.fn(),
    disconnect: jest.fn(),
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
    user: mockUser,
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
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  },
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
  mockUser = { is_admin: true };
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
  whatsappAPI.syncCloudInboxPhoneReplies.mockResolvedValue({
    data: {
      success: true,
      outcome: 'imported',
      imported: 1,
      existing: 0,
      excluded: 0,
      scanned: 1,
    },
  });
  whatsappAPI.getCloudInboxMedia.mockResolvedValue({
    data: new Blob(['image'], { type: 'image/png' }),
  });
  whatsappAPI.retryCloudInboxMediaArchive.mockResolvedValue({ data: { success: true } });
  whatsappAPI.recoverCloudInboxMessageText.mockResolvedValue({
    data: { success: true, body: 'النص المسترجع' },
  });
  whatsappAPI.deleteCloudInboxMediaArchive.mockResolvedValue({ data: { success: true } });
  whatsappAPI.disconnect.mockResolvedValue({ data: { success: true } });
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

test('shows a clear unavailable notice and explicitly recovers missing Whatsflow text', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation: { ...conversation, provider: 'whatsflow' },
      messages: [{
        id: 'missing-text',
        provider: 'whatsflow',
        provider_message_id: 'provider-missing',
        type: 'text',
        body: '',
        direction: 'inbound',
      }],
    },
  });
  const user = await renderOpenCloudThread();

  expect(screen.getByText('نص الرسالة غير متاح')).toBeInTheDocument();
  expect(screen.queryByText('[text]')).not.toBeInTheDocument();
  await user.click(screen.getByTestId('recover-cloud-text-missing-text'));

  await screen.findByText('النص المسترجع');
  expect(whatsappAPI.recoverCloudInboxMessageText).toHaveBeenCalledWith('missing-text');
});

test('syncs linked-phone replies only from the open Whatsflow thread', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation: { ...conversation, provider: 'whatsflow' },
      messages: [],
    },
  });
  const user = await renderOpenCloudThread();

  await user.click(screen.getByTestId('button-sync-phone-replies'));

  await waitFor(() => {
    expect(whatsappAPI.syncCloudInboxPhoneReplies).toHaveBeenCalledWith(
      conversation.id,
    );
  });
  await waitFor(() => {
    expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(2);
  });
  expect(toast.success).toHaveBeenCalledWith('تمت مزامنة 1 رد من الجوال');
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

test('uses the backend member-link status for cloud phone styling without a render lookup', async () => {
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: {
      conversations: [{
        ...conversation,
        member_link: {
          status: 'unique',
          member: { id: 'member-a', name: 'أحمد عضو', subscription_status: 'active' },
          candidates: [],
          candidate_count: 1,
        },
      }],
      unread_count: 0,
    },
  });
  await renderCloudInbox();

  const phone = screen.getByTestId('cloud-conversation-phone');
  expect(phone).toHaveClass('text-orange-600');
  expect(membersAPI.lookupByPhone).not.toHaveBeenCalled();
});

test('keeps unknown cloud phones neutral, including on hover', async () => {
  await renderCloudInbox();

  const phone = screen.getByTestId('cloud-conversation-phone');
  expect(phone).toHaveClass('text-muted-foreground');
  expect(phone).not.toHaveClass('text-orange-600');
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

test('shows the server-derived unique member photo, subscription status, and profile deeplink', async () => {
  const memberLink = {
    status: 'unique',
    candidate_count: 1,
    candidates: [],
    member: {
      id: 'member-saudi-a',
      name: 'أحمد عضو',
      member_code: 'M-101',
      photo: 'https://photos.example/member-saudi-a.jpg',
      subscription_status: 'active',
    },
  };
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [{ ...conversation, member_link: memberLink }], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation: { ...conversation, member_link: memberLink }, messages: [] },
  });
  const user = await renderCloudInbox();

  expect(screen.getByTestId('cloud-member-name')).toHaveTextContent('أحمد عضو');
  expect(screen.getByTestId('cloud-member-subscription')).toHaveTextContent('اشتراك نشط');
  expect(document.querySelector('img[src="https://photos.example/member-saudi-a.jpg"]'))
    .toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  await user.click(await screen.findByTestId('cloud-open-member-member-saudi-a'));

  expect(mockNavigate).toHaveBeenCalledWith('/admin/members?focus=member-saudi-a');
  expect(membersAPI.lookupByPhone).not.toHaveBeenCalled();
});

test('loads the thread before safely choosing among server-provided shared-phone candidates', async () => {
  const listLink = { status: 'ambiguous', member: null, candidates: [], candidate_count: 2 };
  const threadLink = {
    ...listLink,
    candidates: [
      { id: 'member-shared-a', name: 'عضو الفرع الأول', subscription_status: 'active' },
      { id: 'member-shared-b', name: 'عضو الفرع الثاني', subscription_status: 'none' },
    ],
  };
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [{ ...conversation, member_link: listLink }], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation: { ...conversation, member_link: threadLink }, messages: [] },
  });
  const user = await renderCloudInbox();

  expect(screen.queryByTestId('cloud-member-name')).not.toBeInTheDocument();
  expect(screen.getByText('رقم مشترك بين أعضاء')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  expect(await screen.findByTestId('cloud-choose-member')).toBeInTheDocument();
  await user.click(screen.getByTestId('cloud-choose-member'));
  expect(screen.getByTestId('phone-member-choice-member-shared-a')).toBeInTheDocument();
  expect(screen.getByTestId('phone-member-choice-member-shared-b')).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();

  await user.click(screen.getByTestId('phone-member-choice-member-shared-b'));
  expect(mockNavigate).toHaveBeenCalledWith('/admin/members?focus=member-shared-b');
  expect(membersAPI.lookupByPhone).not.toHaveBeenCalled();
});

test.each(['none', 'restricted'])(
  'does not expose a member control or run a phone lookup for a %s cloud association',
  async status => {
    const noMemberConversation = {
      ...conversation,
      member_link: { status, member: null, candidates: [], candidate_count: 0 },
    };
    whatsappAPI.getCloudInboxConversations.mockResolvedValue({
      data: { conversations: [noMemberConversation], unread_count: 0 },
    });
    whatsappAPI.getCloudInboxThread.mockResolvedValue({
      data: { conversation: noMemberConversation, messages: [] },
    });
    const user = await renderCloudInbox();

    expect(screen.queryByTestId('cloud-member-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cloud-choose-member')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /أحمد/ }));
    expect(screen.queryByTestId('cloud-open-member-member-saudi-a')).not.toBeInTheDocument();
    expect(membersAPI.lookupByPhone).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  },
);

test('ignores a stale switched-chat member association response', async () => {
  const firstThread = deferred();
  const secondConversation = {
    ...conversation,
    id: 'branch-a:966501234568',
    phone: '966501234568',
    contact_name: 'سارة',
  };
  const firstLink = {
    status: 'unique',
    member: { id: 'member-first', name: 'عضو أول', subscription_status: 'active' },
    candidates: [],
    candidate_count: 1,
  };
  const secondLink = {
    status: 'unique',
    member: { id: 'member-second', name: 'عضو ثانٍ', subscription_status: 'expired' },
    candidates: [],
    candidate_count: 1,
  };
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [conversation, secondConversation], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxThread
    .mockReturnValueOnce(firstThread.promise)
    .mockResolvedValueOnce({
      data: {
        conversation: { ...secondConversation, member_link: secondLink },
        messages: [],
      },
    });
  const user = await renderCloudInbox();

  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  await user.click(screen.getByRole('button', { name: /رجوع/ }));
  await user.click(await screen.findByRole('button', { name: /سارة/ }));
  expect(await screen.findByTestId('cloud-open-member-member-second')).toBeInTheDocument();

  await act(async () => {
    firstThread.resolve({
      data: { conversation: { ...conversation, member_link: firstLink }, messages: [] },
    });
  });
  expect(screen.getByTestId('cloud-open-member-member-second')).toBeInTheDocument();
  expect(screen.queryByTestId('cloud-open-member-member-first')).not.toBeInTheDocument();
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

test.each([
  ['archived', 'محفوظ بالنظام'],
  ['pending', 'جارٍ الحفظ'],
  ['failed', 'تعذر الحفظ'],
  ['unavailable', 'لم يعد متاحًا لدى المزوّد'],
  ['unsupported', 'غير مدعوم'],
  ['deleted', 'حُذف المرفق'],
])('shows the %s attachment archive status', async (archive_status, label) => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment({ archive_status })] },
  });

  await renderOpenCloudThread();

  expect(await screen.findByTestId('cloud-archive-status-incoming-media-1')).toHaveTextContent(label);
});

test('retries attachment archiving without resending a message and refreshes only the current thread', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation,
      messages: [inboundAttachment({ archive_status: 'failed', archive_error: 'Temporary provider error' })],
    },
  });
  const user = await renderOpenCloudThread();

  await user.click(await screen.findByTestId('retry-cloud-archive-incoming-media-1'));

  await waitFor(() => expect(whatsappAPI.retryCloudInboxMediaArchive)
    .toHaveBeenCalledWith('incoming-media-1'));
  expect(whatsappAPI.replyCloudInbox).not.toHaveBeenCalled();
  expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(2);
});

test('does not delete an archived attachment when confirmation is cancelled', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment({ archive_status: 'archived' })] },
  });
  const user = await renderOpenCloudThread();

  await user.click(await screen.findByTestId('delete-cloud-archive-incoming-media-1'));

  expect(whatsappAPI.deleteCloudInboxMediaArchive).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test('deletes only the saved copy, revokes its cached URL, and renders a tombstone', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment({ archive_status: 'archived' })] },
  });
  const user = await renderOpenCloudThread();
  await screen.findByRole('link', { name: 'تحميل الملف' });

  await user.click(screen.getByTestId('delete-cloud-archive-incoming-media-1'));

  await waitFor(() => expect(whatsappAPI.deleteCloudInboxMediaArchive)
    .toHaveBeenCalledWith('incoming-media-1'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-media-1');
  expect(await screen.findByTestId('cloud-archive-tombstone-incoming-media-1')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'تحميل الملف' })).not.toBeInTheDocument();
  confirm.mockRestore();
});

test('does not expose saved-copy deletion to non-admin users', async () => {
  mockUser = { is_admin: false };
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation, messages: [inboundAttachment({ archive_status: 'archived' })] },
  });

  await renderOpenCloudThread();

  expect(screen.queryByTestId('delete-cloud-archive-incoming-media-1')).not.toBeInTheDocument();
});

test('ignores a stale archive delete response after switching conversations', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const deleteRequest = deferred();
  const secondConversation = {
    ...conversation,
    id: 'branch-a:966501234568',
    phone: '966501234568',
    contact_name: 'سارة',
  };
  const secondMessage = inboundAttachment({
    id: 'incoming-media-2',
    media_id: 'provider-media-2',
    archive_status: 'archived',
  });
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [conversation, secondConversation], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxThread
    .mockResolvedValueOnce({
      data: { conversation, messages: [inboundAttachment({ archive_status: 'archived' })] },
    })
    .mockResolvedValueOnce({
      data: { conversation: secondConversation, messages: [secondMessage] },
    });
  whatsappAPI.deleteCloudInboxMediaArchive.mockReturnValue(deleteRequest.promise);
  const user = await renderOpenCloudThread();

  await user.click(await screen.findByTestId('delete-cloud-archive-incoming-media-1'));
  await user.click(screen.getByRole('button', { name: /رجوع/ }));
  await user.click(await screen.findByRole('button', { name: /سارة/ }));
  await screen.findByTestId('delete-cloud-archive-incoming-media-2');

  await act(async () => {
    deleteRequest.resolve({ data: { success: true } });
  });
  expect(screen.queryByTestId('cloud-archive-tombstone-incoming-media-2')).not.toBeInTheDocument();
  expect(screen.getByTestId('delete-cloud-archive-incoming-media-2')).toBeInTheDocument();
  confirm.mockRestore();
});

const campaignMessage = overrides => ({
  id: 'campaign-message-1',
  source: 'campaign',
  direction: 'outbound',
  type: 'text',
  body: 'عرض الاشتراك',
  status: 'pending',
  created_at: '2026-01-01T12:00:00Z',
  ...overrides,
});

test('shows queued campaign previews and bubbles without treating them as sent', async () => {
  const queuedConversation = {
    ...conversation,
    last_direction: 'outbound',
    last_source: 'campaign',
    last_status: 'pending',
    last_queue_status: 'queued',
    last_queued_at: '2026-01-02T08:30:00Z',
    last_timestamp_kind: 'queued_at',
    last_message: 'عرض الاشتراك',
  };
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [queuedConversation], unread_count: 0 },
  });
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: { conversation: queuedConversation, messages: [campaignMessage({
      queued_at: '2026-01-02T08:30:00Z', timestamp_kind: 'queued',
    })] },
  });

  const user = await renderCloudInbox();
  expect(screen.getByTestId(`campaign-conversation-preview-${conversation.id}`))
    .toHaveTextContent('حملة · بانتظار الإرسال');
  expect(screen.getByTestId(`campaign-conversation-preview-${conversation.id}`))
    .not.toHaveTextContent('أنت:');
  expect(screen.getByTestId(`campaign-conversation-time-${conversation.id}`))
    .toHaveTextContent('وقت الإضافة للطابور');

  await user.click(screen.getByRole('button', { name: /أحمد/ }));
  expect(await screen.findByTestId('campaign-message-status-campaign-message-1'))
    .toHaveTextContent('بانتظار الإرسال');
  expect(screen.getByTestId('campaign-message-time-campaign-message-1'))
    .toHaveTextContent('وقت الإضافة للطابور');
});

test('labels provider-accepted campaign sends without claiming delivery', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation,
      messages: [campaignMessage({ status: 'sent', sent_at: '2026-01-02T09:00:00Z' })],
    },
  });

  await renderOpenCloudThread();

  expect(screen.getByTestId('campaign-message-status-campaign-message-1'))
    .toHaveTextContent('قبلها المزوّد (لم يتأكد وصولها)');
  expect(screen.getByTestId('campaign-message-status-campaign-message-1'))
    .toHaveAttribute('title', expect.stringContaining('قبل المزوّد الرسالة'));
  expect(screen.getByTestId('campaign-message-time-campaign-message-1'))
    .toHaveTextContent('وقت قبول المزوّد');
  expect(screen.queryByText('وصلت')).not.toBeInTheDocument();
});

test('labels regular outbound acceptance separately from delivery evidence', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation,
      messages: [{
        id: 'regular-outbound',
        direction: 'outbound',
        type: 'text',
        body: 'رد عادي',
        status: 'sent',
        delivery_status: 'accepted',
        created_at: '2026-01-02T09:00:00Z',
      }],
    },
  });

  await renderOpenCloudThread();

  expect(screen.getByText('· قبلها المزوّد (لم يتأكد وصولها)')).toBeInTheDocument();
  expect(screen.queryByText('· وصلت')).not.toBeInTheDocument();
});

test.each([
  ['delivered', 'delivered_at', '2026-01-02T10:00:00Z', 'وصلت', 'وقت الوصول'],
  ['read', 'read_at', '2026-01-02T10:05:00Z', 'قُرئت', 'وقت القراءة'],
])('renders campaign %s receipts only when their receipt timestamp is supplied', async (
  status,
  timestampField,
  timestamp,
  statusLabel,
  timeLabel,
) => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation,
      messages: [campaignMessage({ status, [timestampField]: timestamp })],
    },
  });

  await renderOpenCloudThread();

  expect(screen.getByTestId('campaign-message-status-campaign-message-1')).toHaveTextContent(statusLabel);
  expect(screen.getByTestId('campaign-message-time-campaign-message-1')).toHaveTextContent(timeLabel);
});

test('keeps unknown and failed campaign outcomes distinct and does not invent a send time', async () => {
  whatsappAPI.getCloudInboxThread.mockResolvedValue({
    data: {
      conversation,
      messages: [
        campaignMessage({ id: 'campaign-unknown', status: 'unknown' }),
        campaignMessage({ id: 'campaign-failed', status: 'failed' }),
      ],
    },
  });

  await renderOpenCloudThread();

  expect(screen.getByTestId('campaign-message-status-campaign-unknown')).toHaveTextContent('لم يتأكد الإرسال');
  expect(screen.getByTestId('campaign-message-status-campaign-failed')).toHaveTextContent('فشلت');
  expect(screen.queryByTestId('campaign-message-time-campaign-unknown')).not.toBeInTheDocument();
  expect(screen.queryByTestId('campaign-message-time-campaign-failed')).not.toBeInTheDocument();
});

test('uses latest campaign metadata for a mixed conversation preview and never falls back to created time', async () => {
  const projectedCampaignLatest = {
    ...conversation,
    last_direction: 'outbound',
    last_source: 'campaign',
    last_status: 'unknown',
    last_queue_status: 'dispatching',
    last_timestamp_kind: null,
    last_message: 'رسالة حملة حديثة',
    // This legacy display timestamp must not be represented as a send receipt.
    last_message_at: '2026-01-02T11:00:00Z',
  };
  whatsappAPI.getCloudInboxConversations.mockResolvedValue({
    data: { conversations: [projectedCampaignLatest], unread_count: 0 },
  });

  await renderCloudInbox();

  expect(screen.getByTestId(`campaign-conversation-preview-${conversation.id}`))
    .toHaveTextContent('حملة · لم يتأكد الإرسال · رسالة حملة حديثة');
  expect(screen.queryByTestId(`campaign-conversation-time-${conversation.id}`)).not.toBeInTheDocument();
});

const setDocumentVisibility = value => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  jest.restoreAllMocks();
});

test('never requests legacy connection status and keeps reminder settings accessible', async () => {
  jest.useFakeTimers();
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);
  await flushPromises();
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();
  expect(screen.getByText('محادثات واتساب الفروع')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'الإعدادات' }));
  await flushPromises();
  expect(screen.getByText('إعدادات التذكيرات التلقائية')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /فصل/ })).not.toBeInTheDocument();
  expect(screen.queryByAltText('WhatsApp QR')).not.toBeInTheDocument();

  await act(async () => {
    jest.advanceTimersByTime(35000);
  });
  await flushPromises();
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();
});

test('refreshes the new inbox view list instead of polling the previously selected thread', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);
  await user.click(screen.getByRole('button', { name: /شات واتساب/ }));
  await screen.findByText('أحمد');
  const unreadViewButton = screen.getByRole('button', { name: /غير مقروءة/ });
  const conversationButton = screen.getByRole('button', { name: /أحمد/ });

  // Batch the scope change with opening the old list item. The scope effect
  // must own the new list read even though a selected-thread ref now exists.
  await act(async () => {
    unreadViewButton.click();
    conversationButton.click();
  });
  await waitFor(() => {
    expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(2);
  });
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith('branch-a', true);
  expect(whatsappAPI.getCloudInboxThread).toHaveBeenCalledTimes(1);
});

test('debounces conversation history search and clears empty results', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  whatsappAPI.getCloudInboxConversations
    .mockResolvedValueOnce({
      data: { conversations: [conversation], unread_count: 0, needs_reply_count: 0 },
    })
    .mockResolvedValue({
      data: { conversations: [], unread_count: 0, needs_reply_count: 0 },
    });
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);
  await user.click(screen.getByRole('button', { name: /شات واتساب/ }));
  await screen.findByText('أحمد');

  const search = screen.getByRole('textbox', { name: 'البحث في محادثات واتساب' });
  await user.type(search, 'رسالة قديمة');
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith(
      'branch-a', false, false, 'رسالة قديمة',
    );
  });
  expect(await screen.findByText('لا توجد نتائج مطابقة للبحث')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'مسح البحث' }));
  await waitFor(() => {
    expect(whatsappAPI.getCloudInboxConversations).toHaveBeenLastCalledWith(
      'branch-a', false,
    );
  });
});

test('pauses cloud inbox reads while hidden, refreshes on visible, and cleans up', async () => {
  jest.useFakeTimers();
  const WhatsAppPage = require('../WhatsAppPage').default;
  const view = render(<WhatsAppPage />);
  await flushPromises();
  fireEvent.click(screen.getByRole('button', { name: /شات واتساب/ }));
  await flushPromises();
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(1);

  await act(async () => {
    setDocumentVisibility('hidden');
  });
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(1);

  await act(async () => {
    setDocumentVisibility('visible');
  });
  await flushPromises();
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(2);

  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  await flushPromises();
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(3);
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();

  view.unmount();
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(whatsappAPI.getCloudInboxConversations).toHaveBeenCalledTimes(3);
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();
});

test('does not restore legacy status reads after visibility changes', async () => {
  jest.useFakeTimers();
  const WhatsAppPage = require('../WhatsAppPage').default;
  render(<WhatsAppPage />);
  await flushPromises();
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(15000);
  });
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();

  await act(async () => {
    setDocumentVisibility('hidden');
  });
  await act(async () => {
    setDocumentVisibility('visible');
  });
  await flushPromises();
  expect(whatsappAPI.getStatus).not.toHaveBeenCalled();
});