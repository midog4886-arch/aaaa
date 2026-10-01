import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SessionTransferDialog from './SessionTransferDialog';
import { attendanceAPI, membersAPI } from '../../services/api';

jest.mock('../../services/api', () => ({
  membersAPI: { getAll: jest.fn(), transferSessions: jest.fn() },
  attendanceAPI: { getSessionQuota: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));
const member = { id: 'sender', branch_id: 'b1', name: 'Sender' };
const activity = { activity_id: 'swim', activity_name: 'Swimming', start_date: '2026-10-01', end_date: '2026-10-31' };
const review = { preview_token: 'reviewed-token', sender_name: 'Sender', recipient_name: 'Recipient', sender_before: 6, sender_after: 3, recipient_before: 0, recipient_after: 3, sessions: 3, end_date: '2026-10-20' };
beforeEach(() => {
  jest.clearAllMocks();
  membersAPI.getAll.mockResolvedValue({ data: [member, { id: 'recipient', branch_id: 'b1', name: 'Recipient', member_code: 'ABTL-11928' }, { id: 'outside', branch_id: 'b2', name: 'Outside' }] });
  membersAPI.transferSessions.mockResolvedValue({ data: review });
  attendanceAPI.getSessionQuota.mockResolvedValue({ data: [{ start_date: '2026-10-01', end_date: '2026-10-31', remaining: 6 }] });
});
async function fill() {
  fireEvent.change(screen.getByLabelText(/ابحث عن المستلم/), { target: { value: 'Recipient' } });
  await screen.findByRole('option', { name: 'Recipient — ABTL-11928' });
  expect(screen.queryByRole('option', { name: 'Outside' })).toBeNull();
  fireEvent.change(screen.getByLabelText('المشترك المستلم'), { target: { value: 'recipient' } });
  fireEvent.change(screen.getByLabelText('عدد الحصص'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('سبب النقل'), { target: { value: 'Family request' } });
}
test('preview never transfers; confirm sends the reviewed token and refreshes', async () => {
  const done = jest.fn();
  render(<SessionTransferDialog member={member} activity={activity} language="ar" onClose={jest.fn()} onComplete={done} />);
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'معاينة الرصيد قبل النقل' }));
  await screen.findByTestId('session-transfer-review');
  expect(membersAPI.transferSessions.mock.calls[0][2]).toBe('preview');
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد نقل الحصص' }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(membersAPI.transferSessions.mock.calls[1][3].preview_token).toBe('reviewed-token');
});
test('changing the amount invalidates the review; server rejection never reports success', async () => {
  const done = jest.fn();
  render(<SessionTransferDialog member={member} activity={activity} language="ar" onClose={jest.fn()} onComplete={done} />);
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'معاينة الرصيد قبل النقل' }));
  await screen.findByTestId('session-transfer-review');
  fireEvent.change(screen.getByLabelText('عدد الحصص'), { target: { value: '2' } });
  expect(screen.queryByTestId('session-transfer-review')).toBeNull();
  membersAPI.transferSessions.mockRejectedValue({ response: { data: { detail: 'تغير الرصيد؛ أعد المراجعة' } } });
  fireEvent.click(screen.getByRole('button', { name: 'معاينة الرصيد قبل النقل' }));
  await screen.findByRole('alert');
  expect(done).not.toHaveBeenCalled();
});

test('shows the sender balance and limits the selected transfer amount', async () => {
  render(<SessionTransferDialog member={member} activity={activity} language="ar" onClose={jest.fn()} onComplete={jest.fn()} />);
  await fill();
  expect(await screen.findByTestId('sender-session-balance')).toHaveTextContent('6');
  fireEvent.change(screen.getByLabelText('عدد الحصص'), { target: { value: '7' } });
  expect(screen.getByRole('button', { name: 'معاينة الرصيد قبل النقل' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('عدد الحصص'), { target: { value: '5' } });
  expect(screen.getByRole('button', { name: 'معاينة الرصيد قبل النقل' })).toBeEnabled();
});
