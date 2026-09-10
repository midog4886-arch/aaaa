import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
});

const deferred = () => {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

test('renders with exhausted session quota and loads a saved draft without sending', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const WhatsAppBulkPage = require('../WhatsAppBulkPage').default;
  render(<WhatsAppBulkPage />);

  const draftButton = await screen.findByRole('button', { name: /Welcome draft/i });
  await user.click(draftButton);

  await waitFor(() => expect(whatsappAPI.getCampaign).toHaveBeenCalledWith('campaign-1', 'branch-a'));
  expect(screen.getByDisplayValue('Welcome draft')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Hello {name}')).toBeInTheDocument();
  expect(screen.getByText(/Preview: 1 recipient/)).toBeInTheDocument();
  expect(screen.getByText(/advisory only/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Automatically send to 1/i })).toBeDisabled();
  expect(whatsappAPI.sendBranchCloudBulk).not.toHaveBeenCalled();
  expect(whatsappAPI.sendBranchCloudBulkMedia).not.toHaveBeenCalled();
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
  expect(screen.getByRole('button', { name: /Automatically send to 0/i })).toBeDisabled();
});