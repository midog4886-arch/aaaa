import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import RegistrationRequestsPage from './RegistrationRequestsPage';
import { branchesAPI, registrationRequestsAPI } from '../services/api';

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { is_admin: true, permissions: ['member-phones'] },
  }),
}));
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('../components/Layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));
jest.mock('../components/ui/card', () => ({
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
}));
jest.mock('../components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../components/ui/select', () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children }) => <div>{children}</div>,
  SelectTrigger: ({ children }) => <div>{children}</div>,
  SelectValue: ({ children }) => <span>{children}</span>,
}));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg /> }));
jest.mock('../utils/publicUrl', () => ({ getPublicBaseUrl: () => 'https://example.test' }));
jest.mock('../utils/whatsapp', () => ({ whatsappChatUrl: phone => `https://wa.me/${phone}` }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../components/RegistrationFollowup', () => () => null);
jest.mock('lucide-react', () => {
  const Icon = ({ children, ...props }) => <span {...props}>{children}</span>;
  return {
    Loader2: Icon, Phone: Icon, Calendar: Icon, Clock: Icon, Trash2: Icon,
    FileText: Icon, Link2: Icon, Copy: Icon, QrCode: Icon, Inbox: Icon,
    UserPlus: Icon, Globe: Icon, CheckCircle2: Icon, Megaphone: Icon,
    Download: Icon, Search: Icon, X: Icon, Archive: Icon, ArchiveRestore: Icon,
    ExternalLink: Icon,
  };
});
jest.mock('../services/api', () => ({
  branchesAPI: { getAll: jest.fn() },
  registrationRequestsAPI: {
    getAll: jest.fn(),
    updateStatus: jest.fn(),
    delete: jest.fn(),
    stopFollowup: jest.fn(),
  },
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('loads the server-filtered followed-up tab and shows both evidence badges', async () => {
  branchesAPI.getAll.mockResolvedValue({ data: [] });
  const followed = [{
    id: 'request-both',
    status: 'processed',
    customer_name: 'سارة',
    customer_phone: '0501234567',
    followup_staff_contacted: true,
    followup_staff_contacted_at: '2026-01-03T08:00:00Z',
    followup_automatic_sent: true,
    followup_automatic_sent_at: '2026-01-03T09:00:00Z',
  }];
  registrationRequestsAPI.getAll.mockImplementation(({ status }) => Promise.resolve({
    data: status === 'followed_up' ? followed : [],
  }));

  render(<RegistrationRequestsPage />);
  await waitFor(() => expect(registrationRequestsAPI.getAll).toHaveBeenCalledWith({ status: 'pending' }));
  fireEvent.click(screen.getByTestId('req-status-filter-followed_up'));

  await waitFor(() => {
    expect(registrationRequestsAPI.getAll).toHaveBeenLastCalledWith({ status: 'followed_up' });
    expect(screen.getByTestId('badge-followup-staff-request-both')).toBeTruthy();
    expect(screen.getByTestId('badge-followup-automatic-request-both')).toBeTruthy();
  });
});

test('offers every same-phone member choice and opens the selected member', async () => {
  branchesAPI.getAll.mockResolvedValue({ data: [] });
  registrationRequestsAPI.getAll.mockImplementation(({ status }) => Promise.resolve({
    data: status === 'archived' ? [{
      id: 'archived-family',
      status: 'archived',
      archived_reason: 'member_phone_match_same_branch',
      customer_name: 'ولي الأمر',
      customer_phone: '0501234567',
      created_at: '2026-01-03T09:00:00Z',
      matching_members: [
        { id: 'member-one', name: 'سارة', code: 'M-1' },
        { id: 'member/two', name: 'محمد', code: 'M-2' },
      ],
    }] : [],
  }));

  render(<RegistrationRequestsPage />);
  fireEvent.click(screen.getByTestId('req-status-filter-archived'));

  await waitFor(() => {
    expect(screen.getByTestId('open-matching-member-member-one')).toBeTruthy();
    expect(screen.getByTestId('open-matching-member-member/two')).toBeTruthy();
  });
  fireEvent.click(screen.getByTestId('open-matching-member-member/two'));
  expect(mockNavigate).toHaveBeenCalledWith('/admin/members?focus=member%2Ftwo');
});