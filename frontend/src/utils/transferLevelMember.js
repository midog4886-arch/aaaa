// Both drag/drop and the picker must use one atomic server operation.
// Never detach first, select by display name, or replace a stale subscription.
export async function transferLevelMember(api, member, source, target, activity) {
  if (!member?.id || !source?.id || !target?.id ||
      !activity?.activity_id || activity.level_id !== source.id) {
    throw new Error('ارتباط الاشتراك غير واضح؛ حدّث القائمة قبل النقل');
  }
  return api.transferMember(target.id, member.id, source.id, activity.activity_id);
}