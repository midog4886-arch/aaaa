import React from 'react';
jest.mock('../../components/WhatsAppCampaignWorkflow',()=>()=>null);
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../../services/api', () => ({
  branchesAPI: {
    getAll: jest.fn(),
  },
  whatsappAPI: {
    getBranchCloudAvailability: jest.fn(),
    listCampaigns: jest.fn(),
    listBranchCloudJobs: jest.fn(),
    getCampaign: jest.fn(),
    getCampaignAttachment: jest.fn(),
    createCampaign: jest.fn(),
    updateCampaign: jest.fn(),
    deleteCampaign: jest.fn(),
    previewCampaignAudience: jest.fn(),
    sendBranchCloudBulk: jest.fn(),
    sendBranchCloudBulkMedia: jest.fn(),
    cancelBranchCloudJob: jest.fn(),
    reconcileBranchCloudLane: jest.fn(),
  },
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { is_admin: true, permissions: ['messages'] },
    selectedBranchId: 'branch-a',
  }),
}));

jest.mock('../../components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
}));

jest.mock('../../components/WhatsAppCampaignReport', () => () => null);

const { branchesAPI, whatsappAPI } = require('../../services/api');
const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;

const connectedStatus = {
  enabled: true,
  configured: true,
  connected: true,
  provider: 'whatsflow',
  daily_limit: 30,
  daily_used: 4,
  daily_remaining: 26,
  template_configured: false,
  image_template_configured: false,
  document_template_configured: false,
};

const deferred = () => {
  let reject;
  const promise = new Promise((resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  branchesAPI.getAll.mockResolvedValue({
    data: [{ id: 'branch-a', name: 'Main' }],
  });
  whatsappAPI.getBranchCloudAvailability.mockResolvedValue({ data: connectedStatus });
  whatsappAPI.listCampaigns.mockResolvedValue({ data: [] });
  whatsappAPI.listBranchCloudJobs.mockResolvedValue({ data: [] });
  whatsappAPI.sendBranchCloudBulk.mockResolvedValue({
    data: { id: 'text-job', status: 'pending', total: 1, pending: 1, sent: 0 },
  });
  whatsappAPI.sendBranchCloudBulkMedia.mockResolvedValue({
    data: { id: 'media-job', status: 'pending', total: 1, pending: 1, sent: 0 },
  });
  window.confirm = jest.fn(() => true);
  window.open = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:attachment-preview');
  URL.revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: { randomUUID: jest.fn(() => 'whatsflow-ui-key') },
  });
});

async function enterCampaign() {
  await screen.findByPlaceholderText(/Paste here/i);
  fireEvent.change(screen.getByPlaceholderText(/Paste here/i), {
    target: { value: 'Aisha\t0501234567' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Hi/i), {
    target: { value: 'Hello {name}' },
  });
  await waitFor(() => {
    expect(screen.getByText(/Preview: 1 recipient/)).toBeInTheDocument();
  });
  return screen.getByRole('button', { name: /Send 1 message.* to 1/i });
}

function expectNoOutboundSend() {
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  expect(whatsappAPI.sendBranchCloudBulkMedia).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
}

test('a pending availability check and its failure never reuse a sendable session status', async () => {
  const availability = deferred();
  whatsappAPI.getBranchCloudAvailability.mockReturnValueOnce(availability.promise);
  render(<WhatsAppBulkPage />);

  const sendButton = await enterCampaign();
  expect(sendButton).toBeDisabled();
  fireEvent.click(sendButton);
  expectNoOutboundSend();
  expect(window.confirm).not.toHaveBeenCalled();

  await act(async () => {
    availability.reject(new Error('status request failed'));
  });

  await waitFor(() => expect(screen.getByText('API or template not configured')).toBeInTheDocument());
  expect(sendButton).toBeDisabled();
  fireEvent.click(sendButton);
  expectNoOutboundSend();
  expect(window.confirm).not.toHaveBeenCalled();
});

test('a disconnected Whatsflow session cannot queue a campaign', async () => {
  whatsappAPI.getBranchCloudAvailability.mockResolvedValueOnce({
    data: { ...connectedStatus, connected: false },
  });
  render(<WhatsAppBulkPage />);

  const sendButton = await enterCampaign();
  expect(screen.getByText(/Not connected/)).toBeInTheDocument();
  expect(sendButton).toBeDisabled();
  fireEvent.click(sendButton);

  expectNoOutboundSend();
  expect(window.confirm).not.toHaveBeenCalled();
});

test('an exhausted Whatsflow daily quota cannot queue a campaign', async () => {
  whatsappAPI.getBranchCloudAvailability.mockResolvedValueOnce({
    data: { ...connectedStatus, daily_used: 30, daily_remaining: 0 },
  });
  render(<WhatsAppBulkPage />);

  const sendButton = await enterCampaign();
  expect(screen.getByText(/daily Whatsflow quota is exhausted/i)).toBeInTheDocument();
  expect(sendButton).toBeDisabled();
  fireEvent.click(sendButton);

  expectNoOutboundSend();
  expect(window.confirm).not.toHaveBeenCalled();
});

test('a connected Whatsflow session queues personalized text only after confirmation', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<WhatsAppBulkPage />);
  const sendButton = await enterCampaign();

  expect(sendButton).toBeEnabled();
  expectNoOutboundSend();
  await user.click(sendButton);

  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/queued is not sent/i));
  await waitFor(() => expect(whatsappAPI.sendBranchCloudBulk).toHaveBeenCalledWith(
    'branch-a',
    [{ phone: '966501234567', message: 'Hello Aisha', name: 'Aisha' }],
    'whatsflow-ui-key',
    { campaign_id: null, campaign_title: '', branch_name: 'Main' },
  ));
  expect(whatsappAPI.sendBranchCloudBulkMedia).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

test.each([
  ['image', new File(['image'], 'offer.png', { type: 'image/png' })],
  ['PDF', new File(['pdf'], 'terms.pdf', { type: 'application/pdf' })],
])('a connected Whatsflow session accepts a supported %s and queues multipart media', async (_kind, file) => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<WhatsAppBulkPage />);
  await enterCampaign();

  const input = container.querySelector('input[type="file"]');
  expect(input).toHaveAttribute(
    'accept',
    '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf',
  );
  await user.upload(input, file);
  expect(await screen.findByText(file.name)).toBeInTheDocument();

  const sendButton = screen.getByRole('button', { name: /Send 1 message.* to 1/i });
  expect(sendButton).toBeEnabled();
  expectNoOutboundSend();
  await user.click(sendButton);

  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/queued is not sent/i));
  await waitFor(() => expect(whatsappAPI.sendBranchCloudBulkMedia).toHaveBeenCalledTimes(1));
  const [formData, metadata] = whatsappAPI.sendBranchCloudBulkMedia.mock.calls[0];
  expect(JSON.parse(formData.get('recipients_json'))).toEqual([
    { phone: '966501234567', message: 'Hello Aisha', name: 'Aisha' },
  ]);
  expect(formData.get('branch_id')).toBe('branch-a');
  expect(formData.get('idempotency_key')).toBe('whatsflow-ui-key');
  expect(formData.getAll('attachments')).toHaveLength(1);
  expect(formData.getAll('attachments')[0].name).toBe(file.name);
  expect(metadata).toEqual({
    campaign_id: null,
    campaign_title: '',
    branch_name: 'Main',
  });
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});
