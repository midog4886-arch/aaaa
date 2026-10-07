export const closureCompensatedMember = (closure, memberId) => Boolean(
  closure?.applied && memberId && Array.isArray(closure.affected_members)
  && closure.affected_members.some(row => row.member_id === memberId)
);
