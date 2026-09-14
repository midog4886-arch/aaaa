import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import CampaignInquiriesPage from './CampaignInquiriesPage';
import { branchesAPI, campaignInquiriesAPI } from '../services/api';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { is_admin: true, permissions: ['messages', 'member-phones'] }, selectedBranchId: 'b1' }) }));
jest.mock('../components/Layout', () => ({ Layout: ({ children }) => <div>{children}</div> }));
jest.mock('../components/ui/card', () => ({ Card: ({ children }) => <div>{children}</div>, CardContent: ({ children }) => <div>{children}</div> }));
jest.mock('../components/ui/button', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock('../utils/whatsapp', () => ({ whatsappChatUrl: p => `https://wa.me/${p}` }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('lucide-react', () => {
  const I = () => <span />;
  return { Archive:I, CalendarClock:I, ChevronDown:I, ClipboardPlus:I, MessageCircle:I, Pencil:I, Phone:I, Plus:I, Search:I, Users:I };
});
jest.mock('../services/api', () => ({ branchesAPI: { getAll: jest.fn() }, campaignInquiriesAPI: { getAll: jest.fn(), create: jest.fn(), preview: jest.fn(), import: jest.fn(), update: jest.fn(), delete: jest.fn() } }));

const inquiry = { id: 'i1', branch_id: 'b1', name: 'ليان', phone: '966501234567', source: 'social_ad', status: 'new', notes: '' };
beforeEach(() => {
  branchesAPI.getAll.mockResolvedValue({ data: [{ id: 'b1', name_ar: 'فرع العليا' }] });
  campaignInquiriesAPI.getAll.mockResolvedValue({ data: { items: [inquiry], counts: { total: 1 } } });
  window.open = jest.fn();
});
afterEach(() => { cleanup(); jest.clearAllMocks(); });

test('opening a personal WhatsApp chat does not mutate or log contact', async () => {
  render(<CampaignInquiriesPage />);
  await screen.findByText('ليان');
  fireEvent.click(screen.getByText('تجهيز واتساب'));
  fireEvent.click(await screen.findByText('فتح المحادثة'));
  expect(window.open).toHaveBeenCalledWith('https://wa.me/966501234567', '_blank', 'noopener,noreferrer');
  expect(campaignInquiriesAPI.update).not.toHaveBeenCalled();
});

test('do-not-contact suppresses phone actions', async () => {
  campaignInquiriesAPI.getAll.mockResolvedValue({ data: { items: [{ ...inquiry, status: 'do_not_contact' }], counts: {} } });
  render(<CampaignInquiriesPage />);
  await screen.findByText('لا تتواصل');
  expect(screen.queryByText('فتح واتساب')).toBeNull();
  expect(screen.queryByText('تسجيل تواصل')).toBeNull();
});

test('bulk import requires preview and imports only after explicit action', async () => {
  campaignInquiriesAPI.preview.mockResolvedValue({ data: { valid_count: 1, invalid_count: 1, duplicate_count: 0, rows: [] } });
  campaignInquiriesAPI.import.mockResolvedValue({ data: { created: 1, duplicates: 0, invalid: 1 } });
  render(<CampaignInquiriesPage />);
  await screen.findByText('ليان');
  fireEvent.click(screen.getByText('لصق أرقام'));
  const phones = await screen.findByPlaceholderText(/9665xxxxxxxx/);
  fireEvent.change(phones, { target: { value: '966501234567\nnope' } });
  fireEvent.click(screen.getByText('معاينة الأرقام'));
  await screen.findByText(/صالح 1/);
  expect(campaignInquiriesAPI.import).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('استيراد الأرقام الصالحة فقط'));
  await waitFor(() => expect(campaignInquiriesAPI.import).toHaveBeenCalled());
});

test('creates one inquiry against the active branch', async () => {
  campaignInquiriesAPI.create.mockResolvedValue({ data: { id: 'i2' } });
  render(<CampaignInquiriesPage />);
  await screen.findByText('ليان');
  fireEvent.click(screen.getByText('إضافة استفسار'));
  const fields = screen.getAllByRole('textbox');
  fireEvent.change(fields[1], { target: { value: 'مها' } });
  fireEvent.change(fields[2], { target: { value: '966509999999' } });
  fireEvent.click(screen.getByText('حفظ'));
  await waitFor(() => expect(campaignInquiriesAPI.create).toHaveBeenCalledWith(expect.objectContaining({
    branch_id: 'b1', name: 'مها', phone: '966509999999',
  })));
});

test('contact logging saves the selected next follow-up explicitly', async () => {
  campaignInquiriesAPI.update.mockResolvedValue({ data: inquiry });
  render(<CampaignInquiriesPage />);
  await screen.findByText('ليان');
  fireEvent.click(screen.getByText('تسجيل تواصل'));
  fireEvent.click(screen.getByText('اقتراح بعد 24 ساعة'));
  fireEvent.click(screen.getByText('حفظ تسجيل التواصل'));
  await waitFor(() => expect(campaignInquiriesAPI.update).toHaveBeenCalledWith('i1', expect.objectContaining({
    last_contact_at: expect.any(String), followup_due_at: expect.any(String),
  })));
});