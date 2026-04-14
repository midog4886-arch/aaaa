import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { CreditCard, Printer } from 'lucide-react';

export const ViewCreditNoteDialog = ({
  isOpen, onOpenChange, selectedCreditNote,
  onPrint, language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-red-600" />
            {language === 'ar' ? 'إشعار دائن' : 'Credit Note'}
            {selectedCreditNote && <span className="text-red-600">#{selectedCreditNote.credit_note_number}</span>}
          </DialogTitle>
        </DialogHeader>
        {selectedCreditNote && (
          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-semibold text-red-800 mb-2">{language === 'ar' ? '📋 بيانات إشعار الدائن' : '📋 Credit Note Info'}</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>{language === 'ar' ? 'رقم الإشعار:' : 'Credit Note #:'}</strong> <span className="text-red-600 font-bold">{selectedCreditNote.credit_note_number}</span></div>
                <div><strong>{language === 'ar' ? 'التاريخ:' : 'Date:'}</strong> {new Date(selectedCreditNote.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</div>
                <div><strong>{language === 'ar' ? 'الفاتورة الأصلية:' : 'Original Invoice:'}</strong> <Badge variant="outline">{selectedCreditNote.original_invoice_number}</Badge></div>
                <div><strong>{language === 'ar' ? 'المحرر:' : 'Created By:'}</strong> {selectedCreditNote.created_by || '-'}</div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 border rounded-lg">
              <h4 className="font-semibold mb-2">{language === 'ar' ? '👤 بيانات العميل' : '👤 Customer Info'}</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>{language === 'ar' ? 'الاسم:' : 'Name:'}</strong> {selectedCreditNote.customer_name_ar}</div>
                <div><strong>{language === 'ar' ? 'الجوال:' : 'Phone:'}</strong> <span dir="ltr">{selectedCreditNote.customer_phone || '-'}</span></div>
              </div>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-red-100">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'البند' : 'Item'}</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCreditNote.items?.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2 font-medium">{item.activity_name} {item.is_product && <Badge variant="secondary" className="text-xs">منتج</Badge>}</td>
                      <td className="p-2">{item.quantity || 1}</td>
                      <td className="p-2 font-medium text-red-600">- {((item.fee || 0) * (item.quantity || 1)).toFixed(2)} {t('sar')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
              <div className="flex justify-between text-sm"><span>{language === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span><span>- {selectedCreditNote.subtotal?.toFixed(2)} {t('sar')}</span></div>
              <div className="flex justify-between text-sm"><span>{language === 'ar' ? 'ضريبة القيمة المضافة (15%):' : 'VAT (15%):'}</span><span>- {selectedCreditNote.vat_amount?.toFixed(2)} {t('sar')}</span></div>
              <div className="flex justify-between font-bold text-lg text-red-600 pt-2 border-t border-red-200"><span>{language === 'ar' ? '💰 إجمالي المرتجع:' : '💰 Total Refund:'}</span><span>- {selectedCreditNote.refund_amount?.toFixed(2)} {t('sar')}</span></div>
            </div>
            {selectedCreditNote.reason && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg"><strong>{language === 'ar' ? '📌 سبب المرتجع:' : '📌 Refund Reason:'}</strong> {selectedCreditNote.reason}</div>}
            {selectedCreditNote.notes && <div className="p-3 bg-gray-100 border rounded-lg"><strong>{language === 'ar' ? '📝 ملاحظات:' : '📝 Notes:'}</strong> {selectedCreditNote.notes}</div>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button>
          <Button onClick={() => onPrint(selectedCreditNote)} className="bg-red-600 hover:bg-red-700"><Printer className="w-4 h-4 me-2" />{language === 'ar' ? 'طباعة' : 'Print'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
