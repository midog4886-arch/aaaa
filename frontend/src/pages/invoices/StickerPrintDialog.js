import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';

const StickerPrintDialog = ({ 
  isOpen, 
  onClose, 
  onSelectPosition, 
  title = '🖨️ اختر موقع الطباعة',
  cardSize = '9سم × 7سم'
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">{title}</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-center text-gray-600 mb-4">اختر الخانة المطلوبة على ورقة الاستيكر</p>
          
          {/* Sticker Sheet Grid - 2 horizontal cards */}
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="grid grid-cols-2 gap-3 max-w-[320px] mx-auto">
              {/* Card 1 - Member Card */}
              <button
                onClick={() => onSelectPosition(0)}
                className="aspect-[9/7] bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all flex flex-col items-center justify-center gap-2 p-3"
              >
                <span className="text-3xl">📇</span>
                <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                <span className="text-xs text-gray-400">خانة 1</span>
              </button>
              
              {/* Card 2 - Academy Logo */}
              <button
                onClick={() => onSelectPosition(1)}
                className="aspect-[9/7] bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all flex flex-col items-center justify-center gap-2 p-3 overflow-hidden"
              >
                <img 
                  src="/images/academy-logo.png" 
                  alt="شعار الأكاديمية" 
                  className="w-16 h-16 object-contain"
                />
                <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                <span className="text-xs text-gray-400">خانة 2</span>
              </button>
            </div>
            <p className="text-center text-xs text-gray-500 mt-3">
              📐 حجم كل كرت: {cardSize}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StickerPrintDialog;
