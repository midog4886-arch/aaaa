/**
 * Invoice Form Component
 * Form for creating and editing invoices
 */
import React, { useState, useEffect } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Plus, Trash2, Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_METHODS, VAT_RATE, SUBSCRIPTION_PERIODS, DAYS_OF_WEEK } from './constants';

// Build a readable display name for a level matching the LevelsPage card view
const getLevelDisplayName = (level) => {
  if (!level) return '';
  const label = level.display_name || (level.custom_name ? level.custom_name : `المستوى ${level.level_number}`);
  const activity = level.activity_name || '';
  return activity ? `${label} - ${activity}` : label;
};

const InvoiceForm = ({
  isOpen,
  onClose,
  onSave,
  member,
  activities,
  levels,
  products,
  isEditMode = false,
  initialData = null,
  language = 'ar'
}) => {
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saving, setSaving] = useState(false);

  // Initialize form when opened
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setItems(initialData.items || []);
        setDiscount(initialData.discount || 0);
        setNotes(initialData.notes || '');
        setPaymentMethod(initialData.payment_method || 'cash');
      } else {
        setItems([]);
        setDiscount(0);
        setNotes('');
        setPaymentMethod('cash');
      }
    }
  }, [isOpen, initialData]);

  // Add new activity item
  const addActivityItem = () => {
    setItems([...items, {
      activity_id: '',
      activity_name: '',
      fee: 0,
      period: 'monthly',
      schedule: '',
      level_id: '',
      level_name: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      is_product: false,
      quantity: 1
    }]);
  };

  // Add product item
  const addProductItem = () => {
    setItems([...items, {
      activity_id: '',
      activity_name: '',
      fee: 0,
      period: '',
      is_product: true,
      product_id: '',
      quantity: 1
    }]);
  };

  // Update item
  const updateItem = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;

    // Auto-fill activity name and fee when activity selected
    if (field === 'activity_id' && !newItems[index].is_product) {
      const activity = activities.find(a => a.id === value);
      if (activity) {
        newItems[index].activity_name = activity.name_ar || activity.name;
        newItems[index].fee = activity.fee || activity.monthly_fee || 0;
      }
    }

    // Auto-fill product name and price
    if (field === 'product_id' && newItems[index].is_product) {
      const product = products?.find(p => p.id === value);
      if (product) {
        newItems[index].activity_name = product.name_ar || product.name;
        newItems[index].fee = product.price || 0;
      }
    }

    // Auto-fill level name
    if (field === 'level_id') {
      const level = levels?.find(l => l.id === value);
      if (level) {
        newItems[index].level_name = getLevelDisplayName(level);
      }
    }

    setItems(newItems);
  };

  // Remove item
  const removeItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + (item.fee || 0) * (item.quantity || 1), 0);
  const taxableAmount = subtotal - discount;
  const vatAmount = taxableAmount * (VAT_RATE / 100);
  const total = taxableAmount + vatAmount;

  // Handle save
  const handleSave = async () => {
    if (items.length === 0) {
      toast.error(language === 'ar' ? 'أضف عنصر واحد على الأقل' : 'Add at least one item');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        member_id: member?.id,
        items,
        discount,
        notes,
        payment_method: paymentMethod
      });
      onClose();
    } catch (error) {
      toast.error(error.message || 'Error saving invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isEditMode 
              ? (language === 'ar' ? 'تعديل الفاتورة' : 'Edit Invoice')
              : (language === 'ar' ? 'فاتورة جديدة' : 'New Invoice')
            }
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Member Info */}
          {member && (
            <div className="bg-orange-50 p-4 rounded-lg">
              <p className="font-bold text-lg">{member.name_ar || member.name}</p>
              <p className="text-sm text-gray-600">
                {language === 'ar' ? 'رقم العضوية' : 'Member Code'}: {member.member_code}
              </p>
              <p className="text-sm text-gray-600">
                {language === 'ar' ? 'الجوال' : 'Phone'}: {member.phone}
              </p>
            </div>
          )}

          {/* Items */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-lg font-bold">
                {language === 'ar' ? 'البنود' : 'Items'}
              </Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addActivityItem}>
                  <Plus className="w-4 h-4 ml-1" />
                  {language === 'ar' ? 'نشاط' : 'Activity'}
                </Button>
                {products && products.length > 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={addProductItem}>
                    <Package className="w-4 h-4 ml-1" />
                    {language === 'ar' ? 'منتج' : 'Product'}
                  </Button>
                )}
              </div>
            </div>

            {items.map((item, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3 bg-gray-50">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-orange-600">
                    {item.is_product 
                      ? (language === 'ar' ? `منتج ${index + 1}` : `Product ${index + 1}`)
                      : (language === 'ar' ? `نشاط ${index + 1}` : `Activity ${index + 1}`)
                    }
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {/* Activity/Product Selection */}
                  {item.is_product ? (
                    <div>
                      <Label>{language === 'ar' ? 'المنتج' : 'Product'}</Label>
                      <Select
                        value={item.product_id}
                        onValueChange={(v) => updateItem(index, 'product_id', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={language === 'ar' ? 'اختر منتج' : 'Select product'} />
                        </SelectTrigger>
                        <SelectContent>
                          {products?.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name_ar || p.name} - {p.price} ر.س
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <Label>{language === 'ar' ? 'النشاط' : 'Activity'}</Label>
                      <Select
                        value={item.activity_id}
                        onValueChange={(v) => updateItem(index, 'activity_id', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={language === 'ar' ? 'اختر نشاط' : 'Select activity'} />
                        </SelectTrigger>
                        <SelectContent>
                          {activities?.map(a => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name_ar || a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Fee */}
                  <div>
                    <Label>{language === 'ar' ? 'السعر' : 'Price'}</Label>
                    <Input
                      type="number"
                      value={item.fee}
                      onChange={(e) => updateItem(index, 'fee', parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  {/* Quantity */}
                  <div>
                    <Label>{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                    />
                  </div>

                  {/* Activity-specific fields */}
                  {!item.is_product && (
                    <>
                      {/* Period */}
                      <div>
                        <Label>{language === 'ar' ? 'المدة' : 'Period'}</Label>
                        <Select
                          value={item.period}
                          onValueChange={(v) => updateItem(index, 'period', v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SUBSCRIPTION_PERIODS.map(p => (
                              <SelectItem key={p.value} value={p.value}>
                                {language === 'ar' ? p.label : p.labelEn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Start Date */}
                      <div>
                        <Label>{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                        <Input
                          type="date"
                          value={item.start_date}
                          onChange={(e) => updateItem(index, 'start_date', e.target.value)}
                        />
                      </div>

                      {/* End Date */}
                      <div>
                        <Label>{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                        <Input
                          type="date"
                          value={item.end_date}
                          onChange={(e) => updateItem(index, 'end_date', e.target.value)}
                        />
                      </div>

                      {/* Level */}
                      {levels && levels.length > 0 && (
                        <div>
                          <Label>{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                          <Select
                            value={item.level_id}
                            onValueChange={(v) => updateItem(index, 'level_id', v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={language === 'ar' ? 'اختياري' : 'Optional'} />
                            </SelectTrigger>
                            <SelectContent>
                              {levels.map(l => (
                                <SelectItem key={l.id} value={l.id}>
                                  {getLevelDisplayName(l)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Schedule */}
                      <div className="col-span-2">
                        <Label>{language === 'ar' ? 'المواعيد' : 'Schedule'}</Label>
                        <Input
                          value={item.schedule}
                          onChange={(e) => updateItem(index, 'schedule', e.target.value)}
                          placeholder={language === 'ar' ? 'مثال: الأحد والثلاثاء 4-5 مساءً' : 'e.g., Sun & Tue 4-5 PM'}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Item Total */}
                <div className="text-left text-sm font-medium text-gray-600">
                  {language === 'ar' ? 'المجموع' : 'Total'}: {((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                {language === 'ar' ? 'لم تتم إضافة أي بنود بعد' : 'No items added yet'}
              </div>
            )}
          </div>

          {/* Discount */}
          <div>
            <Label>{language === 'ar' ? 'الخصم (ر.س)' : 'Discount (SAR)'}</Label>
            <Input
              type="number"
              min="0"
              value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* Payment Method */}
          <div>
            <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    {language === 'ar' ? m.label : m.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div>
            <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Totals */}
          <div className="bg-gray-100 p-4 rounded-lg space-y-2">
            <div className="flex justify-between">
              <span>{language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}:</span>
              <span>{subtotal.toFixed(2)} ر.س</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>{language === 'ar' ? 'الخصم' : 'Discount'}:</span>
                <span>-{discount.toFixed(2)} ر.س</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{language === 'ar' ? 'ضريبة القيمة المضافة (15%)' : 'VAT (15%)'}:</span>
              <span>{vatAmount.toFixed(2)} ر.س</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-orange-600 border-t pt-2">
              <span>{language === 'ar' ? 'الإجمالي' : 'Total'}:</span>
              <span>{total.toFixed(2)} ر.س</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-orange-500 hover:bg-orange-600">
            {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            {language === 'ar' ? 'حفظ' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InvoiceForm;
