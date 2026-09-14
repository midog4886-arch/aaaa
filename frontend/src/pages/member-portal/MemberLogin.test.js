import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import MemberLogin from './MemberLogin';

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