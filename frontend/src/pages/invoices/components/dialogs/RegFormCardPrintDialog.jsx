import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Printer } from 'lucide-react';
import { getAcademyLogoUrl } from '../../../../services/branding';

export const RegFormCardPrintDialog = ({
  isOpen, onOpenChange, regFormCardData,
  onPrint, language
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات - استمارة التسجيل</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-center text-gray-600 mb-2 font-bold">{regFormCardData?.name_ar}</p>
          <p className="text-center text-sm text-orange-600 mb-2 font-bold">#{regFormCardData?.member_code}</p>
          <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
              <div className="aspect-[9/6] w-[140px] bg-white border-2 border-purple-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                <span className="text-3xl">📇</span>
                <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                <span className="text-xs text-purple-500">خانة 1</span>
              </div>
              <div className="aspect-[9/6] w-[140px] bg-white border-2 border-purple-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                <img src={getAcademyLogoUrl()} alt="شعار الأكاديمية" className="w-14 h-14 object-contain" />
                <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                <span className="text-xs text-purple-500">خانة 2</span>
              </div>
            </div>
            <p className="text-center text-xs text-gray-500 mt-3">📐 حجم كل كرت: 9سم × 6سم</p>
          </div>
          <div className="mt-4 flex justify-center">
            <Button onClick={onPrint} className="bg-purple-500 hover:bg-purple-600 text-white px-8 py-3 text-lg">
              <Printer className="w-5 h-5 ml-2" />
              طباعة الملصقات
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
