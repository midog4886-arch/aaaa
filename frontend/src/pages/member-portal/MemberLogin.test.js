import React from 'react';
import { render, waitFor, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import MemberLogin from './MemberLogin';
import AcademyPickerPage from '../AcademyPickerPage';

jest.mock('axios', () => ({ post: jest.fn() }));

jest.mock('../../services/branding', () => ({
  getAcademyLogoUrl: () => '',
  getAcademyName: () => '',
  loadBranding: () => Promise.resolve(),
  useBrandColor: () => '#176b5b',
}));

jest.mock('framer-motion', () => {
  const Plain = ({ children, ...props }) => <div {...props}>{children}</div>;
  return {
    motion: { div: Plain, p: Plain },
    AnimatePresence: ({ children }) => <>{children}</>,
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  jest.clearAllMocks();
});

test('member login submits values supplied by native autofill without change events', async () => {
  localStorage.setItem('tenant_slug', 'academy-one');
  localStorage.setItem('member_login_phone:academy-one', '0500000000');
  axios.post.mockResolvedValueOnce({ data: { access_token: 'test-token', member: { name_ar: 'Test' } } });
  render(<MemoryRouter><MemberLogin /></MemoryRouter>);
  screen.getByTestId('member-phone-input').value = '0551234567';
  screen.getByTestId('member-code-input').value = 'ACA-321';
  fireEvent.click(screen.getByTestId('member-login-btn'));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/member-portal/login'),
    { phone: '0551234567', member_code: 'ACA-321' },
    { headers: { 'X-Tenant-Slug': 'academy-one' }, timeout: 15000 },
  ));
});

test('picker continue reads native autofill values and uses a bounded request', async () => {
  axios.post.mockResolvedValueOnce({ data: { matches: [] } });
  render(<MemoryRouter><AcademyPickerPage /></MemoryRouter>);
  screen.getByTestId('academy-picker-code').value = 'ACA-321';
  screen.getByTestId('academy-picker-phone').value = '0551234567';
  fireEvent.click(screen.getByTestId('academy-picker-continue'));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/public/lookup-academy'),
    { member_code: 'ACA-321', phone: '0551234567' }, { timeout: 15000 },
  ));
  expect(await screen.findByText(/البيانات غير صحيحة/)).toBeInTheDocument();
  expect(screen.getByTestId('academy-picker-code').value).toBe('ACA-321');
  expect(screen.getByTestId('academy-picker-phone').value).toBe('0551234567');
});

test('member login retains filled fields on timeout and offers help', async () => {
  localStorage.setItem('member_login_phone:default', '0551234567');
  axios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
  render(<MemoryRouter><MemberLogin /></MemoryRouter>);
  fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'ACA-321' } });
  fireEvent.click(screen.getByTestId('member-login-btn'));
  expect(await screen.findByRole('alert')).toHaveTextContent('استغرق الاتصال وقتًا طويلًا');
  expect(screen.getByTestId('member-code-input')).toHaveValue('ACA-321');
  expect(screen.getByTestId('member-login-btn')).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'تواجه مشكلة في الدخول؟' }));
  expect(screen.getByRole('link', { name: 'فتح الدخول في المتصفح' })).toHaveAttribute('href', 'https://adaa-alabtal.com/member-login?tenant=default');
});

test('saving member identity requires explicit consent and stays scoped to academy', async () => {
  localStorage.setItem('tenant_slug', 'academy-one');
  localStorage.setItem('member_login_phone:academy-one', '0551234567');
  axios.post.mockResolvedValue({ data: { access_token: 'test-token', member: { name_ar: 'Test' } } });
  render(<MemoryRouter><MemberLogin /></MemoryRouter>);
  const consent = screen.getByRole('checkbox', { name: 'تذكر رقم العضوية والجوال على هذا الجهاز' });
  expect(consent).not.toBeChecked();
  fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'ACA-321' } });
  fireEvent.click(screen.getByTestId('member-login-btn'));
  await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByTestId('member-login-btn')).not.toBeDisabled());
  expect(localStorage.getItem('member_login_identity:academy-one')).toBeNull();
  fireEvent.click(consent);
  fireEvent.click(screen.getByTestId('member-login-btn'));
  await waitFor(() => expect(JSON.parse(localStorage.getItem('member_login_identity:academy-one'))).toEqual({ code: 'ACA-321', phone: '0551234567' }));
  expect(localStorage.getItem('member_login_identity:default')).toBeNull();
  fireEvent.click(consent);
  expect(localStorage.getItem('member_login_identity:academy-one')).toBeNull();
});

test('saved identity prefills but does not automatically authenticate', () => {
  localStorage.setItem('member_login_phone:default', '0551234567');
  localStorage.setItem('member_login_identity:default', JSON.stringify({ code: 'ACA-321', phone: '0551234567' }));
  render(<MemoryRouter><MemberLogin /></MemoryRouter>);
  expect(screen.getByTestId('member-code-input')).toHaveValue('ACA-321');
  expect(axios.post).not.toHaveBeenCalled();
});

test('picker exposes a retry after a connection timeout', async () => {
  axios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
  render(<MemoryRouter><AcademyPickerPage /></MemoryRouter>);
  fireEvent.change(screen.getByTestId('academy-picker-code'), { target: { value: 'ACA-321' } });
  fireEvent.change(screen.getByTestId('academy-picker-phone'), { target: { value: '0551234567' } });
  fireEvent.click(screen.getByTestId('academy-picker-continue'));
  expect(await screen.findByText('تعذّر الاتصال بالخادم، حاول مرة أخرى.')).toBeInTheDocument();
  expect(screen.getByTestId('academy-picker-continue')).not.toBeDisabled();
});

test('tenant query clears another academy session without using its cached phone', async () => {
  localStorage.setItem('tenant_slug', 'academy-old');
  localStorage.setItem('member_token', 'old-token');
  localStorage.setItem('member_data', '{"name_ar":"Old member"}');
  localStorage.setItem('member_language', 'en');
  localStorage.setItem('member_login_phone', '0500000000');
  localStorage.setItem('member_login_phone:academy-old', '0500000000');

  render(
    <MemoryRouter initialEntries={['/member-login?tenant=academy-new']}>
      <MemberLogin />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(localStorage.getItem('tenant_slug')).toBe('academy-new');
  });
  expect(localStorage.getItem('member_token')).toBeNull();
  expect(localStorage.getItem('member_data')).toBeNull();
  expect(localStorage.getItem('member_language')).toBeNull();
  expect(axios.post).not.toHaveBeenCalled();
});

test('remembered phone alone never logs in without the member code', async () => {
  localStorage.setItem('tenant_slug', 'academy-one');
  localStorage.setItem('member_login_phone:academy-one', '0500000000');
  render(<MemoryRouter initialEntries={['/member-login']}><MemberLogin /></MemoryRouter>);
  expect(screen.getByTestId('member-phone-input').value).toBe('0500000000');
  fireEvent.click(screen.getByTestId('member-login-btn'));
  expect(axios.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'ACA-123' } });
  fireEvent.click(screen.getByTestId('member-login-btn'));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/member-portal/login'),
    { phone: '0500000000', member_code: 'ACA-123' },
    { headers: { 'X-Tenant-Slug': 'academy-one' }, timeout: 15000 },
  ));
});

test('picker passes verified code and phone only for this navigation', async () => {
  localStorage.setItem('tenant_slug', 'academy-two');
  axios.post.mockResolvedValueOnce({
    data: { access_token: 'test-token', member: { name_ar: 'Test', language: 'ar' } },
  });
  render(<MemoryRouter initialEntries={[{
    pathname: '/member-login',
    state: { verifiedMemberCode: 'ACA-456', verifiedPhone: '0511111111' },
  }]}><MemberLogin /></MemoryRouter>);
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/api/member-portal/login'),
    { phone: '0511111111', member_code: 'ACA-456' },
    { headers: { 'X-Tenant-Slug': 'academy-two' }, timeout: 15000 },
  ));
  expect(localStorage.getItem('member_login_code:academy-two')).toBeNull();
});

test('academy picker clears another member session and carries verified identity to login', async () => {
  localStorage.setItem('tenant_slug', 'academy-two');
  localStorage.setItem('member_token', 'previous-member');
  axios.post.mockResolvedValueOnce({ data: { matches: [{ tenant_slug: 'academy-two', academy_name: 'Test' }] } })
    .mockResolvedValueOnce({ data: { access_token: 'new-member', member: { name_ar: 'New member' } } });
  render(
    <MemoryRouter initialEntries={['/academy-picker']}>
      <Routes>
        <Route path="/academy-picker" element={<AcademyPickerPage />} />
        <Route path="/member-login" element={<MemberLogin />} />
        <Route path="/member-dashboard" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByTestId('academy-picker-code'), { target: { value: 'ACA-789' } });
  fireEvent.change(screen.getByTestId('academy-picker-phone'), { target: { value: '0555555555' } });
  await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2), { timeout: 3500 });
  expect(axios.post).toHaveBeenNthCalledWith(2,
    expect.stringContaining('/api/member-portal/login'),
    { phone: '0555555555', member_code: 'ACA-789' },
    { headers: { 'X-Tenant-Slug': 'academy-two' }, timeout: 15000 },
  );
  expect(localStorage.getItem('member_token')).toBe('new-member');
});
