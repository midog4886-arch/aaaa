import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileFeed from '../ProfileFeed';
import { membersAPI } from '../../../services/api';

jest.mock('../../../services/api', () => ({ membersAPI: { getProfileHistory: jest.fn(), getProfileMessages: jest.fn() } }));

const deferred = () => {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

beforeEach(() => jest.clearAllMocks());

test('loads timeline on mount and paginates it', async () => {
  membersAPI.getProfileHistory
    .mockResolvedValueOnce({ data: { items: [{ id: 'a', title_en: 'Joined', detail_en: 'Registration completed', occurred_at: '2026-01-01' }], offset: 0, has_more: true } })
    .mockResolvedValueOnce({ data: { items: [{ id: 'b', title_en: 'Renewed', detail_en: 'Term updated', occurred_at: '2026-02-01' }], offset: 20, has_more: false } });
  render(<ProfileFeed memberId="m1" kind="history" language="en" scopeKey="branch-user" />);
  expect(await screen.findByText('Joined')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /load more/i }));
  expect(await screen.findByText('Renewed')).toBeInTheDocument();
  expect(membersAPI.getProfileHistory).toHaveBeenLastCalledWith('m1', { offset: 20, limit: 20 });
});

test('renders internal messages and change request status without mutations', async () => {
  membersAPI.getProfileMessages.mockResolvedValue({ data: { items: [
    { id: 'm', subject: 'Schedule', body: 'Updated slot', kind: 'message', created_at: '2026-01-01' },
    { id: 'r', subject: 'Profile update', body: 'Please review', kind: 'profile_change_request', status: 'applied', changes: { field: 'phone', label_ar: 'الجوال', label_en: 'Phone', current_value: null, new_value: '0501', reason: 'New number' }, created_at: '2026-01-02' },
  ], offset: 0, has_more: false } });
  render(<ProfileFeed memberId="m1" kind="messages" language="en" scopeKey="branch-user" />);
  expect(await screen.findByText('Internal member message')).toBeInTheDocument();
  expect(screen.getByText('Change request: applied')).toBeInTheDocument();
  expect(screen.getByText('0501')).toBeInTheDocument();
  expect(screen.getByText('Withheld / not available')).toBeInTheDocument();
});

test('warns about unavailable timeline sources and opens a target tab', async () => {
  const onTab = jest.fn();
  membersAPI.getProfileHistory.mockResolvedValue({ data: { items: [{ id: 'x', title_en: 'Invoice', detail_en: '', target_tab: 'invoices', occurred_at: '2026-01-01' }], errors: ['attendance'], offset: 0, has_more: false } });
  render(<ProfileFeed memberId="m1" kind="history" language="en" scopeKey="scope" onTab={onTab} />);
  expect(await screen.findByText(/Some profile sources/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /open related section/i }));
  expect(onTab).toHaveBeenCalledWith('invoices');
});

test('offers error retry and drops a stale member response', async () => {
  const slow = deferred();
  membersAPI.getProfileHistory.mockImplementationOnce(() => slow.promise).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: { items: [{ id: 'new', title_en: 'New member', detail_en: '', occurred_at: '2026-01-01' }], offset: 0, has_more: false } });
  const { rerender } = render(<ProfileFeed memberId="old" kind="history" language="en" scopeKey="a" />);
  rerender(<ProfileFeed memberId="new" kind="history" language="en" scopeKey="b" />);
  expect(await screen.findByText('Could not load data.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('New member')).toBeInTheDocument();
  await act(async () => slow.resolve({ data: { items: [{ id: 'old', title_en: 'Old member', detail_en: '', occurred_at: '2026-01-01' }], offset: 0, has_more: false } }));
  await waitFor(() => expect(screen.queryByText('Old member')).not.toBeInTheDocument());
});