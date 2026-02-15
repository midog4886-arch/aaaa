/**
 * Credit Note View Dialog Component
 * نافذة عرض إشعار الدائن
 */
import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, X, FileText } from 'lucide-react';
import { COMPANY_INFO } from '../constants';

const CreditNoteViewDialog = ({
  isOpen,
  onClose,
  creditNote,
  onPrint,
  language = 'ar',
  t
}) => {
  const printRef = useRef();

  if (!creditNote) return null;

  const handlePrint = () => {
    if (onPrint) {
      onPrint(creditNote);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <FileText className="w-5 h-5" />
            {language === 'ar' ? 'إشعار دائن' : 'Credit Note'} #{creditNote.credit_note_number}
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="space-y-4 py-4">
          {/* Header */}
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold text-red-600">
              {language === 'ar' ? 'إشعار دائن' : 'Credit Note'}
            </h2>
            <p className="text-2xl font-mono font-bold mt-1">#{creditNote.credit_note_number}</p>
          </div>

          {/* Company & Customer Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2">{language === 'ar' ? 'من:' : 'From:'}</h4>
              <p className="font-bold">{COMPANY_INFO.name_ar}</p>
              <p className="text-muted-foreground">{language === 'ar' ? 'الرقم الضريبي:' : 'Tax #:'} {COMPANY_INFO.tax_number}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2">{language === 'ar' ? 'إلى:' : 'To:'}</h4>
              <p className="font-bold">{creditNote.customer_name_ar}</p>
              {creditNote.customer_phone && (
                <p className="text-muted-foreground" dir="ltr">{creditNote.customer_phone}</p>
              )}
            </div>
          </div>

          {/* Original Invoice Reference */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm">
              <span className="text-amber-700">{language === 'ar' ? 'مرجع الفاتورة الأصلية:' : 'Original Invoice Reference:'}</span>
              <span className="font-mono font-bold mx-2">#{creditNote.original_invoice_number}</span>
            </p>
          </div>

          {/* Items Table */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-red-50">
                <tr>
                  <th className="p-2 text-start">{language === 'ar' ? 'البند' : 'Item'}</th>
                  <th className="p-2 text-center">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
                  <th className="p-2 text-end">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {creditNote.items?.map((item, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2">{item.activity_name}</td>
                    <td className="p-2 text-center">{item.quantity || 1}</td>
                    <td className="p-2 text-end font-medium">{item.fee?.toFixed(2)} {t?.('sar') || 'SAR'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between p-2">
              <span>{language === 'ar' ? 'المبلغ قبل الضريبة:' : 'Subtotal:'}</span>
              <span>{creditNote.subtotal?.toFixed(2)} {t?.('sar') || 'SAR'}</span>
            </div>
            <div className="flex justify-between p-2">
              <span>{language === 'ar' ? 'ضريبة القيمة المضافة (15%):' : 'VAT (15%):'}</span>
              <span>{creditNote.vat_amount?.toFixed(2)} {t?.('sar') || 'SAR'}</span>
            </div>
            <div className="flex justify-between p-3 bg-red-50 rounded-lg font-bold text-red-600">
              <span>{language === 'ar' ? 'إجمالي المبلغ المسترد:' : 'Total Refund Amount:'}</span>
              <span>- {creditNote.refund_amount?.toFixed(2)} {t?.('sar') || 'SAR'}</span>
            </div>
          </div>

          {/* Reason */}
          {creditNote.reason && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <h4 className="font-semibold text-sm mb-1">{language === 'ar' ? 'السبب:' : 'Reason:'}</h4>
              <p className="text-sm text-muted-foreground">{creditNote.reason}</p>
            </div>
          )}

          {/* QR Code & Info */}
          <div className="flex justify-between items-end pt-4 border-t">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>{language === 'ar' ? 'التاريخ:' : 'Date:'} {new Date(creditNote.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</p>
              {creditNote.created_by && (
                <p>{language === 'ar' ? 'المحرر:' : 'Created By:'} {creditNote.created_by}</p>
              )}
            </div>
            <div className="flex flex-col items-center">
              <QRCodeSVG
                value={JSON.stringify({
                  type: 'CREDIT_NOTE',
                  number: creditNote.credit_note_number,
                  amount: creditNote.refund_amount
                })}
                size={80}
                level="M"
              />
              <span className="text-xs text-muted-foreground mt-1">
                {language === 'ar' ? 'رمز التحقق' : 'Verification'}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onClose(false)}>
            <X className="w-4 h-4 me-2" />
            {language === 'ar' ? 'إغلاق' : 'Close'}
          </Button>
          <Button onClick={handlePrint} className="bg-green-600 hover:bg-green-700">
            <Printer className="w-4 h-4 me-2" />
            {language === 'ar' ? 'طباعة' : 'Print'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreditNoteViewDialog;
