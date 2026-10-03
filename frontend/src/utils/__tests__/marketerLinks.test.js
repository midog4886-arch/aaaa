import { marketerReferralUrl, marketerPortalUrl } from '../marketerLinks';

test('referral links preserve the marketer and selected branch', () => {
  expect(marketerReferralUrl({ baseUrl: 'https://adaa-alabtal.com/', tenantSlug: 'default', referralCode: 'ENG10', branchId: 'branch-1' }))
    .toBe('https://adaa-alabtal.com/register/default/branch-1?ref=ENG10');
  expect(marketerReferralUrl({ baseUrl: 'https://adaa-alabtal.com', tenantSlug: 'academy', referralCode: 'ENG10', branchId: 'all' }))
    .toBe('https://adaa-alabtal.com/register/academy?ref=ENG10');
});

test('private portal link targets only the supplied token', () => {
  expect(marketerPortalUrl({ baseUrl: 'https://adaa-alabtal.com/', tenantSlug: 'default', token: 'private-token' }))
    .toBe('https://adaa-alabtal.com/marketer/default/private-token');
});
