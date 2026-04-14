import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Textarea } from '../../../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Edit, FileText, Trash2 } from 'lucide-react';

export const EditRegFormDialog = ({
  isOpen, onOpenChange,
  regFormData, setRegFormData,
  regFormItems, setRegFormItems,
  regFormItemType, setRegFormItemType,
  regFormPaymentMethod, setRegFormPaymentMethod,
  regFormNotes, setRegFormNotes,
  regFormDiscount, regFormCouponDiscount,
  activities, products,
  addActivityToRegForm, addProductToRegForm, removeActivityFromRegForm,
  closeEditRegFormDialog, handleSaveEditedRegForm,
  language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeEditRegFormDialog(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-5 h-5 text-orange-600" />
            {language === 'ar' ? 'تعديل استمارة التسجيل' : 'Edit Registration Form'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم المشترك *' : 'Customer Name *'}</Label>
              <Input
                value={regFormData.customer_name}
                onChange={(e) => setRegFormData({...regFormData, customer_name: e.target.value})}
                placeholder={language === 'ar' ? 'أدخل اسم المشترك' : 'Enter customer name'}
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'رقم الجوال' : 'Phone Number'}</Label>
              <Input
                value={regFormData.customer_phone}
                onChange={(e) => setRegFormData({...regFormData, customer_phone: e.target.value})}
                placeholder="05xxxxxxxx"
                dir="ltr"
              />
            </div>
          </div>

          <div className="flex gap-2 p-2 bg-muted rounded-lg">
            <Button type="button" variant={regFormItemType === 'activity' ? 'default' : 'outline'} onClick={() => setRegFormItemType('activity')} className="flex-1" size="sm">
              {language === 'ar' ? 'نشاط' : 'Activity'}
            </Button>
            <Button type="button" variant={regFormItemType === 'product' ? 'default' : 'outline'} onClick={() => setRegFormItemType('product')} className="flex-1" size="sm">
              {language === 'ar' ? 'منتج' : 'Product'}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'إضافة ' + (regFormItemType === 'activity' ? 'نشاط' : 'منتج') : 'Add ' + (regFormItemType === 'activity' ? 'Activity' : 'Product')}</Label>
            <Select onValueChange={(value) => {
              if (regFormItemType === 'activity') {
                const activity = activities.find(a => a.id === value);
                if (activity) addActivityToRegForm(activity);
              } else {
                const product = products.find(p => p.id === value);
                if (product) addProductToRegForm(product);
              }
            }}>
              <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر...' : 'Select...'} /></SelectTrigger>
              <SelectContent>
                {regFormItemType === 'activity'
                  ? (activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name} - {a.monthly_fee} {t('sar')}</SelectItem>)
                  : (products || []).filter(p => p.id).map(p => <SelectItem key={p.id} value={p.id}>{p.name_ar || p.name} - {p.price} {t('sar')}</SelectItem>)
                }
              </SelectContent>
            </Select>
          </div>

          {regFormItems.length > 0 && (
            <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-lg p-2">
              {(regFormItems || []).map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 bg-muted/50 rounded border">
                  <span className="flex-1 font-medium text-sm">{item.activity_name}</span>
                  <Input
                    type="number"
                    value={item.fee}
                    onChange={(e) => {
                      const updated = [...regFormItems];
                      updated[idx].fee = parseFloat(e.target.value) || 0;
                      setRegFormItems(updated);
                    }}
                    className="w-24 text-sm"
                  />
                  <span className="text-sm text-muted-foreground">{t('sar')}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeActivityFromRegForm(idx)} className="text-red-600 h-8 w-8 p-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
            <Select value={regFormPaymentMethod} onValueChange={setRegFormPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                <SelectItem value="transfer">{language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
            <Textarea
              value={regFormNotes}
              onChange={(e) => setRegFormNotes(e.target.value)}
              placeholder={language === 'ar' ? 'أدخل ملاحظات...' : 'Enter notes...'}
              rows={2}
            />
          </div>

          {regFormItems.length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex justify-between font-bold text-lg text-primary">
                <span>{t('total')}:</span>
                <span>{(regFormItems.reduce((sum, i) => sum + ((i.fee || 0) * (i.quantity || 1)), 0) - regFormDiscount - regFormCouponDiscount).toFixed(2)} {t('sar')}</span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeEditRegFormDialog}>{t('cancel')}</Button>
          <Button onClick={handleSaveEditedRegForm} disabled={!regFormData.customer_name || regFormItems.length === 0} className="bg-orange-600 hover:bg-orange-700">
            <FileText className="w-4 h-4 me-2" />
            {language === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
