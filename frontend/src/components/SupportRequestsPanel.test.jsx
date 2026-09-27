import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SupportRequestsPanel from './SupportRequestsPanel';

beforeAll(() => Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } }));

test('failed submission preserves fields and reuses the request identifier on retry', async () => {
  const ticket = { id: 't1', number: 'SUP-TEST-001', subject: 'موعد التدريب', body: 'أحتاج تغيير موعد التدريب', status: 'open', messages: [], updated_at: '2030-01-01T00:00:00Z' };
  const api = { get: jest.fn().mockResolvedValue({ data: [] }), post: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: ticket }) };
  render(<SupportRequestsPanel api={api} />);
  await screen.findByText('لا توجد طلبات دعم بعد.');
  fireEvent.change(screen.getByLabelText('عنوان الطلب'), { target: { value: ticket.subject } });
  fireEvent.change(screen.getByLabelText('وصف المشكلة'), { target: { value: ticket.body } });
  fireEvent.click(screen.getByRole('button', { name: 'إرسال طلب دعم' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر إرسال الطلب');
  expect(screen.getByLabelText('وصف المشكلة')).toHaveValue(ticket.body);
  fireEvent.click(screen.getByRole('button', { name: 'إرسال طلب دعم' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ticket.number));
  expect(api.post.mock.calls[0][1].request_id).toBe(api.post.mock.calls[1][1].request_id);
  expect(screen.getByTestId('support-request')).toHaveTextContent('جديد');
});

test('staff can save a reply and resolve a request', async () => {
  const ticket = { id: 't1', number: 'SUP-TEST-001', subject: 'طلب دعم', body: 'وصف المشكلة', status: 'open', messages: [], updated_at: '2030-01-01T00:00:00Z' };
  const api = { get: jest.fn().mockResolvedValue({ data: [ticket] }), patch: jest.fn().mockResolvedValue({ data: { ...ticket, status: 'resolved', messages: [{ id: 'r1', body: 'تم الحل', created_at: ticket.updated_at }] } }) };
  render(<SupportRequestsPanel api={api} staff />);
  await screen.findByText(ticket.number);
  fireEvent.change(screen.getByLabelText(`حالة ${ticket.number}`), { target: { value: 'resolved' } });
  fireEvent.change(screen.getByLabelText(`رد ${ticket.number}`), { target: { value: 'تم الحل' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ الحالة والرد' }));
  await waitFor(() => expect(screen.getByTestId('support-request')).toHaveTextContent('تم الحل'));
  expect(api.patch).toHaveBeenCalledWith('/api/member-portal/support-requests/admin/t1', expect.objectContaining({ status: 'resolved', reply: 'تم الحل' }), { timeout: 15000 });
});
