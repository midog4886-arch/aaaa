import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import RegistrationFollowup from './RegistrationFollowup';
import { registrationRequestsAPI } from '../services/api';
import { toast } from 'sonner';

jest.mock('../services/api', () => ({
  registrationRequestsAPI: { stopFollowup: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const request = { id: 'request-a', status: 'pending', followup_enrolled: true, followup_status: 'scheduled' };
afterEach(() => { cleanup(); jest.clearAllMocks(); });

test('shows legacy requests as not enrolled, without starting reminders', () => {
  render(<RegistrationFollowup request={{ id: 'old', status: 'pending' }} onChanged={jest.fn()} />);
  expect(screen.getByText('غير مشمول بالمتابعة الآلية')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(registrationRequestsAPI.stopFollowup).not.toHaveBeenCalled();
});

test('staff contact saves stop and reloads shared-phone statuses', async () => {
  registrationRequestsAPI.stopFollowup.mockResolvedValue({ data: {} });
  const changed = jest.fn();
  render(<RegistrationFollowup request={request} onChanged={changed} />);
  fireEvent.click(screen.getByRole('button', { name: /تم التواصل/ }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(registrationRequestsAPI.stopFollowup).toHaveBeenCalledWith('request-a', 'contacted');
});

test('opt-out requires confirmation and saves the distinct reason', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  registrationRequestsAPI.stopFollowup.mockResolvedValue({ data: {} });
  render(<RegistrationFollowup request={request} onChanged={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'طلب عدم التواصل' }));
  expect(registrationRequestsAPI.stopFollowup).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'طلب عدم التواصل' }));
  await waitFor(() => expect(registrationRequestsAPI.stopFollowup).toHaveBeenCalledWith('request-a', 'opted_out'));
  confirm.mockRestore();
});

test('failed saves do not claim contact was recorded', async () => {
  registrationRequestsAPI.stopFollowup.mockRejectedValue(new Error('network'));
  const changed = jest.fn();
  render(<RegistrationFollowup request={request} onChanged={changed} />);
  fireEvent.click(screen.getByRole('button', { name: /تم التواصل/ }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(changed).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

test('stopped requests show the reason without active controls', () => {
  render(<RegistrationFollowup request={{...request, followup_status: 'stopped', followup_stop_reason: 'replied'}} />);
  expect(screen.getByText(/ردّ العميل/)).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});