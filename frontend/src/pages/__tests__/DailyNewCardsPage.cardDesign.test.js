import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DailyNewCardsPage from '../DailyNewCardsPage';
import { membersAPI } from '../../services/api';

jest.mock('../../components/Layout', () => ({
  Layout: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../services/api', () => ({
  membersAPI: { getDailyNewCards: jest.fn(), markPrinted: jest.fn() },
}));
jest.mock('../../services/branding', () => ({
  getAcademyLogoUrl: () => '/academy-logo.png',
  getAcademyName: () => 'Test Academy',
}));

const member = {
  id: 'daily-member',
  name: 'Daily Member',
  member_code: 'M-TEST-001',
  guardian_phone: 'GUARDIAN-CONTACT',
  photo_url: '/member-photo.jpg',
  activities: [{
    activity_name: 'Swimming',
    start_date: '2020-01-01',
    end_date: '2020-02-01',
    schedule: 'Sunday 17:00',
  }],
};

beforeEach(() => {
  localStorage.clear();
  membersAPI.getDailyNewCards.mockResolvedValue({ data: {
    date: '2026-09-17',
    total_branches: 1,
    branches: [{
      branch_id: 'daily-branch',
      branch_name: 'Daily Branch',
      branch_phone: 'BRANCH-CONTACT',
      members: [member],
    }],
    renewal_branches: [],
  } });
  membersAPI.markPrinted.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test.each([
  ['A4', /طباعة A4 وجه وظهر/, 'size: A4'],
  ['CR-80', /CD820 وجه وظهر/, 'size: 54mm 85.6mm'],
])('daily %s printing retains the modified permanent front/back design', async (_name, buttonName, pageSize) => {
  const popup = {
    closed: false,
    document: { write: jest.fn(), close: jest.fn(), images: [] },
    focus: jest.fn(),
    print: jest.fn(),
  };
  jest.spyOn(window, 'open').mockReturnValue(popup);
  render(<DailyNewCardsPage />);
  await screen.findByText('Daily Member');
  fireEvent.click(screen.getAllByRole('button', { name: buttonName })[0]);

  await waitFor(() => expect(popup.document.write).toHaveBeenCalledTimes(1));
  const html = popup.document.write.mock.calls[0][0];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('.card.front')).toHaveLength(1);
  expect(doc.querySelectorAll('.card.back')).toHaveLength(1);
  expect(doc.querySelector('.front').textContent).toContain('Swimming');
  expect(doc.querySelector('.front').textContent).toContain('GUARDIAN-CONTACT');
  expect(doc.querySelector('.back').textContent).toContain('BRANCH-CONTACT');
  expect(doc.querySelector('.back').textContent).not.toContain('Daily Branch');
  expect(html).toContain('M-TEST-001');
  expect(html).toContain(pageSize);
  expect(html).not.toContain('/member-photo.jpg');
  expect(html).not.toContain('2020-01-01');
  expect(html).not.toContain('2020-02-01');
  expect(html).not.toContain('Sunday 17:00');
  await waitFor(() => expect(popup.print).toHaveBeenCalledTimes(1));
});