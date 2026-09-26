import { transferLevelMember } from '../transferLevelMember';

test('move uses IDs and a single request, never detach/add or stale activity PUT', async () => {
  const api = { transferMember: jest.fn().mockResolvedValue({ data: { level_id: 'two' } }),
    removeMember: jest.fn(), addMember: jest.fn(), updateActivity: jest.fn() };
  const activity = { activity_id: 'swim', level_id: 'one', photo: 'keep', end_date: '2026-10-07' };
  await transferLevelMember(api, { id: 'unique-id', name: 'Mohamed' }, { id: 'one' }, { id: 'two' }, activity);
  expect(api.transferMember).toHaveBeenCalledWith('two', 'unique-id', 'one', 'swim');
  expect(api.removeMember).not.toHaveBeenCalled();
  expect(api.addMember).not.toHaveBeenCalled();
  expect(api.updateActivity).not.toHaveBeenCalled();
  expect(activity.level_id).toBe('one');
});

test('failed destination propagates error without any compensating removal', async () => {
  const api = { transferMember: jest.fn().mockRejectedValue(new Error('conflict')), removeMember: jest.fn() };
  await expect(transferLevelMember(api, { id: 'id' }, { id: 'one' }, { id: 'two' },
    { activity_id: 'swim', level_id: 'one' })).rejects.toThrow('conflict');
  expect(api.removeMember).not.toHaveBeenCalled();
});

test('ambiguous or stale authoritative activity blocks request', async () => {
  const api = { transferMember: jest.fn() };
  await expect(transferLevelMember(api, { id: 'id' }, { id: 'one' }, { id: 'two' },
    { activity_id: 'swim', level_id: 'other' })).rejects.toThrow();
  expect(api.transferMember).not.toHaveBeenCalled();
});