import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { MessageSquare, QrCode } from 'lucide-react';
import { getMemberQRValue } from '../../../../utils/memberQR';

export const QRCardDialog = ({
  isOpen, onOpenChange, qrCardMember,
  onPrint, onSendWhatsApp, language
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">🎫 بطاقة QR العضوية</DialogTitle>
        </DialogHeader>
        {qrCardMember && (
          <div className="py-4 text-center space-y-4">
            <p className="font-bold text-lg text-gray-800">{qrCardMember.name_ar}</p>
            <p className="text-orange-600 font-bold text-xl">#{qrCardMember.member_code}</p>
            <div className="bg-gray-50 rounded-xl p-4 flex justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getMemberQRValue(qrCardMember.member_code))}`}
                alt="QR Code"
                className="w-40 h-40 rounded-lg shadow"
              />
            </div>
            <p className="text-sm text-gray-500">
              {language === 'ar' ? 'امسح الكود عند الدخول لتسجيل الحضور' : 'Scan code at entry for attendance'}
            </p>
          </div>
        )}
        <DialogFooter className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === 'ar' ? 'إغلاق' : 'Close'}
          </Button>
          <Button variant="outline" className="text-green-600 border-green-400" onClick={onSendWhatsApp}>
            <MessageSquare className="w-4 h-4 me-2" />
            {language === 'ar' ? 'واتساب' : 'WhatsApp'}
          </Button>
          <Button onClick={onPrint}>
            <QrCode className="w-4 h-4 me-2" />
            {language === 'ar' ? 'طباعة' : 'Print'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
