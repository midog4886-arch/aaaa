import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MemberSchedule from './MemberSchedule';
import { memberAPI } from './MemberLayout';

jest.mock('./MemberLayout', () => ({ __esModule: true, default: ({ children }) => <main>{children}</main>, getDarkMode: () => false, memberAPI: { get: jest.fn() } }));

test('schedule compares old and new times and refreshes after a change', async () => {
  const data = { schedules: [], active_count: 0, expired_count: 0, schedule_change_notice: { message_ar: 'تم تغيير موعدك', old_schedule: 'الأحد 4 مساءً', new_schedule: 'الأحد 5 مساءً' } };
  memberAPI.get.mockResolvedValueOnce({ data }).mockResolvedValueOnce({ data: { ...data, schedule_change_notice: { ...data.schedule_change_notice, new_schedule: 'الاثنين 6 مساءً' } } });
  render(<MemoryRouter><MemberSchedule /></MemoryRouter>);
  expect(await screen.findByText('الموعد السابق: الأحد 4 مساءً')).toBeInTheDocument();
  expect(screen.getByText('الموعد الجديد: الأحد 5 مساءً')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'تحديث الجدول' }));
  expect(await screen.findByText('الموعد الجديد: الاثنين 6 مساءً')).toBeInTheDocument();
});
