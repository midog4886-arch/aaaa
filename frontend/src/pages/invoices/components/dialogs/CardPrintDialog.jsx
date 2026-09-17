import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Printer } from 'lucide-react';
import { getAcademyLogoUrl } from '../../../../services/branding';
import { getPermanentMemberCardDetails } from '../../../../utils/permanentMemberCard';

export const CardPrintDialog = ({
  isOpen, onOpenChange, cardPrintMember,
  onPrint, language
}) => {
  const { activityNames, guardianPhone } = getPermanentMemberCardDetails(cardPrintMember || {});
  const isEnglish = language === 'en';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">🖨️ طباعة بطاقة العضوية</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-center text-gray-600 mb-2 font-bold">{cardPrintMember?.name_ar || cardPrintMember?.name}</p>
          <p className="text-center text-sm text-orange-600 mb-2 font-bold">{cardPrintMember?.member_code}</p>
          <p className="text-center text-sm text-gray-500 mb-4">ستتم طباعة بطاقة عضوية دائمة بوجه وظهر</p>
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="flex justify-center gap-3 max-w-[360px] mx-auto">
              <div className="aspect-[54/85.6] w-[115px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-3 p-3 text-center">
                <p className="text-sm font-bold text-gray-700">الوجه</p>
                 <p className="text-xs text-gray-500">{isEnglish ? 'Name · member code · activity · guardian phone · QR' : 'الاسم · رقم العضوية · النشاط · جوال ولي الأمر · QR'}</p>
              </div>
              <div className="aspect-[54/85.6] w-[115px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-3 p-3 text-center">
                <img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="w-12 h-12 object-contain" />
                <p className="text-xs text-gray-500">الظهر · الشعار ورقم التواصل</p>
              </div>
            </div>
             <div className="mt-3 space-y-1 text-center text-xs text-gray-600">
               <p><strong>{isEnglish ? 'Activity:' : 'النشاط:'}</strong> {activityNames.join(' · ') || (isEnglish ? 'None registered' : 'لا يوجد نشاط مسجل')}</p>
               <p dir="ltr"><strong>{isEnglish ? 'Guardian phone:' : 'جوال ولي الأمر:'}</strong> {guardianPhone || '—'}</p>
             </div>
             <p className="text-center text-xs text-gray-500 mt-2">{isEnglish ? 'Portrait CR-80 card, front and back, with no subscription dates or schedules' : 'بطاقة طولية CR-80 بوجه وظهر، بلا تواريخ اشتراك أو حصص'}</p>
          </div>
          <div className="mt-4 flex justify-center">
            <Button onClick={onPrint} className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg">
              <Printer className="w-5 h-5 ml-2" />
              طباعة البطاقة
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
