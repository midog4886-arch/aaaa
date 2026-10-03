export const marketerReferralUrl = ({ baseUrl, tenantSlug, referralCode, branchId = '' }) => {
  if (!referralCode) return '';
  const base = (baseUrl || '').replace(/\/+$/, '');
  const tenant = encodeURIComponent(tenantSlug || 'default');
  const branch = branchId && branchId !== 'all' ? `/${encodeURIComponent(branchId)}` : '';
  return `${base}/register/${tenant}${branch}?ref=${encodeURIComponent(referralCode)}`;
};

export const marketerPortalUrl = ({ baseUrl, tenantSlug, token }) => {
  if (!token) return '';
  const base = (baseUrl || '').replace(/\/+$/, '');
  return `${base}/marketer/${encodeURIComponent(tenantSlug || 'default')}/${encodeURIComponent(token)}`;
};
