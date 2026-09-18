import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemberEditHistoryDialog from './MemberEditHistoryDialog';
import { membersAPI } from '../../services/api';

jest.mock('../../services/api', () => ({
  membersAPI: { getSubscriptionAudit: jest.fn() },
}));

jest.mock('../ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }) => open ? (
    <div role="dialog">
      <button onClick={() => onOpenChange(false)}>close</button>
      {children}
    </div>
  ) : null,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
}));

jest.mock('../ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

const memberA = { id: 'a', name: 'Alpha' };
const memberB = { id: 'b', name: 'Beta' };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

test('is hidden and makes no request for a non-admin', () => {
  render(
    <MemberEditHistoryDialog open member={memberA} isAdmin={false} onOpenChange={jest.fn()} />
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(membersAPI.getSubscriptionAudit).not.toHaveBeenCalled();
});

test('renders action, actor, date, every field, and distinct values safely', async () => {
  membersAPI.getSubscriptionAudit.mockResolvedValue({
    data: [{
      id: 'audit-1',
      action: 'member.update',
      actor_username: 'admin-one',
      created_at: '2026-02-03T10:30:00Z',
      diff: {
        phone: { before: '0500', after: '0599' },
        custom_data: { before: false, after: { count: 0, tags: ['a'] } },
        optional_field: { after: '' },
      },
    }],
  });
  render(
    <MemberEditHistoryDialog
      open member={memberA} language="en" isAdmin activeBranchId="one"
      onOpenChange={jest.fn()}
    />
  );

  expect(await screen.findByText('Member profile updated')).toBeInTheDocument();
  expect(screen.getByText(/admin-one/)).toBeInTheDocument();
  expect(screen.queryByText('Time unavailable')).not.toBeInTheDocument();
  expect(screen.getByText('Phone')).toBeInTheDocument();
  expect(screen.getByText('custom_data')).toBeInTheDocument();
  expect(screen.getByText('false')).toBeInTheDocument();
  expect(screen.getByText('{"count":0,"tags":["a"]}')).toBeInTheDocument();
  expect(screen.getByText('Not recorded')).toBeInTheDocument();
  expect(screen.getByText('Empty')).toBeInTheDocument();
});

test('shows explicit unknown actor/date and unavailable details for a no-diff row', async () => {
  membersAPI.getSubscriptionAudit.mockResolvedValue({
    data: [{ id: 'audit-2', action: 'subscription.delete', created_at: 'not-a-date' }],
  });
  render(
    <MemberEditHistoryDialog open member={memberA} language="en" isAdmin onOpenChange={jest.fn()} />
  );
  expect(await screen.findByText('Subscription deleted')).toBeInTheDocument();
  expect(screen.getByText(/Unknown user/)).toBeInTheDocument();
  expect(screen.getByText('Time unavailable')).toBeInTheDocument();
  expect(screen.getByText('Historical details are unavailable for this operation.')).toBeInTheDocument();
});

test('supports empty, error, and retry states', async () => {
  membersAPI.getSubscriptionAudit
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ data: [] });
  render(
    <MemberEditHistoryDialog open member={memberA} language="en" isAdmin onOpenChange={jest.fn()} />
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load edit history.');
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
  expect(await screen.findByText('No edits have been recorded.')).toBeInTheDocument();
  expect(membersAPI.getSubscriptionAudit).toHaveBeenCalledTimes(2);
});

test('a malformed response is an error rather than a false empty history', async () => {
  membersAPI.getSubscriptionAudit.mockResolvedValue({ data: { unexpected: [] } });
  render(
    <MemberEditHistoryDialog open member={memberA} language="en" isAdmin onOpenChange={jest.fn()} />
  );
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('No recorded edits.')).not.toBeInTheDocument();
});

test('never displays stale history across member, branch, close, or role changes', async () => {
  const first = deferred();
  const second = deferred();
  const third = deferred();
  membersAPI.getSubscriptionAudit
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  const props = { open: true, member: memberA, language: 'en', isAdmin: true, activeBranchId: 'x' };
  const view = render(<MemberEditHistoryDialog {...props} onOpenChange={jest.fn()} />);
  expect(await screen.findByText('Loading history…')).toBeInTheDocument();

  view.rerender(
    <MemberEditHistoryDialog {...props} member={memberB} onOpenChange={jest.fn()} />
  );
  await waitFor(() => expect(membersAPI.getSubscriptionAudit).toHaveBeenLastCalledWith('b'));
  await act(async () => {
    first.resolve({ data: [{ id: 'old', action: 'member.update', diff: { phone: { after: 'STALE-A' } } }] });
  });
  expect(screen.queryByText('STALE-A')).not.toBeInTheDocument();

  view.rerender(
    <MemberEditHistoryDialog {...props} member={memberB} activeBranchId="y" onOpenChange={jest.fn()} />
  );
  await waitFor(() => expect(membersAPI.getSubscriptionAudit).toHaveBeenCalledTimes(3));
  await act(async () => {
    second.resolve({ data: [{ id: 'old-branch', action: 'member.update', diff: { phone: { after: 'STALE-BRANCH' } } }] });
  });
  expect(screen.queryByText('STALE-BRANCH')).not.toBeInTheDocument();

  view.rerender(
    <MemberEditHistoryDialog {...props} open={false} member={memberB} activeBranchId="y" onOpenChange={jest.fn()} />
  );
  await act(async () => {
    third.resolve({ data: [{ id: 'closed', action: 'member.update', diff: { phone: { after: 'STALE-CLOSED' } } }] });
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  view.rerender(
    <MemberEditHistoryDialog {...props} member={memberB} isAdmin={false} onOpenChange={jest.fn()} />
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(membersAPI.getSubscriptionAudit).toHaveBeenCalledTimes(3);
});