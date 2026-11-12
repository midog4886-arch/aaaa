import { memberMatchesSubscriptionFilter } from '../recipientSubscriptionFilter';

const today = '2026-11-12';
const member = activities => ({ activities });

test('active includes a subscription ending today even if its stored status is stale', () => {
  expect(memberMatchesSubscriptionFilter(member([{ status: 'expired', end_date: today }]), 'active', today)).toBe(true);
});

test('expired excludes members who have renewed', () => {
  const renewed = member([{ status: 'expired', end_date: '2026-11-01' }, { status: 'active', end_date: '2026-12-01' }]);
  expect(memberMatchesSubscriptionFilter(renewed, 'expired', today)).toBe(false);
  expect(memberMatchesSubscriptionFilter(renewed, 'active', today)).toBe(true);
});

test('expired requires an ended subscription; all includes members without subscriptions', () => {
  expect(memberMatchesSubscriptionFilter(member([{ status: 'expired', end_date: '2026-11-11' }]), 'expired', today)).toBe(true);
  expect(memberMatchesSubscriptionFilter(member([]), 'expired', today)).toBe(false);
  expect(memberMatchesSubscriptionFilter(member([{ end_date: '2026-11-11' }, { status: 'inactive' }]), 'expired', today)).toBe(false);
  expect(memberMatchesSubscriptionFilter(member([]), 'all', today)).toBe(true);
});
