/**
 * Member QR Dialog Component
 * نافذة QR العضو
 */
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, X } from 'lucide-react';

const MemberQRDialog = ({
  isOpen,
  onClose,
  member,
  subscription,
  onPrintCard,
  language = 'ar',
  t
}) => {
  if (!member) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="text-center text-xl">
            🎉 {language === 'ar' ? 'تم إنشاء الفاتورة بنجاح!' : 'Invoice Created Successfully!'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Member Info */}
          <div className="text-center space-y-1">
            <h3 className="font-bold text-lg">{member.name_ar || member.name}</h3>
            {member.member_code && (
              <p className="text-orange-600 font-mono font-bold text-xl">#{member.member_code}</p>
            )}
            {member.phone && (
              <p className="text-sm text-muted-foreground" dir="ltr">{member.phone}</p>
            )}
          </div>

          {/* QR Code */}
          <div className="flex justify-center p-4 bg-white rounded-lg border">
            <QRCodeSVG
              value={member.member_code || member.id}
              size={180}
              level="H"
              includeMargin={true}
            />
          </div>

          {/* Subscription Details */}
          {subscription && subscription.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">
                📋 {language === 'ar' ? 'تفاصيل الاشتراك:' : 'Subscription Details:'}
              </h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {subscription.map((item, idx) => (
                  <div key={idx} className="text-sm p-2 bg-gray-50 rounded flex justify-between items-center">
                    <span className="font-medium">{item.activity_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {item.start_date && item.end_date ? `${item.start_date} → ${item.end_date}` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700 text-center">
              📱 {language === 'ar' 
                ? 'يمكن للعضو استخدام هذا الكود للحضور'
                : 'Member can use this code for attendance'}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onClose(false)}
          >
            <X className="w-4 h-4 me-2" />
            {language === 'ar' ? 'إغلاق' : 'Close'}
          </Button>
          {onPrintCard && (
            <Button
              onClick={() => onPrintCard(member)}
              className="bg-orange-500 hover:bg-orange-600"
            >
              <Printer className="w-4 h-4 me-2" />
              {language === 'ar' ? 'طباعة الكارت' : 'Print Card'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MemberQRDialog;
