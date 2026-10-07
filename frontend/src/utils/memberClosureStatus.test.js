import { closureCompensatedMember } from './memberClosureStatus';

test('an applied branch closure is not marked transferred for a skipped member', () => {
  const closure = { applied: true, affected_members: [{ member_id: 'other' }] };
  expect(closureCompensatedMember(closure, 'skipped')).toBe(false);
  expect(closureCompensatedMember(closure, 'other')).toBe(true);
  expect(closureCompensatedMember({ applied: false, affected_members: [{ member_id: 'other' }] }, 'other')).toBe(false);
});
