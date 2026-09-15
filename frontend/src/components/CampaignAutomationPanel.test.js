import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CampaignAutomationPanel from './CampaignAutomationPanel';

jest.mock('./ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const inquiry = { id: 'i1', branch_id: 'b1', name: 'ليان', phone: '966501234567', status: 'new' };
const settings = { available: true, enabled: true, paused: false, start_hour: 9, end_hour: 21, timezone: 'Asia/Riyadh' };

const makeApi = () => ({
  previewAutomation: jest.fn(),
  confirmAutomation: jest.fn(),
  updateAutomationSettings: jest.fn(),
  stopAutomation: jest.fn(),
});

const Harness = ({ api, branch = 'b1', available = true, providerAvailable = available, statusMap = {}, onSettingsChange = jest.fn() }) => {
  const [selected, setSelected] = useState([]);
  const [currentSettings, setCurrentSettings] = useState({ ...settings, available: providerAvailable });
  return (
    <CampaignAutomationPanel
      api={api}
      branch={branch}
      items={[inquiry]}
      settings={currentSettings}
      statusMap={statusMap}
      canAutomate={available}
      selectedIds={selected}
      onSelectedIdsChange={setSelected}
      onSettingsChange={value => {
        setCurrentSettings(value);
        onSettingsChange(value);
      }}
      filterKey={branch}
    >
      {({ selectionControl, directButton, stopButton, statusSummary }) => (
        <div>
          {selectionControl}
          {directButton}
          {stopButton}
          {statusSummary}
          <span>التجهيز اليدوي متاح</span>
        </div>
      )}
    </CampaignAutomationPanel>
  );
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('direct automation requires a preview and an explicit confirmation', async () => {
  const api = makeApi();
  api.previewAutomation.mockResolvedValue({
    data: {
      preview_id: 'preview-direct',
      eligible_count: 1,
      recipients: [{ id: 'i1', name: 'ليان', eligible: true }],
    },
  });
  api.confirmAutomation.mockResolvedValue({ data: { accepted: 1, skipped: 0 } });
  render(<Harness api={api} />);

  fireEvent.click(screen.getByText('إرسال آلي مباشر'));
  expect(api.previewAutomation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('معاينة الإرسال'));
  await waitFor(() => expect(api.previewAutomation).toHaveBeenCalledWith(expect.objectContaining({
    branch_id: 'b1',
    inquiry_ids: ['i1'],
    mode: 'direct',
  })));
  expect(api.confirmAutomation).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByText('تأكيد الإرسال'));
  await waitFor(() => expect(api.confirmAutomation).toHaveBeenCalledWith({
    branch_id: 'b1',
    preview_id: 'preview-direct',
  }));
});

test('follow-up enrollment requires opt-in, previews all recipients, then confirms', async () => {
  const api = makeApi();
  api.previewAutomation.mockResolvedValue({
    data: {
      preview_id: 'preview-followup',
      eligible_count: 1,
      first_due_at: '2026-01-02T08:00:00Z',
      second_due_at: '2026-01-04T08:00:00Z',
      recipients: [
        { id: 'i1', name: 'ليان', eligible: true },
        { id: 'blocked', name: 'محجوب', eligible: false, reason: 'لا يرغب بالتواصل' },
      ],
    },
  });
  api.confirmAutomation.mockResolvedValue({ data: { accepted: 1, skipped: 1 } });
  render(<Harness api={api} />);

  fireEvent.click(screen.getByLabelText('اختيار ليان'));
  fireEvent.click(screen.getByText(/تفعيل المتابعة الآلية/));
  fireEvent.click(screen.getByText('معاينة الإرسال'));
  await waitFor(() => expect(api.previewAutomation).toHaveBeenCalledWith(expect.objectContaining({
    branch_id: 'b1',
    inquiry_ids: ['i1'],
    mode: 'followup',
    first_message: expect.any(String),
    second_message: expect.any(String),
  })));
  expect(screen.getByText(/مستبعد/)).toBeTruthy();
  expect(api.confirmAutomation).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByText('تأكيد تفعيل المتابعة'));
  await waitFor(() => expect(api.confirmAutomation).toHaveBeenCalledWith({
    branch_id: 'b1',
    preview_id: 'preview-followup',
  }));
});

test('branch changes invalidate an open automation preview', async () => {
  const api = makeApi();
  api.previewAutomation.mockResolvedValue({
    data: { preview_id: 'preview-stale', eligible_count: 1, recipients: [{ id: 'i1', eligible: true }] },
  });
  const view = render(<Harness api={api} />);
  fireEvent.click(screen.getByText('إرسال آلي مباشر'));
  fireEvent.click(screen.getByText('معاينة الإرسال'));
  await screen.findByText('تأكيد الإرسال');
  view.rerender(<Harness api={api} branch="b2" />);
  expect(screen.queryByText('تأكيد الإرسال')).toBeNull();
  expect(screen.queryByText('معاينة الإرسال')).toBeNull();
});

test('provider disconnect keeps status, stop, and pause controls while gating new work', async () => {
  const api = makeApi();
  api.updateAutomationSettings.mockResolvedValue({ data: { ...settings, available: false, paused: true } });
  api.stopAutomation.mockResolvedValue({ data: { accepted: true } });
  render(<Harness
    api={api}
    providerAvailable={false}
    statusMap={{ i1: { inquiry_id: 'i1', status: 'scheduled', job_status: 'accepted', delivery_status: 'unknown', next_due_at: '2026-01-03T08:00:00Z' } }}
  />);
  expect(screen.getByText('التجهيز اليدوي متاح')).toBeTruthy();
  expect(screen.queryByText('إرسال آلي مباشر')).toBeNull();
  expect(screen.queryByText('تفعيل المتابعة الآلية')).toBeNull();
  expect(screen.queryByText('الساعات: 9:00–21:00 بتوقيت السعودية.')).toBeNull();
  expect(screen.getByText('واتساب الآلي للاستفسارات')).toBeTruthy();
  expect(screen.getByText(/المتابعة: مجدولة/)).toBeTruthy();
  expect(screen.getByText('إعدادات ساعات الإرسال')).toBeTruthy();
  expect(screen.getByText('إيقاف الإرسال الآلي')).toBeTruthy();
  expect(screen.getByText('إيقاف المتابعة الآلية')).toBeTruthy();
  fireEvent.click(screen.getByText('إيقاف الإرسال الآلي'));
  fireEvent.click(screen.getByText('تأكيد الإيقاف وحفظ الإعدادات'));
  await waitFor(() => expect(api.updateAutomationSettings).toHaveBeenCalledWith(expect.objectContaining({
    branch_id: 'b1',
    paused: true,
  })));
  fireEvent.click(screen.getByText('إيقاف المتابعة الآلية'));
  fireEvent.change(screen.getByLabelText('سبب الإيقاف'), { target: { value: 'طلب العميل' } });
  fireEvent.click(screen.getByText('تأكيد الإيقاف'));
  await waitFor(() => expect(api.stopAutomation).toHaveBeenCalledWith('i1'));
});

test('pause settings and per-person stop use explicit confirmation flows', async () => {
  const api = makeApi();
  api.updateAutomationSettings.mockResolvedValue({
    data: { ...settings, paused: true, start_hour: 10, end_hour: 20 },
  });
  api.stopAutomation.mockResolvedValue({ data: { accepted: true } });
  render(<Harness api={api} statusMap={{ i1: { inquiry_id: 'i1', status: 'active', job_status: 'accepted', delivery_status: 'unknown' } }} />);

  fireEvent.click(screen.getByText('إيقاف الإرسال الآلي'));
  expect(api.updateAutomationSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('تأكيد الإيقاف وحفظ الإعدادات'));
  await waitFor(() => expect(api.updateAutomationSettings).toHaveBeenCalledWith(expect.objectContaining({
    branch_id: 'b1',
    paused: true,
    start_hour: 9,
    end_hour: 21,
  })));
  fireEvent.click(screen.getByText('إيقاف المتابعة الآلية'));
  fireEvent.change(screen.getByLabelText('سبب الإيقاف'), { target: { value: 'طلب العميل' } });
  fireEvent.click(screen.getByText('تأكيد الإيقاف'));
  await waitFor(() => expect(api.stopAutomation).toHaveBeenCalledWith('i1'));
});