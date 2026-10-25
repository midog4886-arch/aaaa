import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const scannerBranchMismatch = (member, scanBranchId) =>
  Boolean(member?.branch_id && !member?.is_vip && scanBranchId && scanBranchId !== 'all' && member.branch_id !== scanBranchId);

const ScannerBranchNotice = ({ member, user, isAdmin, language = 'ar' }) => {
  const scanBranchId = member?.scanBranchId;
  if (!scannerBranchMismatch(member, scanBranchId)) return null;

  const allowed = Array.isArray(user?.branch_ids) && user.branch_ids.length
    ? user.branch_ids : [user?.branch_id].filter(Boolean);
  const canCheckIn = isAdmin || allowed.includes(member.branch_id);
  const branchName = member.branch_name || member.branch_id;
  const message = language === 'ar'
    ? canCheckIn
      ? `العضو يتبع فرع ${branchName}. سيتم تسجيل حضوره في فرعه، مع بقاء الصفحة على الفرع المعروض حاليًا.`
      : `العضو يتبع فرع ${branchName}، وليس لديك صلاحية تسجيل حضوره في هذا الفرع.`
    : canCheckIn
      ? `This member belongs to ${branchName}. Attendance will be recorded under their branch; your current branch view will stay the same.`
      : `This member belongs to ${branchName}, which you are not authorized to check in.`;

  return (
    <div role="alert" className={`rounded-xl border p-3 flex items-start gap-2 text-sm ${canCheckIn ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-800'}`}>
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
};

export default ScannerBranchNotice;
