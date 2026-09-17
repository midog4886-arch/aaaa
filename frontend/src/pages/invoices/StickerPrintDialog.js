/**
 * Permanent membership-card print dialog.
 * The former two-sticker, subscription-specific layout is intentionally not
 * used for a membership identity card.
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { getAcademyLogoUrl, getAcademyName } from '../../services/branding';
import { getMemberQRValue } from '../../utils/memberQR';
import { getPermanentMemberCardDetails, openPermanentMemberCardPrint } from '../../utils/permanentMemberCard';

export const openStickerPrint = (member, language = 'ar') => {
  if (!member?.member_code) return null;
  return openPermanentMemberCardPrint({
    member,
    qrValue: getMemberQRValue(member.member_code),
    logoUrl: getAcademyLogoUrl(),
    academyName: getAcademyName() || 'شركة اداء الابطال العالمية للرياضة',
    branchName: member?.branch_name || '',
    branchPhone: member?.branch_phone || '',
    language: language === 'en' ? 'en' : 'ar',
  });
};

const StickerPrintDialog = ({
  open,
  onOpenChange,
  member,
  variant = 'orange',
}) => {
  const handlePrint = () => {
    const popup = openStickerPrint(member);
    if (popup) {
      onOpenChange(false);
    } else {
      toast.error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');
    }
  };

  const colors = {
    orange: { border: 'border-orange-400', text: 'text-orange-500', bg: 'bg-orange-500 hover:bg-orange-600' },
    purple: { border: 'border-purple-400', text: 'text-purple-500', bg: 'bg-purple-500 hover:bg-purple-600' },
    blue: { border: 'border-blue-400', text: 'text-blue-500', bg: 'bg-blue-500 hover:bg-blue-600' },
  };
  const color = colors[variant] || colors.orange;
  const { activityNames, guardianPhone } = getPermanentMemberCardDetails(member || {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">🖨️ طباعة بطاقة العضوية</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-center text-gray-600 mb-2 font-bold">{member?.name_ar || member?.name}</p>
          <p className={`text-center text-sm ${color.text} mb-4 font-bold`}>{member?.member_code}</p>
          <p className="text-center text-sm text-gray-500 mb-4">ستتم طباعة بطاقة عضوية دائمة بوجه وظهر</p>
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="flex justify-center gap-3 max-w-[360px] mx-auto">
              <div className={`aspect-[54/85.6] w-[115px] bg-white border-2 ${color.border} rounded-lg flex flex-col items-center justify-center gap-3 p-3 text-center`}>
                <p className="text-sm font-bold text-gray-700">الوجه</p>
                 <p className="text-xs text-gray-500">الاسم · رقم العضوية · النشاط · جوال ولي الأمر · QR</p>
              </div>
              <div className={`aspect-[54/85.6] w-[115px] bg-white border-2 ${color.border} rounded-lg flex flex-col items-center justify-center gap-3 p-3 text-center`}>
                <img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="w-12 h-12 object-contain" />
                <p className="text-xs text-gray-500">الظهر · الشعار ورقم التواصل</p>
              </div>
            </div>
             <div className="mt-3 space-y-1 text-center text-xs text-gray-600">
               <p><strong>النشاط:</strong> {activityNames.join(' · ') || 'لا يوجد نشاط مسجل'}</p>
               <p dir="ltr"><strong>جوال ولي الأمر:</strong> {guardianPhone || '—'}</p>
             </div>
             <p className="text-center text-xs text-gray-500 mt-2">بطاقة طولية CR-80 بوجه وظهر، بلا تواريخ اشتراك أو حصص</p>
          </div>
          <div className="mt-4 flex justify-center">
            <Button onClick={handlePrint} className={`${color.bg} text-white px-8 py-3 text-lg`}>
              <Printer className="w-5 h-5 ml-2" />
              طباعة البطاقة
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StickerPrintDialog;