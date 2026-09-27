import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PublicPaymentPage from './PublicPaymentPage';
jest.mock('react-router-dom', () => ({ useParams: () => ({ token: 'safe-token' }), useSearchParams: () => [new URLSearchParams('tenant=academy')] }));
const data = { state: 'pending', academy_name: 'أكاديمية أداء الأبطال', logo: '/logo-new.png', total: 345, gateway_ready: false, expires_at: '2030-01-01T00:00:00Z', invoices: [{ number: '1', name: 'محمد', total: 115, status: 'pending', items: [{ activity: 'السباحة', period: 'شهر', start: '2026-10-01', end: '2026-10-31' }] }, { number: '2', name: 'سارة', total: 230, status: 'pending', items: [] }] };
afterEach(() => jest.restoreAllMocks());
test('shows a family invoice honestly while gateway is unavailable and uses the link tenant', async () => {
  window.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data });
  render(<PublicPaymentPage />);
  await screen.findByText('محمد');
  expect(screen.getByText('سارة')).toBeTruthy();
  expect(screen.getByText('الإجمالي: 345.00 ر.س')).toBeTruthy();
  expect(screen.getByText(/الدفع الإلكتروني غير مفعّل بعد/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'الانتقال للدفع الآمن' })).toBeNull();
  expect(window.fetch).toHaveBeenCalledTimes(1);
  expect(window.fetch.mock.calls[0][1].headers['X-Tenant-Slug']).toBe('academy');
});
test('a return to the page does not claim payment until the server confirms', async () => {
  window.fetch = jest.fn().mockImplementation(async url => ({ ok: true, json: async () => url.endsWith('/verify') ? { paid: false } : { ...data, gateway_ready: true } }));
  render(<PublicPaymentPage />);
  await waitFor(() => expect(window.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/verify$/), expect.anything()));
  expect(screen.getByText('بانتظار الدفع')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'طباعة الإيصالات' })).toBeNull();
});
test('verified family payment has separate receipt amounts and print action', async () => {
  window.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...data, state: 'paid', invoices: data.invoices.map(i => ({ ...i, status: 'paid', paid_at: '2026-10-01T10:00:00Z' })) }) });
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  render(<PublicPaymentPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'طباعة الإيصالات' }));
  expect(screen.getAllByText(/إيصال دفع/)).toHaveLength(2);
  expect(print).toHaveBeenCalled();
});
