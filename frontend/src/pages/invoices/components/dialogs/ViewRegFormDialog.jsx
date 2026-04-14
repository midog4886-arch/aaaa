import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { ArrowRightCircle, ClipboardList, Edit, FileText, MessageSquare, Printer } from 'lucide-react';

export const ViewRegFormDialog = ({
  isOpen, onOpenChange, selectedRegForm,
  onPrint, onSavePdf, onSendWhatsApp, onEdit, onConvert,
  language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-teal-600" />
            {language === 'ar' ? 'عرض استمارة التسجيل' : 'View Registration Form'}
            {selectedRegForm && <span className="text-muted-foreground">#{selectedRegForm.form_number}</span>}
          </DialogTitle>
        </DialogHeader>
        {selectedRegForm && (
          <div className="space-y-4">
            <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg">
              <h4 className="font-semibold text-teal-800 mb-2">{language === 'ar' ? '👤 بيانات المشترك' : '👤 Customer Info'}</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><strong>{language === 'ar' ? 'الاسم:' : 'Name:'}</strong> {selectedRegForm.customer_name}</div>
                <div><strong>{language === 'ar' ? 'الجوال:' : 'Phone:'}</strong> <span dir="ltr">{selectedRegForm.customer_phone || '-'}</span></div>
                <div><strong>{language === 'ar' ? 'التاريخ:' : 'Date:'}</strong> {new Date(selectedRegForm.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</div>
                <div><strong>{language === 'ar' ? 'الحالة:' : 'Status:'}</strong>
                  <Badge variant="outline" className={`ms-2 ${selectedRegForm.status === 'converted' ? 'bg-green-100 text-green-700' : selectedRegForm.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {selectedRegForm.status === 'converted' ? (language === 'ar' ? 'تم تحويلها' : 'Converted') : selectedRegForm.status === 'cancelled' ? (language === 'ar' ? 'ملغاة' : 'Cancelled') : (language === 'ar' ? 'قيد الانتظار' : 'Pending')}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'البند' : 'Item'}</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'الفترة' : 'Period'}</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'المواعيد' : 'Schedule'}</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRegForm.items?.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2">{idx + 1}</td>
                      <td className="p-2 font-medium">{item.activity_name} {item.is_product && <Badge variant="secondary" className="text-xs">منتج</Badge>}</td>
                      <td className="p-2 text-sm">{item.is_product ? `الكمية: ${item.quantity || 1}` : (item.period || '-')}</td>
                      <td className="p-2 text-sm text-blue-600">{item.schedule || '-'}</td>
                      <td className="p-2 font-medium">{((item.fee || 0) * (item.quantity || 1)).toFixed(2)} {t('sar')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-gray-50 border rounded-lg space-y-2">
              <div className="flex justify-between text-sm"><span>{language === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span><span>{selectedRegForm.subtotal?.toFixed(2)} {t('sar')}</span></div>
              {selectedRegForm.discount > 0 && <div className="flex justify-between text-sm text-red-600"><span>{language === 'ar' ? 'الخصم:' : 'Discount:'}</span><span>- {selectedRegForm.discount?.toFixed(2)} {t('sar')}</span></div>}
              <div className="flex justify-between font-bold text-lg text-primary pt-2 border-t"><span>{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span><span>{selectedRegForm.total?.toFixed(2)} {t('sar')}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <strong>{language === 'ar' ? '💳 طريقة الدفع:' : '💳 Payment:'}</strong> {selectedRegForm.payment_method === 'cash' ? (language === 'ar' ? 'نقداً' : 'Cash') : selectedRegForm.payment_method === 'card' ? (language === 'ar' ? 'بطاقة' : 'Card') : selectedRegForm.payment_method === 'transfer' ? (language === 'ar' ? 'تحويل' : 'Transfer') : selectedRegForm.payment_method}
              </div>
              {selectedRegForm.notes && <div className="p-3 bg-gray-100 border rounded-lg"><strong>{language === 'ar' ? '📝 ملاحظات:' : '📝 Notes:'}</strong> {selectedRegForm.notes}</div>}
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button>
          <Button variant="outline" onClick={() => onPrint(selectedRegForm)} className="text-gray-700 border-gray-400"><Printer className="w-4 h-4 me-2" />{language === 'ar' ? 'طباعة' : 'Print'}</Button>
          <Button variant="outline" onClick={() => onSavePdf(selectedRegForm)} className="text-teal-600 border-teal-300"><FileText className="w-4 h-4 me-2" />{language === 'ar' ? 'حفظ PDF' : 'Save PDF'}</Button>
          <Button variant="outline" onClick={() => onSendWhatsApp(selectedRegForm)} className="text-green-600 border-green-400 hover:bg-green-50"><MessageSquare className="w-4 h-4 me-2" />{language === 'ar' ? 'واتساب' : 'WhatsApp'}</Button>
          {selectedRegForm?.status === 'pending' && (
            <>
              <Button variant="outline" onClick={() => { onOpenChange(false); onEdit(selectedRegForm); }} className="text-orange-600 border-orange-300"><Edit className="w-4 h-4 me-2" />{language === 'ar' ? 'تعديل' : 'Edit'}</Button>
              <Button onClick={() => { onOpenChange(false); onConvert(selectedRegForm.id); }} className="bg-blue-600 hover:bg-blue-700"><ArrowRightCircle className="w-4 h-4 me-2" />{language === 'ar' ? 'تحويل إلى فاتورة' : 'Convert to Invoice'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
