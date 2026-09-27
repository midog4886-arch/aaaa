import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
jest.mock('../../components/WhatsAppCampaignWorkflow',()=>()=>null);

jest.mock('../../services/api', () => ({
  branchesAPI: {
    getAll: jest.fn(),
  },
  whatsappAPI: {
    getBranchCloudAvailability: jest.fn(),
    listCampaigns: jest.fn(),
    getCampaign: jest.fn(),
    getCampaignAttachment: jest.fn(),
    createCampaign: jest.fn(),
    updateCampaign: jest.fn(),
    deleteCampaign: jest.fn(),
    previewCampaignAudience: jest.fn(),
    sendBranchCloudBulk: jest.fn(),
    sendBranchCloudBulkMedia: jest.fn(),
    listBranchCloudJobs: jest.fn(),
    cancelBranchCloudJob: jest.fn(),
    reconcileBranchCloudLane: jest.fn(),
  },
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

let mockSelectedBranchId = 'branch-a';
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ selectedBranchId: mockSelectedBranchId }),
}));

jest.mock('../../components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

const { branchesAPI, whatsappAPI } = require('../../services/api');

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedBranchId = 'branch-a';
  branchesAPI.getAll.mockResolvedValue({ data: [
    { id: 'branch-a', name: 'Main' },
    { id: 'branch-b', name: 'Second' },
  ] });
  whatsappAPI.getBranchCloudAvailability.mockResolvedValue({
    data: {
      enabled: true,
      configured: true,
      connected: true,
      provider: 'waha',
      daily_limit: 30,
      daily_used: 30,
      daily_remaining: 0,
      template_configured: true,
    },
  });
  whatsappAPI.listCampaigns.mockResolvedValue({
    data: [{
      id: 'campaign-1',
      name: 'Welcome draft',
      audience: 'pasted',
      recipient_count: 1,
      has_attachment: false,
    }],
  });
  whatsappAPI.listBranchCloudJobs.mockResolvedValue({ data: [] });
  whatsappAPI.getCampaign.mockResolvedValue({
    data: {
      id: 'campaign-1',
      name: 'Welcome draft',
      message: 'Hello {name}',
      default_name: 'Friend',
      proposed_send_at: '2026-06-01T18:30',
      audience: 'pasted',
      recipients: [{ phone: '966500000001', name: 'Aisha' }],
      has_attachment: false,
    },
  });
  whatsappAPI.updateCampaign.mockResolvedValue({
    data: { id: 'campaign-1', has_attachment: true },
  });
  URL.createObjectURL = jest.fn(() => 'blob:test-preview');
  URL.revokeObjectURL = jest.fn();
});

const deferred = () => {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

test('selects, saves and reloads expired audience from fresh branch preview without sending', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  whatsappAPI.previewCampaignAudience.mockResolvedValue({
    data: { count: 1, recipients: [{ phone: '966500000002', name: 'Expired member', member_id: 'expired-1' }] },
  });
  whatsappAPI.createCampaign.mockResolvedValue({ data: { id: 'expired-draft' } });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  await screen.findByRole('button', { name: /Welcome draft/i });
  await user.click(screen.getAllByRole('combobox')[0]);
  await user.click(await screen.findByRole('option', { name: 'Expired branch members' }));
  await waitFor(() => expect(whatsappAPI.previewCampaignAudience)
    .toHaveBeenCalledWith('branch-a', 'expired_members'));
  expect(await screen.findByText(/Preview: 1 recipient/)).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText(/Back-to-training offer/i), 'Expired draft');
  await user.click(screen.getByRole('button', { name: /Save draft/i }));
  await waitFor(() => expect(whatsappAPI.createCampaign).toHaveBeenCalled());
  const saved = whatsappAPI.createCampaign.mock.calls[0][0];
  expect(saved.get('audience')).toBe('expired_members');
  expect(saved.get('recipients_json')).toBe('[]');

  whatsappAPI.getCampaign.mockResolvedValueOnce({
    data: { id: 'campaign-1', name: 'Expired draft', message: 'Hello {name}',
      audience: 'expired_members', recipients: [{ phone: '966599999999', name: 'Stale' }] },
  });
  await user.click(screen.getByRole('button', { name: /Welcome draft/i }));
  await waitFor(() => expect(whatsappAPI.previewCampaignAudience).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('966599999999')).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Expired branch members');
  await user.click(screen.getByRole('button', { name: /Save draft/i }));
  await waitFor(() => expect(whatsappAPI.updateCampaign).toHaveBeenCalled());
  expect(whatsappAPI.updateCampaign.mock.calls[0][1].get('audience')).toBe('expired_members');
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  expect(whatsappAPI.sendBranchCloudBulkMedia).not.toHaveBeenCalled();
});

test.each([false, true])('expired audience uses reviewed recipients in confirmed send (attachment=%s)', async (withAttachment) => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  window.confirm = jest.fn(() => false);
  Object.defineProperty(global, 'crypto', {
    configurable: true, value: { randomUUID: jest.fn(() => 'expired-send-key') },
  });
  whatsappAPI.getCampaign.mockResolvedValueOnce({
    data: {
      id: 'campaign-1', name: 'Expired draft', message: 'Hello {name}', audience: 'expired_members',
      has_attachment: withAttachment,
      attachments: withAttachment ? [{ attachment_name: 'offer.png', attachment_type: 'image/png' }] : [],
    },
  });
  whatsappAPI.getCampaignAttachment.mockResolvedValue({
    data: new Blob(['image'], { type: 'image/png' }),
  });
  whatsappAPI.previewCampaignAudience.mockResolvedValue({
    data: { count: 1, recipients: [{ phone: '966500000002', name: 'Expired member', member_id: 'expired-1' }] },
  });
  const api = withAttachment ? whatsappAPI.sendBranchCloudBulkMedia : whatsappAPI.sendBranchCloudBulk;
  api.mockResolvedValue({ data: { id: 'expired-job', status: 'pending', total: 1, pending: 1 } });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  await user.click(await screen.findByRole('button', { name: /Welcome draft/i }));
  const send = await screen.findByRole('button', { name: /Send 1 message.* to 1/i });
  await waitFor(() => expect(send).toBeEnabled());
  expect(api).not.toHaveBeenCalled();
  await user.click(send);
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/At least 3 minutes/));
  expect(api).not.toHaveBeenCalled();
  window.confirm.mockReturnValue(true);
  await user.click(send);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  const recipients = withAttachment
    ? JSON.parse(api.mock.calls[0][0].get('recipients_json'))
    : api.mock.calls[0][1];
  expect(recipients).toEqual([{
    phone: '966500000002', message: 'Hello Expired member', name: 'Expired member', member_id: 'expired-1',
  }]);
});

test.each([
  [[{loc: ['body', 'recipients'], msg: 'Invalid recipients', type: 'value_error'}], 'Invalid recipients'],
  [{error: 'Branch is unavailable'}, 'Branch is unavailable'],
  [{unknown: {nested: true}}, 'Could not confirm campaign enqueue'],
])('structured send errors remain readable without crashing or resending: %j', async (detail, expected) => {
  const user = userEvent.setup();
  window.confirm = jest.fn(() => true);
  Object.defineProperty(global, 'crypto', { configurable: true, value: {randomUUID: () => 'error-key'} });
  whatsappAPI.sendBranchCloudBulk.mockRejectedValueOnce({ response: {data: {detail}} });
  const { toast } = require('sonner');
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  await user.click(await screen.findByRole('button', {name: /Welcome draft/i}));
  await user.click(screen.getByRole('button', {name: /Send 1 message.* to 1/i}));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  const text = toast.error.mock.calls[0][0];
  expect(typeof text).toBe('string');
  expect(text).toContain(expected);
  // A real toast renders its payload as a React child; this must not throw.
  expect(() => render(<div>{text}</div>)).not.toThrow();
  expect(screen.getByRole('button', {name: /Send 1 message.* to 1/i})).toBeEnabled();
  expect(whatsappAPI.sendBranchCloudBulk).toHaveBeenCalledTimes(1);
});

test('daily quota is advisory because a durable queue may continue next day', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);

  const draftButton = await screen.findByRole('button', { name: /Welcome draft/i });
  await user.click(draftButton);

  await waitFor(() => expect(whatsappAPI.getCampaign).toHaveBeenCalledWith('campaign-1', 'branch-a'));
  expect(screen.getByDisplayValue('Welcome draft')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Hello {name}')).toBeInTheDocument();
  expect(screen.getByText(/Preview: 1 recipient/)).toBeInTheDocument();
  expect(screen.getByText(/manager approval to activate scheduling/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send 1 message.* to 1/i })).toBeEnabled();
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  expect(whatsappAPI.sendBranchCloudBulkMedia).not.toHaveBeenCalled();
});

test('enqueues without claiming sent and renders returned progress', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  window.confirm = jest.fn(() => true);
  Object.defineProperty(global, 'crypto', {
    configurable: true, value: { randomUUID: jest.fn(() => 'stable-ui-key-123') },
  });
  whatsappAPI.sendBranchCloudBulk.mockResolvedValue({
    data: {
      id: 'job-new', status: 'pending', total: 1, pending: 1,
      sent: 0, failed: 0, unknown: 0,
    },
  });
  whatsappAPI.listBranchCloudJobs
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValue({
      data: [{
        id: 'job-new', status: 'pending', total: 1, pending: 1,
        sent: 0, failed: 0, unknown: 0,
      }],
    });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  await user.click(await screen.findByRole('button', { name: /Welcome draft/i }));
  await user.click(screen.getByRole('button', { name: /Send 1 message.* to 1/i }));

  await waitFor(() => expect(whatsappAPI.sendBranchCloudBulk).toHaveBeenCalledWith(
    'branch-a',
    [{ phone: '966500000001', message: 'Hello Aisha', name: 'Aisha' }],
    'stable-ui-key-123',
    { campaign_id: 'campaign-1', campaign_title: 'Welcome draft', branch_name: 'Main' },
  ));
  expect(await screen.findByTestId('cloud-job-progress')).toHaveTextContent('Pending: 1');
  expect(screen.getByTestId('cloud-job-progress')).toHaveTextContent('Sent: 0');
});

test('includes recipient identity and campaign metadata in multipart sends', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  window.confirm = jest.fn(() => true);
  Object.defineProperty(global, 'crypto', {
    configurable: true, value: { randomUUID: jest.fn(() => 'media-metadata-key-123') },
  });
  whatsappAPI.getCampaign.mockResolvedValueOnce({
    data: {
      id: 'campaign-1',
      name: 'Welcome draft',
      message: 'Hello {name}',
      audience: 'pasted',
      recipients: [{
        phone: '966500000001',
        name: 'Aisha',
        id: 'recipient-1',
        member_id: 'member-1',
      }],
      has_attachment: true,
      attachments: [{ attachment_name: 'first.png', attachment_type: 'image/png' }],
    },
  });
  whatsappAPI.getCampaignAttachment.mockResolvedValueOnce({
    data: new Blob(['first'], { type: 'image/png' }),
  });
  whatsappAPI.sendBranchCloudBulkMedia.mockResolvedValue({
    data: { id: 'media-job', status: 'pending', total: 1, pending: 1, sent: 0, failed: 0, unknown: 0 },
  });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);

  await user.click(await screen.findByRole('button', { name: /Welcome draft/i }));
  await screen.findByText('first.png');
  await user.click(screen.getByRole('button', { name: /Send 1 message.* to 1/i }));

  await waitFor(() => expect(whatsappAPI.sendBranchCloudBulkMedia).toHaveBeenCalled());
  const [formData, metadata] = whatsappAPI.sendBranchCloudBulkMedia.mock.calls[0];
  expect(JSON.parse(formData.get('recipients_json'))).toEqual([{
    phone: '966500000001',
    message: 'Hello Aisha',
    name: 'Aisha',
    id: 'recipient-1',
    member_id: 'member-1',
  }]);
  expect(formData.get('campaign_id')).toBe('campaign-1');
  expect(formData.get('campaign_title')).toBe('Welcome draft');
  expect(formData.get('branch_name')).toBe('Main');
  expect(metadata).toEqual({
    campaign_id: 'campaign-1',
    campaign_title: 'Welcome draft',
    branch_name: 'Main',
  });
});

test('a newly enqueued job starts polling even when the initial server list was empty', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  window.confirm = jest.fn(() => true);
  Object.defineProperty(global, 'crypto', {
    configurable: true, value: { randomUUID: jest.fn(() => 'poll-new-key-123') },
  });
  whatsappAPI.listBranchCloudJobs
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValue({
      data: [{
        id: 'poll-job', status: 'completed', total: 1, pending: 0,
        sent: 1, failed: 0, unknown: 0,
      }],
    });
  whatsappAPI.sendBranchCloudBulk.mockResolvedValue({
    data: {
      id: 'poll-job', status: 'pending', total: 1, pending: 1,
      sent: 0, failed: 0, unknown: 0,
    },
  });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  await user.click(await screen.findByRole('button', { name: /Welcome draft/i }));
  await user.click(screen.getByRole('button', { name: /Send 1 message.* to 1/i }));
  await waitFor(() => expect(whatsappAPI.listBranchCloudJobs.mock.calls.length).toBeGreaterThan(1));
  await waitFor(() => expect(screen.getByTestId('cloud-job-progress')).toHaveTextContent('Sent: 1'));
});

test('resumes server progress on reload and cancels only remaining work', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  whatsappAPI.listBranchCloudJobs.mockResolvedValue({
    data: [{
      id: 'existing-job', status: 'processing', total: 4, pending: 2,
      sent: 1, failed: 0, unknown: 1,
    }],
  });
  whatsappAPI.cancelBranchCloudJob.mockResolvedValue({
    data: {
      id: 'existing-job', status: 'completed', total: 4, pending: 0,
      sent: 1, failed: 0, unknown: 1, cancelled: 2,
    },
  });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);

  const progress = await screen.findByTestId('cloud-job-progress');
  expect(progress).toHaveTextContent('Pending: 2');
  expect(progress).toHaveTextContent('Sent: 1');
  expect(progress).toHaveTextContent('Unknown: 1');
  await user.click(screen.getByRole('button', { name: /Cancel remaining/i }));
  await waitFor(() => expect(whatsappAPI.cancelBranchCloudJob)
    .toHaveBeenCalledWith('branch-a', 'existing-job'));
  expect(screen.getByTestId('cloud-job-progress')).toHaveTextContent('Pending: 0');
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  expect(whatsappAPI.sendBranchCloudBulkMedia).not.toHaveBeenCalled();
});

test('explains a frozen lane and requires confirmation before recovery', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  window.confirm = jest.fn(() => true);
  whatsappAPI.listBranchCloudJobs.mockResolvedValue({
    data: [{
      id: 'unknown-job', status: 'completed', total: 1, pending: 0,
      sent: 0, failed: 0, unknown: 1, lane_frozen: true,
      lane_freeze_reason: 'uncertain provider dispatch',
    }],
  });
  whatsappAPI.reconcileBranchCloudLane.mockResolvedValue({ data: { success: true } });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  expect(await screen.findByText(/earlier outcome is uncertain/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Verified.*recover branch queue/i }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/no send is still in flight/i));
  await waitFor(() => expect(whatsappAPI.reconcileBranchCloudLane).toHaveBeenCalledWith('branch-a'));
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
});

test('branch change resets campaign content and ignores a stale draft response', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const staleDraft = deferred();
  whatsappAPI.getCampaign.mockReturnValueOnce(staleDraft.promise);
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  const view = render(<WhatsAppBulkPage />);

  await user.click(await screen.findByRole('button', { name: /Welcome draft/i }));
  expect(whatsappAPI.getCampaign).toHaveBeenCalledWith('campaign-1', 'branch-a');

  const branchSelect = screen.getAllByRole('combobox')[1];
  await user.click(branchSelect);
  await user.click(await screen.findByRole('option', { name: 'Second' }));
  await waitFor(() => expect(whatsappAPI.listCampaigns).toHaveBeenCalledWith('branch-b'));
  expect(screen.getByPlaceholderText(/Back-to-training offer/i)).toHaveValue('');
  expect(screen.queryByDisplayValue('Hello {name}')).not.toBeInTheDocument();

  await act(async () => {
    staleDraft.resolve({
      data: {
        id: 'campaign-1',
        name: 'Stale private draft',
        message: 'Must not render',
        audience: 'pasted',
        recipients: [{ phone: '966500000001', name: 'Aisha' }],
      },
    });
  });
  expect(screen.queryByDisplayValue('Stale private draft')).not.toBeInTheDocument();
  expect(screen.queryByText('966500000001')).not.toBeInTheDocument();
});

test('branch change invalidates an in-flight dynamic audience response', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const staleAudience = deferred();
  whatsappAPI.previewCampaignAudience.mockReturnValueOnce(staleAudience.promise);
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);
  await screen.findByRole('button', { name: /Welcome draft/i });

  await user.click(screen.getAllByRole('combobox')[0]);
  await user.click(await screen.findByRole('option', { name: 'Active branch members' }));
  expect(whatsappAPI.previewCampaignAudience).toHaveBeenCalledWith('branch-a', 'active_members');

  await user.click(screen.getAllByRole('combobox')[1]);
  await user.click(await screen.findByRole('option', { name: 'Second' }));
  await waitFor(() => expect(whatsappAPI.listCampaigns).toHaveBeenCalledWith('branch-b'));

  await act(async () => {
    staleAudience.resolve({
      data: { count: 1, recipients: [{ phone: '966599999999', name: 'Wrong branch' }] },
    });
  });
  expect(screen.queryByText('966599999999')).not.toBeInTheDocument();
  expect(screen.getByText(/Preview: 0 recipient/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Send 0 message.* to 0/i })).toBeDisabled();
});

test('restores multiple draft images in order, removes one, and saves the remainder', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  whatsappAPI.getCampaign.mockResolvedValueOnce({
    data: {
      id: 'campaign-1', name: 'Welcome draft', message: 'Hello',
      audience: 'pasted', recipients: [{ phone: '966500000001', name: 'Aisha' }],
      has_attachment: true,
      attachments: [
        { attachment_name: 'first.png', attachment_type: 'image/png', attachment_size: 12 },
        { attachment_name: 'second.png', attachment_type: 'image/png', attachment_size: 13 },
      ],
    },
  });
  whatsappAPI.getCampaignAttachment
    .mockResolvedValueOnce({ data: new Blob(['first'], { type: 'image/png' }) })
    .mockResolvedValueOnce({ data: new Blob(['second'], { type: 'image/png' }) });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);

  await user.click(await screen.findByRole('button', { name: /Welcome draft/i }));
  await screen.findByText('second.png');
  expect(whatsappAPI.getCampaignAttachment.mock.calls).toEqual([
    ['campaign-1', 'branch-a', 0],
    ['campaign-1', 'branch-a', 1],
  ]);
  const secondCard = screen.getByText('second.png').parentElement;
  await user.click(secondCard.querySelector('button'));
  expect(screen.queryByText('second.png')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Save draft/i }));
  await waitFor(() => expect(whatsappAPI.updateCampaign).toHaveBeenCalled());
  const formData = whatsappAPI.updateCampaign.mock.calls[0][1];
  expect(formData.getAll('attachments')).toHaveLength(1);
  expect(formData.getAll('attachments')[0].name).toBe('first.png');
});
