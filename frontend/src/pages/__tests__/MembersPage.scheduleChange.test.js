import React from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

jest.setTimeout(60000);

jest.mock('../../services/api', () => {
  const makeApi = () => new Proxy({}, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = jest.fn(() => Promise.resolve({ data: [] }));
      return target[prop];
    },
  });
  const apis = {};
  return new Proxy({ __esModule: true }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (!(prop in apis)) apis[prop] = makeApi();
      return apis[prop];
    },
  });
});
jest.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: key => key, language: 'en' }),
}));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ selectedBranchId: 'all', isAdmin: true, user: { id: 'admin', permissions: [] } }),
}));
jest.mock('../../components/Layout', () => ({ Layout: ({ children }) => <div>{children}</div> }));
jest.mock('../../components/ui/dialog', () => {
  const React = require('react');
  const Dialog = ({ open, onOpenChange, children }) => open
    ? <div role="dialog"><button type="button" onClick={() => onOpenChange?.(false)}>close dialog</button>{children}</div> : null;
  const part = () => ({ children }) => <div>{children}</div>;
  return { Dialog, DialogContent: part(), DialogHeader: part(), DialogTitle: part(), DialogFooter: part() };
});

const api = require('../../services/api');
const member = {
  id: 'member-1', name: 'Member One', name_ar: 'عضو', member_code: '123',
  activities: [{
    activity_id: 'swim-2', activity_name: 'Swim 2',
    start_date: '2026-09-09', end_date: '2026-09-30',
    schedule: 'الإثنين و الثلاثاء - 9:00 م', training_days: ['الإثنين', 'الثلاثاء'],
    training_time: '9:00 م', day_times: {}, source: 'invoice', source_id: 'invoice-1',
    fee: 200, status: 'active', level_id: 'level-1',
  }],
};
const preview = {
  preview_token: 'token-1', old_end_date: '2026-09-30',
  new_end_date: '2026-10-07', old_schedule: member.activities[0].schedule,
  new_schedule: 'الإثنين و الأربعاء - 9:00 م',
  total_allowed: 8, used_sessions: 4, remaining: 4,
  future_dates: ['2026-09-28', '2026-09-30', '2026-10-05', '2026-10-07'],
  warnings: ['Review existing closure'],
};

const openEditor = async (user, changeWeekdays = true) => {
  const MembersPage = require('../MembersPage').default;
  render(<MemoryRouter><MembersPage /></MemoryRouter>);
  await user.click(await screen.findByTestId('view-member-member-1'));
  await user.click(await screen.findByRole('button', { name: /activities \(1\)/ }));
  const view = screen.getAllByRole('dialog')[0];
  await user.click(within(view).getByTestId('edit-member-activity-swim-2'));
  if (changeWeekdays) {
    await user.click(within(view).getByRole('button', { name: 'الأربعاء' }));
    await user.click(within(view).getByRole('button', { name: 'الثلاثاء' }));
  }
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  api.membersAPI.getAll.mockResolvedValue({ data: [member] });
  api.membersAPI.getById.mockResolvedValue({ data: member });
  api.membersAPI.getSubscriptionAudit.mockResolvedValue({ data: [] });
  api.membersAPI.previewActivityScheduleChange.mockResolvedValue({ data: preview });
  api.membersAPI.confirmActivityScheduleChange.mockResolvedValue({ data: {} });
});

test('review is read-only; cancel does not write and future-only confirmation preserves source data', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = await openEditor(user);
  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  await screen.findByTestId('schedule-review');
  expect(api.membersAPI.previewActivityScheduleChange).toHaveBeenCalledTimes(1);
  expect(api.membersAPI.confirmActivityScheduleChange).not.toHaveBeenCalled();
  const request = api.membersAPI.previewActivityScheduleChange.mock.calls[0][2];
  expect(request.mode).toBe('future_only');
  expect(request.activity.source_id).toBe('invoice-1');
  expect(request.activity.day_times).toEqual({});
  expect(screen.getByTestId('schedule-review')).toHaveTextContent('2026-10-07');
  await user.click(within(screen.getAllByRole('dialog').at(-1)).getByRole('button', { name: 'Cancel' }));
  expect(api.membersAPI.confirmActivityScheduleChange).not.toHaveBeenCalled();

  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  await screen.findByTestId('schedule-confirm');
  await user.click(screen.getByTestId('schedule-confirm'));
  await waitFor(() => expect(api.membersAPI.confirmActivityScheduleChange).toHaveBeenCalledWith(
    'member-1', 'swim-2', expect.objectContaining({ mode: 'future_only', preview_token: 'token-1' }),
    { notifyWhatsapp: true },
  ));
  expect(api.membersAPI.updateActivity).not.toHaveBeenCalled();
});

test('retrospective correction requires a reason and stale preview requires a fresh review', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = await openEditor(user);
  await user.click(within(view).getByRole('radio', { name: /Correct a previously incorrect schedule/ }));
  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  expect(api.membersAPI.previewActivityScheduleChange).not.toHaveBeenCalled();
  await user.type(within(view).getByRole('textbox', { name: 'Correction reason' }), 'Wrong weekdays at purchase');
  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  await screen.findByTestId('schedule-review');
  expect(api.membersAPI.previewActivityScheduleChange.mock.calls[0][2]).toEqual(expect.objectContaining({
    mode: 'retrospective_correction', reason: 'Wrong weekdays at purchase',
  }));
  api.membersAPI.confirmActivityScheduleChange.mockRejectedValueOnce({ response: { status: 409 } });
  await user.click(screen.getByTestId('schedule-confirm'));
  await waitFor(() => expect(screen.queryByTestId('schedule-review')).not.toBeInTheDocument());
  expect(api.membersAPI.confirmActivityScheduleChange).toHaveBeenCalledTimes(1);
  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  expect(await screen.findByTestId('schedule-review')).toBeInTheDocument();
  expect(api.membersAPI.previewActivityScheduleChange).toHaveBeenCalledTimes(2);
});

test('changing the mode while a preview is in flight discards its response', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  let resolvePreview;
  api.membersAPI.previewActivityScheduleChange.mockImplementationOnce(() =>
    new Promise(resolve => { resolvePreview = resolve; }));
  const view = await openEditor(user);
  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  await user.click(within(view).getByRole('radio', { name: /Correct a previously incorrect schedule/ }));
  await act(async () => { resolvePreview({ data: preview }); });
  expect(screen.queryByTestId('schedule-review')).not.toBeInTheDocument();
  expect(api.membersAPI.confirmActivityScheduleChange).not.toHaveBeenCalled();
});

test('already-correct weekdays can explicitly review old off-day deductions without changing days', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = await openEditor(user, false);
  expect(within(view).getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  await user.click(within(view).getByTestId('correct-existing-schedule'));
  expect(within(view).getByRole('button', { name: 'Review change' })).toBeInTheDocument();
  await user.type(within(view).getByRole('textbox', { name: 'Correction reason' }), 'The days were corrected earlier');
  await user.click(within(view).getByRole('button', { name: 'Review change' }));
  expect(await screen.findByTestId('schedule-review')).toBeInTheDocument();
  expect(api.membersAPI.previewActivityScheduleChange).toHaveBeenCalledWith(
    'member-1', 'swim-2', expect.objectContaining({
      mode: 'retrospective_correction',
      activity: expect.objectContaining({ training_days: ['الإثنين', 'الثلاثاء'] }),
    }),
  );
  expect(api.membersAPI.updateActivity).not.toHaveBeenCalled();
  expect(api.membersAPI.confirmActivityScheduleChange).not.toHaveBeenCalled();
});