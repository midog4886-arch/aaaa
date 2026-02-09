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
          
          {/* Sticker Sheet Grid - 2 columns x 3 rows */}
          <div className="bg-gray-100 p-4 rounded-lg">
            <div className="grid grid-cols-2 gap-2 max-w-[280px] mx-auto">
              {[0, 1, 2, 3, 4, 5].map((position) => (
                <button
                  key={position}
                  onClick={() => onSelectPosition(position)}
                  className="aspect-square bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition-all flex flex-col items-center justify-center gap-1 p-2"
                >
                  <span className="text-2xl">📇</span>
                  <span className="text-xs text-gray-500">كرت {position + 1}</span>
                  <span className="text-[10px] text-gray-400">
                    صف {Math.floor(position / 2) + 1} - عمود {(position % 2) + 1}
                  </span>
                </button>
              ))}
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
