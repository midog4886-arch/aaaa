import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistrationManagement from './RegistrationManagement';
import { registrationRequestsAPI } from '../services/api';
import { toast } from 'sonner';
jest.mock('../services/api', () => ({ registrationRequestsAPI: { manage: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

test('saves assignment and note with expected owner, retaining note after a conflict', async () => {
  const changed = jest.fn();
  registrationRequestsAPI.manage.mockRejectedValueOnce({ response: { data: { detail: 'تغيّر المسؤول' } } }).mockResolvedValueOnce({ data: {} });
  render(<RegistrationManagement request={{ id: 'r1', branch_id: 'b1' }} assignees={[{ id: 'u1', name: 'أحمد', branch_ids: ['b1'] }, { id: 'u2', name: 'فرع آخر', branch_ids: ['b2'] }]} onChanged={changed} />);
  expect(screen.queryByRole('option', { name: 'فرع آخر' })).toBeNull();
  fireEvent.change(screen.getByLabelText('الموظف المسؤول'), { target: { value: 'u1' } });
  fireEvent.change(screen.getByLabelText('ملاحظة داخلية'), { target: { value: 'طلب معاودة الاتصال غدًا' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ المتابعة' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('تغيّر المسؤول'));
  expect(screen.getByLabelText('ملاحظة داخلية').value).toBe('طلب معاودة الاتصال غدًا');
  fireEvent.click(screen.getByRole('button', { name: 'حفظ المتابعة' }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(registrationRequestsAPI.manage).toHaveBeenLastCalledWith('r1', { assignee_id: 'u1', expected_assignee_id: null, note: 'طلب معاودة الاتصال غدًا' });
});
