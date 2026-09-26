import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WhatsAppCampaignReport, { recipientState } from './WhatsAppCampaignReport';

jest.mock('../services/api', () => ({
  whatsappAPI: {
    getBranchCloudJobReport: jest.fn(),
    downloadBranchCloudJobReport: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));

const { whatsappAPI } = require('../services/api');

const report = {
  job: {
    id: 'job-1',
    campaign_name: 'June welcome',
    branch_name: 'Main branch',
    created_at: '2026-06-01T10:00:00Z',
  },
  summary: {
    total: 3,
    pending: 1,
    accepted: 1,
    delivered: 1,
    read: 0,
    failed: 0,
    unknown: 0,
    cancelled: 0,
  },
  recipients: [
    { id: 'r-1', name: 'Aisha', phone: '***0001', status: 'processing' },
    { id: 'r-2', name: 'Omar', phone: '***0002', status: 'sent' },
    { id: 'r-3', name: 'Sara', phone: '***0003', status: 'sent', delivery_status: 'delivered', delivered_at: '2026-06-01T10:03:00Z' },
  ],
  notes: ['Delivery receipts are still arriving.'],
};

beforeEach(() => {
  jest.clearAllMocks();
  whatsappAPI.getBranchCloudJobReport.mockResolvedValue({ data: report });
  whatsappAPI.downloadBranchCloudJobReport.mockResolvedValue({
    data: new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    headers: { 'content-disposition': 'attachment; filename="campaign.xlsx"' },
  });
  URL.createObjectURL = jest.fn(() => 'blob:campaign-report');
  URL.revokeObjectURL = jest.fn();
});

test.each(['accepted', 'delivered', 'read', 'failed'])(
  'a partial attachment group stays partial with a %s receipt',
  delivery_status => {
    expect(recipientState({ status: 'partial', delivery_status })).toBe('partial');
  },
);

test('partial recipients with one read attachment do not enter the read filter', async () => {
  const user = userEvent.setup();
  whatsappAPI.getBranchCloudJobReport.mockResolvedValue({ data: {
    ...report,
    recipients: [{ id: 'partial-1', name: 'Partial recipient', status: 'partial', delivery_status: 'read' }],
  } });
  render(<WhatsAppCampaignReport branchId="branch-1" job={{ id: 'job-1' }} open onOpenChange={jest.fn()} language="en" />);
  const row = (await screen.findByText('Partial recipient')).closest('tr');
  expect(within(row).getByText('Partial')).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'read');
  expect(screen.queryByText('Partial recipient')).not.toBeInTheDocument();
});

test('loads summary, timestamps, masked recipients, and receipt-aware states', async () => {
  render(
    <WhatsAppCampaignReport
      branchId="branch-1"
      job={{ id: 'job-1' }}
      open
      onOpenChange={jest.fn()}
      language="en"
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Loading report');
  expect(await screen.findByTestId('report-summary-total')).toHaveTextContent('3');
  expect(screen.getByText('June welcome')).toBeInTheDocument();
  expect(screen.getByText(/Main branch/)).toBeInTheDocument();
  expect(screen.getByTestId('report-timestamps')).toHaveTextContent('Created');
  expect(screen.getByText('***0001')).toBeInTheDocument();
  expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Unconfirmed').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
  expect(screen.getByText('Delivery receipts are still arriving.')).toBeInTheDocument();
  expect(whatsappAPI.getBranchCloudJobReport).toHaveBeenCalledWith('branch-1', 'job-1');
});

test('search and status filter operate on normalized partial recipient states', async () => {
  const user = userEvent.setup();
  render(
    <WhatsAppCampaignReport
      branchId="branch-1"
      job={{ id: 'job-1' }}
      open
      onOpenChange={jest.fn()}
      language="en"
    />,
  );
  await screen.findByTestId('report-summary-total');

  const table = screen.getByRole('table');
  expect(within(table).getByText('Aisha')).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'pending');
  expect(within(table).getByText('Aisha')).toBeInTheDocument();
  expect(within(table).queryByText('Omar')).not.toBeInTheDocument();

  await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'all');
  await user.type(screen.getByRole('textbox', { name: 'Search recipients' }), 'Sara');
  expect(within(table).getByText('Sara')).toBeInTheDocument();
  expect(within(table).queryByText('Aisha')).not.toBeInTheDocument();
});

test('downloads an authenticated Excel blob through the API service', async () => {
  const user = userEvent.setup();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(
    <WhatsAppCampaignReport
      branchId="branch-1"
      job={{ id: 'job-1' }}
      open
      onOpenChange={jest.fn()}
      language="en"
    />,
  );
  await screen.findByTestId('report-summary-total');
  await user.click(screen.getByRole('button', { name: 'Download Excel report' }));

  await waitFor(() => expect(whatsappAPI.downloadBranchCloudJobReport).toHaveBeenCalledWith('branch-1', 'job-1'));
  expect(URL.createObjectURL).toHaveBeenCalled();
  expect(click).toHaveBeenCalled();
  click.mockRestore();
});

test('renders an actionable error instead of crashing when report loading fails', async () => {
  whatsappAPI.getBranchCloudJobReport.mockRejectedValueOnce({
    response: { data: { detail: 'Report is not ready yet' } },
  });
  render(
    <WhatsAppCampaignReport
      branchId="branch-1"
      job={{ id: 'job-1' }}
      open
      onOpenChange={jest.fn()}
      language="en"
    />,
  );

  expect(await screen.findByRole('alert')).toHaveTextContent('Report is not ready yet');
  expect(screen.queryByTestId('report-summary-total')).not.toBeInTheDocument();
});

test('shows a clear empty state when the report has no recipients', async () => {
  whatsappAPI.getBranchCloudJobReport.mockResolvedValueOnce({
    data: {
      job: { id: 'job-1', campaign_name: 'Empty campaign' },
      summary: { total: 0, pending: 0, accepted: 0, delivered: 0, read: 0, failed: 0, unknown: 0, cancelled: 0 },
      recipients: [],
      notes: [],
    },
  });
  render(
    <WhatsAppCampaignReport
      branchId="branch-1"
      job={{ id: 'job-1' }}
      open
      onOpenChange={jest.fn()}
      language="en"
    />,
  );

  expect(await screen.findByTestId('report-empty')).toHaveTextContent('No recipients in this report');
});
