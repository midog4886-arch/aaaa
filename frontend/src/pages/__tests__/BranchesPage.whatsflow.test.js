import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockApi = {
  get: jest.fn(),
  put: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
};
const mockBranchesAPI = {
  getWhatsAppCloud: jest.fn(),
  updateWhatsAppCloud: jest.fn(),
  getProviderStatus: jest.fn(),
  getProviderQuality: jest.fn(),
  getProviderQr: jest.fn(),
  testProvider: jest.fn(),
  configureProviderWebhook: jest.fn(),
};
const mockWhatsappAPI = {
  getMetaWebhookInfo: jest.fn(),
};
const mockToast = {
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
};

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: mockApi,
  branchesAPI: mockBranchesAPI,
  whatsappAPI: mockWhatsappAPI,
}));

jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_admin: true } }),
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

jest.mock('sonner', () => ({
  toast: mockToast,
}));

const branches = [
  {
    id: 'branch-a',
    name: 'North Branch',
    name_ar: 'North Branch',
    phone: '0500000001',
    working_days: ['sunday'],
  },
  {
    id: 'branch-b',
    name: 'South Branch',
    name_ar: 'South Branch',
    phone: '0500000002',
    working_days: ['monday'],
  },
];

const whatsflowConfig = (overrides = {}) => ({
  enabled: true,
  provider: 'whatsflow',
  whatsflow_instance: 'south-instance',
  whatsflow_api_key_configured: true,
  waha_daily_limit: 30,
  ...overrides,
});

const BranchesPage = require('../BranchesPage').default;

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn(() => 'blob:whatsflow-qr'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.get.mockImplementation((path) => {
    if (path === '/branches') return Promise.resolve({ data: branches });
    if (path === '/levels') return Promise.resolve({ data: [] });
    throw new Error(`Unexpected GET ${path}`);
  });
  mockApi.put.mockImplementation((_path, data) => Promise.resolve({ data }));
  mockBranchesAPI.getWhatsAppCloud.mockResolvedValue({ data: whatsflowConfig() });
  mockBranchesAPI.updateWhatsAppCloud.mockResolvedValue({ data: {} });
  mockBranchesAPI.getProviderStatus.mockResolvedValue({
    data: { check_ok: true, connected: false, status: 'close' },
  });
  mockBranchesAPI.getProviderQuality.mockResolvedValue({ data: null });
  mockBranchesAPI.getProviderQr.mockResolvedValue({
    data: new Blob(['qr'], { type: 'image/png' }),
  });
  mockBranchesAPI.configureProviderWebhook.mockResolvedValue({ data: {} });
  mockWhatsappAPI.getMetaWebhookInfo.mockResolvedValue({ data: null });
});

async function openSouthBranch() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<BranchesPage />);
  await user.click(await screen.findByTestId('edit-branch-branch-b'));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => {
    expect(within(dialog).getByTestId('whatsapp-provider-select')).toHaveValue('whatsflow');
  });
  return { user, dialog };
}

function inputBesideLabel(dialog, label) {
  const labelNode = within(dialog).getByText(label, { selector: 'label' });
  return labelNode.parentElement.querySelector('input');
}

test('offers Whatsflow and saves branch-scoped INSTANCE/API key without re-exposing the stored key', async () => {
  mockBranchesAPI.getWhatsAppCloud
    .mockResolvedValueOnce({
      data: whatsflowConfig({
        whatsflow_instance: '',
        whatsflow_api_key_configured: false,
      }),
    })
    .mockResolvedValueOnce({ data: whatsflowConfig() });

  const { user, dialog } = await openSouthBranch();
  const providerSelect = within(dialog).getByTestId('whatsapp-provider-select');
  expect(within(providerSelect).getByRole('option', { name: 'Whatsflow API' })).toHaveValue('whatsflow');

  const instanceInput = inputBesideLabel(dialog, 'Whatsflow INSTANCE');
  const keyInput = inputBesideLabel(dialog, 'API key');
  await user.clear(instanceInput);
  await user.type(instanceInput, 'south-instance');
  await user.type(keyInput, 'top-secret-value');
  await user.click(within(dialog).getByTestId('save-branch-btn'));

  await waitFor(() => {
    expect(mockApi.put).toHaveBeenCalledWith('/branches/branch-b', expect.any(Object));
    expect(mockBranchesAPI.updateWhatsAppCloud).toHaveBeenCalledWith(
      'branch-b',
      expect.objectContaining({
        provider: 'whatsflow',
        whatsflow_instance: 'south-instance',
        whatsflow_api_key: 'top-secret-value',
      }),
    );
  });
  expect(mockBranchesAPI.updateWhatsAppCloud).not.toHaveBeenCalledWith(
    'branch-a',
    expect.anything(),
  );

  await user.click(await screen.findByTestId('edit-branch-branch-b'));
  const reopenedDialog = await screen.findByRole('dialog');
  const reopenedKey = inputBesideLabel(reopenedDialog, 'API key');
  expect(reopenedKey).toHaveAttribute('type', 'password');
  expect(reopenedKey).toHaveValue('');
  expect(reopenedKey).toHaveAttribute('placeholder', '•••••••• (configured)');
  expect(screen.queryByDisplayValue('top-secret-value')).not.toBeInTheDocument();
});

test('refreshes the selected branch and renders a genuine disconnected state', async () => {
  const { user, dialog } = await openSouthBranch();
  await user.click(within(dialog).getByRole('button', { name: 'Refresh status' }));

  expect(await within(dialog).findByText('Not connected')).toBeInTheDocument();
  expect(within(dialog).queryByText('Could not verify connection')).not.toBeInTheDocument();
  expect(mockBranchesAPI.getProviderStatus).toHaveBeenCalledWith('branch-b');
  expect(mockBranchesAPI.getProviderQuality).toHaveBeenCalledWith('branch-b');
  expect(mockToast.success).toHaveBeenCalledWith('Provider status refreshed');
});

test('does not misreport an unknown provider check as disconnected and exposes the error', async () => {
  mockBranchesAPI.getProviderStatus.mockResolvedValue({
    data: {
      check_ok: false,
      connected: null,
      status: 'unknown',
      error: 'http_401',
    },
  });
  const { user, dialog } = await openSouthBranch();
  await user.click(within(dialog).getByRole('button', { name: 'Refresh status' }));

  expect(await within(dialog).findByText('Could not verify connection')).toBeInTheDocument();
  expect(within(dialog).queryByText('Not connected')).not.toBeInTheDocument();
  expect(within(dialog).getByText(/Review the API key/)).toBeInTheDocument();
  expect(mockToast.error).toHaveBeenCalledWith(
    'The provider denied the check. Review the API key and its permissions.',
  );
});

test('shows a QR returned for the selected branch', async () => {
  const { user, dialog } = await openSouthBranch();
  await user.click(within(dialog).getByRole('button', { name: 'Show QR' }));

  const qr = await within(dialog).findByRole('img', { name: 'Whatsflow QR' });
  expect(qr).toHaveAttribute('src', 'blob:whatsflow-qr');
  expect(mockBranchesAPI.getProviderStatus).toHaveBeenCalledWith('branch-b');
  expect(mockBranchesAPI.getProviderQr).toHaveBeenCalledWith('branch-b');
  expect(URL.createObjectURL).toHaveBeenCalled();
});

test('reports QR retrieval errors instead of displaying a broken image', async () => {
  mockBranchesAPI.getProviderQr.mockRejectedValue({
    response: { data: { detail: 'QR is temporarily unavailable' } },
  });
  const { user, dialog } = await openSouthBranch();
  await user.click(within(dialog).getByRole('button', { name: 'Show QR' }));

  await waitFor(() => {
    expect(mockToast.error).toHaveBeenCalledWith('QR is temporarily unavailable');
  });
  expect(within(dialog).queryByRole('img', { name: 'Whatsflow QR' })).not.toBeInTheDocument();
});

test('configures the webhook only for the edited branch and confirms success', async () => {
  const { user, dialog } = await openSouthBranch();
  await user.click(within(dialog).getByRole('button', { name: 'Configure webhook' }));

  await waitFor(() => {
    expect(mockBranchesAPI.configureProviderWebhook).toHaveBeenCalledWith('branch-b');
    expect(mockToast.success).toHaveBeenCalledWith('Webhook configured');
  });
  expect(mockBranchesAPI.configureProviderWebhook).not.toHaveBeenCalledWith('branch-a');
});

test('surfaces the provider webhook setup error', async () => {
  mockBranchesAPI.configureProviderWebhook.mockRejectedValue({
    response: { data: { detail: 'Webhook destination rejected' } },
  });
  const { user, dialog } = await openSouthBranch();
  await user.click(within(dialog).getByRole('button', { name: 'Configure webhook' }));

  await waitFor(() => {
    expect(mockToast.error).toHaveBeenCalledWith('Webhook destination rejected');
  });
});