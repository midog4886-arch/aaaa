import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Badge } from '../../../../components/ui/badge';
import { Card } from '../../../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { CheckCircle, Loader2, Lock, Package, Percent, Receipt, Tag, Trash2, UserPlus, Users, X } from 'lucide-react';
import { COMPANY_INFO } from '../../constants';
import { MAIN_ACTIVITIES_FOR_LEVELS } from '../../constants';
import { membersAPI, levelsAPI } from '../../../../services/api';
import { toast } from 'sonner';

export const CreateEditInvoiceDialog = ({
  isOpen, onOpenChange,
  isEditMode,
  members, activities, products, levels, coaches = [],
  selectedMember, handleMemberSelect,
  customerNameAr, setCustomerNameAr,
  customerPhone, setCustomerPhone,
  invoiceItems, setInvoiceItems,
  itemType, setItemType,
  paymentMethod, setPaymentMethod,
  couponCode, setCouponCode,
  appliedCoupon, setAppliedCoupon,
  couponDiscount, setCouponDiscount,
  validatingCoupon,
  notes, setNotes,
  subtotal, vatAmount, total,
  saving,
  additionalMembers, setAdditionalMembers,
  additionalMemberNewForm, setAdditionalMemberNewForm,
  levelSelectorState, levelCapacityWarnings,
  feeEditUnlocked,
  groupedLevelsForSelector,
  getGroupedLevelsForDays,
  addActivityToInvoice, addProductToInvoice, removeItem,
  updateItemDate, updateItemWeeks, updateItemFee,
  initLevelSelector, goBackLevelSelector, resetLevelSelector,
  selectLevelActivity, selectLevelTime, updateItemLevel,
  handleAcceptFullLevel, handleRejectFullLevel,
  unlockFeeEdit, validateCoupon,
  closeCreateDialog, handleCreateInvoice,
  calcEndDate, parseActivityForLevel,
  language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEditMode ? (language === 'ar' ? 'تعديل الفاتورة' : 'Edit Invoice') : t('create_invoice')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>{language === 'ar' ? 'اختر العضو' : 'Select member'}</Label>
            <Select value={selectedMember?.id || 'none'} onValueChange={handleMemberSelect}>
              <SelectTrigger><SelectValue placeholder={t('member_name')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{language === 'ar' ? '-- بدون عضو --' : '-- No member --'}</SelectItem>
                <SelectItem value="new" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                {(members || []).filter(m => m.id).map(m => <SelectItem key={m.id} value={m.id}>{m.member_id && <span className="font-mono text-primary font-semibold me-1">#{m.member_id}</span>}{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card className="p-4 border-primary/20 bg-primary/5">
            <h4 className="font-semibold mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />{language === 'ar' ? 'بيانات العميل' : 'Customer Data'}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>{language === 'ar' ? 'اسم العميل *' : 'Customer Name *'}</Label><Input value={customerNameAr} onChange={(e) => setCustomerNameAr(e.target.value)} required /></div>
              <div className="space-y-2"><Label>{t('phone')}</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} type="tel" dir="ltr" /></div>
            </div>
          </Card>

          <div className="flex gap-2 p-2 bg-muted rounded-lg">
            <Button type="button" variant={itemType === 'activity' ? 'default' : 'outline'} onClick={() => setItemType('activity')} className="flex-1" data-testid="item-type-activity">
              <Receipt className="w-4 h-4 me-2" />{language === 'ar' ? 'الأنشطة' : 'Activities'}
            </Button>
            <Button type="button" variant={itemType === 'product' ? 'default' : 'outline'} onClick={() => setItemType('product')} className="flex-1" data-testid="item-type-product">
              <Package className="w-4 h-4 me-2" />{language === 'ar' ? 'المنتجات' : 'Products'}
            </Button>
          </div>

          {selectedMember && selectedMember.activities && selectedMember.activities.length > 0 && itemType === 'activity' && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-3">📋 {language === 'ar' ? `أنشطة ${selectedMember.name_ar || selectedMember.name} الحالية` : `${selectedMember.name_ar || selectedMember.name}'s Current Activities`}</h4>
              <div className="space-y-2">
                {(selectedMember.activities || []).map((act, idx) => {
                  const isAlreadyAdded = invoiceItems.some(item => item.activity_id === act.activity_id && item.start_date === act.start_date && item.end_date === act.end_date);
                  return (
                    <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border">
                      <div className="flex-1">
                        <span className="font-medium">{act.activity_name}</span>
                        <span className="text-sm text-gray-500 mx-2">|</span>
                        <span className="text-sm text-gray-600">{act.start_date} → {act.end_date}</span>
                        <span className={`mx-2 text-xs px-2 py-0.5 rounded ${act.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {act.status === 'active' ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'منتهي' : 'Expired')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-orange-600">{act.fee || 0} {t('sar')}</span>
                        {!isAlreadyAdded ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => {
                            const activity = activities.find(a => a.id === act.activity_id);
                            setInvoiceItems([...invoiceItems, { activity_id: act.activity_id, activity_name: act.activity_name, start_date: act.start_date, end_date: act.end_date, fee: act.fee || (activity ? activity.monthly_fee : 0), is_product: false }]);
                            toast.success(language === 'ar' ? 'تم إضافة النشاط للفاتورة' : 'Activity added to invoice');
                          }} className="text-blue-600 border-blue-300 hover:bg-blue-50">
                            + {language === 'ar' ? 'إضافة' : 'Add'}
                          </Button>
                        ) : (
                          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">✓ {language === 'ar' ? 'مضاف' : 'Added'}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {itemType === 'activity' && (
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'إضافة نشاط جديد' : 'Add new activity'}</Label>
              <Select value="" onValueChange={addActivityToInvoice}>
                <SelectTrigger data-testid="activity-selector"><SelectValue placeholder={language === 'ar' ? '+ اختر نشاط لإضافته' : '+ Select activity to add'} /></SelectTrigger>
                <SelectContent>
                  {(() => {
                    // Group activities by main type so all swimming entries
                    // share one color, all football share another, etc.
                    // Detection mirrors MembersPage.parseActivityForLevel.
                    const styleFor = (rawName) => {
                      const name = (rawName || '').toLowerCase();
                      if (name.includes('سباح') || name.includes('swim'))
                        return { dot: 'bg-blue-500', text: 'text-blue-700', icon: '🏊' };
                      if (name.includes('كر') || name.includes('foot') || name.includes('قدم'))
                        return { dot: 'bg-green-500', text: 'text-green-700', icon: '⚽' };
                      if (name.includes('كارات') || name.includes('karate'))
                        return { dot: 'bg-red-500', text: 'text-red-700', icon: '🥋' };
                      return { dot: 'bg-gray-400', text: 'text-gray-700', icon: '📋' };
                    };
                    return (activities || []).filter(a => a.id).map(a => {
                      const label = language === 'ar' ? a.name_ar : a.name;
                      const s = styleFor(a.name_ar || a.name);
                      return (
                        <SelectItem key={a.id} value={a.id}>
                          <div className="flex items-center justify-between w-full gap-4">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.dot}`} />
                              <span className="text-base">{s.icon}</span>
                              <span className={`font-medium ${s.text}`}>{label}</span>
                            </div>
                            <span className="font-bold text-orange-600">{a.monthly_fee} {t('sar')}</span>
                          </div>
                        </SelectItem>
                      );
                    });
                  })()}
                </SelectContent>
              </Select>
              {invoiceItems.filter(item => !item.is_product).length > 0 && <p className="text-xs text-green-600">✓ {language === 'ar' ? `تم إضافة ${invoiceItems.filter(item => !item.is_product).length} نشاط` : `${invoiceItems.filter(item => !item.is_product).length} activities added`}</p>}
            </div>
          )}

          {itemType === 'product' && (
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'إضافة منتج من المتجر' : 'Add product from store'}</Label>
              <Select value="" onValueChange={(id) => addProductToInvoice(id, 1)}>
                <SelectTrigger data-testid="product-selector"><SelectValue placeholder={language === 'ar' ? '+ اختر منتج لإضافته' : '+ Select product to add'} /></SelectTrigger>
                <SelectContent>
                  {products.filter(p => p.id && p.quantity > 0).map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2"><Package className="w-4 h-4 text-green-600" /><span>{p.name_ar}</span><span className="text-muted-foreground">({p.quantity} {language === 'ar' ? 'متوفر' : 'available'})</span><span className="font-bold">{p.price} {t('sar')}</span></div>
                    </SelectItem>
                  ))}
                  {products.filter(p => p.quantity > 0).length === 0 && <SelectItem value="none" disabled>{language === 'ar' ? 'لا توجد منتجات متوفرة' : 'No products available'}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}

          {invoiceItems.length > 0 && (
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'عناصر الفاتورة' : 'Invoice Items'}</Label>
              <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                {(invoiceItems || []).map((item, idx) => (
                  <div key={idx} className={`p-3 bg-background rounded-lg border space-y-2 ${item.is_product ? 'border-green-300 bg-green-50/50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {item.is_product ? <Package className="w-4 h-4 text-green-600" /> : <Receipt className="w-4 h-4 text-blue-600" />}
                        <p className="font-medium">{item.activity_name}</p>
                        {item.is_product && <Badge variant="outline" className="bg-green-100 text-green-700 text-xs">{language === 'ar' ? 'منتج' : 'Product'}</Badge>}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                    {item.is_product ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
                          <Input type="number" value={item.quantity || 1} onChange={(e) => {
                            const qty = parseInt(e.target.value) || 1;
                            const product = products.find(p => p.id === item.product_id);
                            if (product && qty <= product.quantity) {
                              const updated = [...invoiceItems];
                              updated[idx].quantity = qty;
                              updated[idx].fee = product.price * qty;
                              setInvoiceItems(updated);
                            }
                          }} min="1" className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'المبلغ' : 'Amount'}</Label>
                          <Input type="number" value={item.fee} className="h-8 text-sm bg-muted" disabled />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                          <Input type="date" value={item.start_date} onChange={(e) => updateItemDate(idx, 'start_date', e.target.value)} className="h-14 text-lg" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium flex items-center gap-2">
                            {language === 'ar' ? 'تاريخ النهاية' : 'End Date'}
                            <span className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                              <input type="number" min="1" max="52" value={item.weeks || 4} onChange={(e) => updateItemWeeks(idx, e.target.value)} className="w-8 text-xs text-center bg-transparent outline-none font-semibold text-blue-700" title={language === 'ar' ? 'عدد الأسابيع' : 'Weeks'} />
                              <span className="text-xs text-blue-600">{language === 'ar' ? 'أسبوع' : 'wks'}</span>
                            </span>
                          </Label>
                          <Input type="date" value={item.end_date} onChange={(e) => updateItemDate(idx, 'end_date', e.target.value)} className="h-14 text-lg" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs flex items-center gap-1">{language === 'ar' ? 'المبلغ' : 'Fee'}{!feeEditUnlocked && <Lock className="w-3 h-3 text-amber-500" />}</Label>
                          <Input type="number" value={item.fee} onChange={(e) => updateItemFee(idx, e.target.value)} className={`h-8 text-sm ${!feeEditUnlocked ? 'bg-amber-50 border-amber-200' : ''}`} onClick={() => !feeEditUnlocked && unlockFeeEdit()} />
                        </div>
                        <div className="space-y-1 col-span-4">
                          <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                          <div className="flex flex-wrap gap-1">
                            {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                              <button key={day} type="button" onClick={() => {
                                const currentDays = item.training_days || [];
                                const newDays = currentDays.includes(day) ? currentDays.filter(d => d !== day) : [...currentDays, day];
                                const updated = [...invoiceItems];
                                updated[idx].training_days = newDays;
                                if (!isEditMode && updated[idx].start_date) {
                                  const w = updated[idx].weeks ?? 4;
                                  updated[idx].end_date = calcEndDate(updated[idx].start_date, w, newDays);
                                  updated[idx].period = `${updated[idx].start_date} - ${updated[idx].end_date}`;
                                }
                                const formatSchedule = (days, time) => {
                                  if (days.length === 0) return time || '';
                                  const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                  const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                  let daysStr;
                                  if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; }
                                  return time ? `${daysStr} - ${time}` : daysStr;
                                };
                                updated[idx].schedule = formatSchedule(newDays, item.training_time);
                                setInvoiceItems(updated);
                              }} className={`px-2 py-1 text-xs rounded border transition-colors ${(item.training_days || []).includes(day) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>{day}</button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1 col-span-2">
                          <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                          <Input type="number" min="1" max="12" onWheel={(e) => e.currentTarget.blur()} value={item.training_time_hour || ''} onChange={(e) => {
                            const hour = e.target.value;
                            const updated = [...invoiceItems];
                            updated[idx].training_time_hour = hour;
                            const timeStr = hour ? `${hour}:00 م` : '';
                            updated[idx].training_time = timeStr;
                            const formatSchedule = (days, time) => {
                              if (!days || days.length === 0) return time || '';
                              const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                              const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                              let daysStr;
                              if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; }
                              return time ? `${daysStr} - ${time}` : daysStr;
                            };
                            updated[idx].schedule = formatSchedule(updated[idx].training_days, timeStr);
                            setInvoiceItems(updated);
                          }} className="h-8 text-sm" placeholder={language === 'ar' ? 'مثال: 4' : 'e.g. 4'} />
                          {item.training_time && <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>}
                        </div>
                        <div className="space-y-1 col-span-3">
                          <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                          {!levelSelectorState[idx] ? (
                            <div>
                              {item.level_id ? (
                                <div className={`flex items-center justify-between p-2 border rounded-lg ${levelCapacityWarnings[idx]?.isFull && !levelCapacityWarnings[idx]?.isAccepted ? 'border-orange-500 border-2 bg-orange-50' : levelCapacityWarnings[idx]?.isAccepted ? 'border-green-500 border-2 bg-green-50' : 'bg-gray-50'}`}>
                                  <span className="text-sm">{item.level_name}</span>
                                  <div className="flex gap-1">
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => initLevelSelector(idx)}>{language === 'ar' ? 'تغيير' : 'Change'}</Button>
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={() => updateItemLevel(idx, '')}>✕</Button>
                                  </div>
                                </div>
                              ) : (
                                <Button type="button" variant="outline" className="w-full h-8 text-sm justify-start gap-2" onClick={() => initLevelSelector(idx)}>
                                  <span>🎯</span>{language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                                </Button>
                              )}
                            </div>
                          ) : (() => {
                            const _grouped = getGroupedLevelsForDays(item.training_days || []);
                            return (
                            <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                              <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
                                <div className="flex items-center gap-2">
                                  {levelSelectorState[idx].step !== 'activity' && <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => goBackLevelSelector(idx)}>{language === 'ar' ? '→' : '←'}</Button>}
                                  <span className="text-xs font-medium text-gray-600">
                                    {levelSelectorState[idx].step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                    {levelSelectorState[idx].step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                    {levelSelectorState[idx].step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                  </span>
                                </div>
                                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => resetLevelSelector(idx)}>✕</Button>
                              </div>
                              {levelSelectorState[idx].step === 'activity' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                    const activityLevels = _grouped[activity.id] || {};
                                    const timeCount = Object.keys(activityLevels).length;
                                    if (timeCount === 0) return null;
                                    return (
                                      <button key={activity.id} type="button" className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10 hover:bg-opacity-20`} onClick={() => selectLevelActivity(idx, activity.id)}>
                                        <div className="flex items-center gap-2"><span className="text-xl">{activity.icon}</span><span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span></div>
                                        <div className="flex items-center gap-1 text-gray-500"><span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span><span>{language === 'ar' ? '←' : '→'}</span></div>
                                      </button>
                                    );
                                  })}
                                  {_grouped['other'] && Object.keys(_grouped['other']).length > 0 && (
                                    <button type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors bg-gray-100" onClick={() => selectLevelActivity(idx, 'other')}>
                                      <div className="flex items-center gap-2"><span className="text-xl">📋</span><span className="font-medium">{language === 'ar' ? 'أخرى' : 'Other'}</span></div>
                                      <span>{language === 'ar' ? '←' : '→'}</span>
                                    </button>
                                  )}
                                </div>
                              )}
                              {levelSelectorState[idx].step === 'time' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {Object.entries(_grouped[levelSelectorState[idx].selectedActivity] || {}).sort(([a], [b]) => { const na = parseInt((a.match(/\d+/) || [])[0]) || 0; const nb = parseInt((b.match(/\d+/) || [])[0]) || 0; return na - nb; }).map(([timeSlot, timeLevels]) => {
                                    const _itemDays = item.training_days || [];
                                    const totalMembers = timeLevels.reduce((sum, l) => {
                                      const activeDet = (l.members_details || []).filter(m => m.has_active_sub !== false);
                                      if (_itemDays.length > 0 && activeDet.length > 0) {
                                        const perDay = _itemDays.map(day => activeDet.filter(m => m.schedule && m.schedule.includes(day)).length);
                                        return sum + Math.max(...perDay, 0);
                                      }
                                      return sum + activeDet.length;
                                    }, 0);
                                    const totalCapacity = timeLevels.reduce((sum, l) => sum + (l.capacity || 10), 0);
                                    return (
                                      <button key={timeSlot} type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border" onClick={() => selectLevelTime(idx, timeSlot)}>
                                        <div className="flex items-center gap-2"><span className="text-lg">🕐</span><span className="font-medium text-sm">{timeSlot}</span></div>
                                        <div className="flex items-center gap-2"><span className="text-xs text-gray-500">{timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}</span><span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span></div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              {levelSelectorState[idx].step === 'level' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {(_grouped[levelSelectorState[idx].selectedActivity]?.[levelSelectorState[idx].selectedTime] || []).sort((a, b) => a.level_number - b.level_number).map(level => {
                                    const _days = item.training_days || [];
                                    const _activeDet = (level.members_details || []).filter(m => m.has_active_sub !== false);
                                    const memberCount = (_days.length > 0 && _activeDet.length > 0) ? Math.max(..._days.map(day => _activeDet.filter(m => m.schedule && m.schedule.includes(day)).length), 0) : _activeDet.length;
                                    const maxCapacity = level.capacity || 10;
                                    const isFull = memberCount >= maxCapacity;
                                    const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                    const levelCoach = level.coach_id ? coaches.find(c => c.id === level.coach_id) : null;
                                    const coachName = levelCoach ? (levelCoach.name_ar || levelCoach.name) : null;
                                    return (
                                      <button key={level.id} type="button" className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`} onClick={() => updateItemLevel(idx, level.id)}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>{level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)}</span>
                                          <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>{memberCount}/{maxCapacity} {isFull && '⚠️'}</span>
                                        </div>
                                        {coachName && (
                                          <div className="text-xs text-blue-600 mb-1 text-right">
                                            👤 {language === 'ar' ? 'المدرب: ' : 'Coach: '}{coachName}
                                          </div>
                                        )}
                                        <div className="w-full bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} /></div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            );
                          })()}
                          {levelCapacityWarnings[idx]?.isFull && !levelCapacityWarnings[idx]?.isAccepted && (
                            <div className="mt-2 p-2 bg-orange-50 border border-orange-300 rounded-lg">
                              <p className="text-xs text-orange-700 font-medium mb-2">⚠️ {levelCapacityWarnings[idx].message}</p>
                              <div className="flex gap-2">
                                <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-7" onClick={() => handleAcceptFullLevel(idx)}>✓ {language === 'ar' ? 'موافق' : 'Accept'}</Button>
                                <Button type="button" size="sm" variant="outline" className="border-red-500 text-red-600 hover:bg-red-50 text-xs h-7" onClick={() => handleRejectFullLevel(idx)}>✗ {language === 'ar' ? 'رفض' : 'Reject'}</Button>
                              </div>
                            </div>
                          )}
                          {levelCapacityWarnings[idx]?.isAccepted && <p className="text-xs text-green-600 font-medium mt-1">✓ {language === 'ar' ? 'تم قبول التسجيل رغم اكتمال العدد' : 'Registration accepted despite full capacity'}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isEditMode && (
            <Card className="p-4 border-blue-200 bg-blue-50/30">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-blue-800 flex items-center gap-2"><Users className="w-4 h-4" />{language === 'ar' ? 'أعضاء إضافيين (إخوة)' : 'Additional Members (Siblings)'}</h4>
                <Button type="button" size="sm" variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-100" onClick={() => setAdditionalMembers([...additionalMembers, { member: null, items: [] }])}>
                  <UserPlus className="w-4 h-4 me-1" />{language === 'ar' ? 'إضافة عضو آخر' : 'Add Another Member'}
                </Button>
              </div>
              {additionalMembers.length > 0 && (
                <div className="space-y-4">
                  {additionalMembers.map((am, amIdx) => (
                    <div key={amIdx} className="p-3 bg-white rounded-lg border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-blue-700">{language === 'ar' ? `العضو ${amIdx + 2}` : `Member ${amIdx + 2}`}{am.member && ` - ${am.member.name_ar || am.member.name}`}</span>
                        <Button type="button" size="sm" variant="ghost" className="text-red-500 h-7 w-7 p-0" onClick={() => setAdditionalMembers(additionalMembers.filter((_, i) => i !== amIdx))}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                      <Select value={am.member?.id || 'none'} onValueChange={(val) => {
                        if (val === 'none') return;
                        if (val === 'new_member') { setAdditionalMemberNewForm({ show: true, index: amIdx, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } }); return; }
                        const member = members.find(m => m.id === val);
                        const updated = [...additionalMembers];
                        updated[amIdx] = { ...updated[amIdx], member };
                        setAdditionalMembers(updated);
                      }}>
                        <SelectTrigger className="mb-2"><SelectValue placeholder={language === 'ar' ? 'اختر العضو...' : 'Select member...'} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{language === 'ar' ? '-- اختر --' : '-- Select --'}</SelectItem>
                          <SelectItem value="new_member" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                          {(members || []).filter(m => m.id && m.id !== selectedMember?.id && !additionalMembers.some((a, i) => i !== amIdx && a.member?.id === m.id)).map(m => <SelectItem key={m.id} value={m.id}>{m.member_id && <span className="font-mono text-primary font-semibold me-1">#{m.member_id}</span>}{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {additionalMemberNewForm.show && additionalMemberNewForm.index === amIdx && (
                        <div className="p-3 mb-2 bg-green-50 border border-green-300 rounded-lg space-y-2">
                          <h5 className="text-sm font-bold text-green-800">{language === 'ar' ? 'إضافة عضو جديد' : 'Add New Member'}</h5>
                          <Input placeholder={language === 'ar' ? 'اسم العميل *' : 'Customer name *'} value={additionalMemberNewForm.data.name_ar} onChange={(e) => setAdditionalMemberNewForm(prev => ({ ...prev, data: { ...prev.data, name_ar: e.target.value } }))} />
                          <div className="flex gap-2 justify-end">
                            <Button type="button" size="sm" variant="outline" onClick={() => setAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } })}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</Button>
                            <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700" disabled={!additionalMemberNewForm.data.name_ar} onClick={async () => {
                              try {
                                const res = await membersAPI.create({ name_ar: additionalMemberNewForm.data.name_ar, name: additionalMemberNewForm.data.name_ar, phone: customerPhone || '', status: 'active' });
                                const newMember = res.data;
                                const updated = [...additionalMembers];
                                updated[amIdx] = { ...updated[amIdx], member: newMember };
                                setAdditionalMembers(updated);
                                setAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
                                toast.success(language === 'ar' ? 'تم إضافة العضو بنجاح' : 'Member added successfully');
                              } catch (error) { toast.error(language === 'ar' ? 'خطأ في إضافة العضو' : 'Error adding member'); }
                            }}><UserPlus className="w-4 h-4 me-1" />{language === 'ar' ? 'حفظ' : 'Save'}</Button>
                          </div>
                        </div>
                      )}
                      {am.member && (
                        <>
                          <Select value="" onValueChange={(actId) => {
                            const activity = activities.find(a => a.id === actId);
                            if (!activity) return;
                            const today = new Date().toISOString().split('T')[0];
                            const defaultWeeks = 4;
                            const endDate = calcEndDate(today, defaultWeeks);
                            const newItem = { activity_id: activity.id, activity_name: activity.name_ar || activity.name, fee: activity.monthly_fee || 0, period: `${today} - ${endDate}`, schedule: activity.schedule || '', start_date: today, end_date: endDate, weeks: defaultWeeks, training_days: [], training_time: '', is_product: false };
                            const updated = [...additionalMembers];
                            updated[amIdx] = { ...updated[amIdx], items: [...updated[amIdx].items, newItem] };
                            setAdditionalMembers(updated);
                          }}>
                            <SelectTrigger className="mb-2"><SelectValue placeholder={language === 'ar' ? '+ اختر نشاط...' : '+ Select activity...'} /></SelectTrigger>
                            <SelectContent>
                              {(() => {
                                const styleFor = (rawName) => {
                                  const name = (rawName || '').toLowerCase();
                                  if (name.includes('سباح') || name.includes('swim'))
                                    return { dot: 'bg-blue-500', text: 'text-blue-700', icon: '🏊' };
                                  if (name.includes('كر') || name.includes('foot') || name.includes('قدم'))
                                    return { dot: 'bg-green-500', text: 'text-green-700', icon: '⚽' };
                                  if (name.includes('كارات') || name.includes('karate'))
                                    return { dot: 'bg-red-500', text: 'text-red-700', icon: '🥋' };
                                  return { dot: 'bg-gray-400', text: 'text-gray-700', icon: '📋' };
                                };
                                return (activities || []).filter(a => a.id).map(a => {
                                  const label = a.name_ar || a.name;
                                  const s = styleFor(label);
                                  return (
                                    <SelectItem key={a.id} value={a.id}>
                                      <div className="flex items-center justify-between w-full gap-3">
                                        <div className="flex items-center gap-2">
                                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.dot}`} />
                                          <span className="text-base">{s.icon}</span>
                                          <span className={`font-medium ${s.text}`}>{label}</span>
                                        </div>
                                        <span className="font-bold text-orange-600">{a.monthly_fee} {language === 'ar' ? 'ر.س' : 'SAR'}</span>
                                      </div>
                                    </SelectItem>
                                  );
                                });
                              })()}
                            </SelectContent>
                          </Select>
                          {am.items.length > 0 && (
                            <div className="space-y-2">
                              {am.items.map((item, itemIdx) => (
                                <div key={itemIdx} className="p-2 bg-blue-50 rounded text-sm space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{item.activity_name}</span>
                                    <div className="flex items-center gap-2">
                                      <Input type="number" value={item.fee} onChange={(e) => { const updated = [...additionalMembers]; updated[amIdx].items[itemIdx].fee = parseFloat(e.target.value) || 0; setAdditionalMembers(updated); }} className="w-20 h-7 text-sm text-center" />
                                      <span className="text-xs text-muted-foreground">{language === 'ar' ? 'ر.س' : 'SAR'}</span>
                                      <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => { const updated = [...additionalMembers]; updated[amIdx].items = updated[amIdx].items.filter((_, i) => i !== itemIdx); setAdditionalMembers(updated); }}><X className="w-3 h-3" /></Button>
                                    </div>
                                  </div>
                                  {!item.is_product && (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                          <Label className="text-xs">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                                          <Input type="date" value={item.start_date || ''} onChange={(e) => {
                                            const updated = [...additionalMembers];
                                            updated[amIdx].items[itemIdx].start_date = e.target.value;
                                            const w = updated[amIdx].items[itemIdx].weeks ?? 4;
                                            updated[amIdx].items[itemIdx].end_date = calcEndDate(e.target.value, w, updated[amIdx].items[itemIdx].training_days);
                                            updated[amIdx].items[itemIdx].period = `${e.target.value} - ${updated[amIdx].items[itemIdx].end_date}`;
                                            setAdditionalMembers(updated);
                                          }} className="h-7 text-xs" />
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-xs flex items-center gap-1">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}
                                            <span className="flex items-center gap-0.5 bg-blue-50 border border-blue-200 rounded px-1 py-0.5">
                                              <input type="number" min="1" max="52" value={item.weeks || 4} onChange={(e) => {
                                                const updated = [...additionalMembers];
                                                updated[amIdx].items[itemIdx].weeks = parseInt(e.target.value, 10) || 4;
                                                if (updated[amIdx].items[itemIdx].start_date) {
                                                  updated[amIdx].items[itemIdx].end_date = calcEndDate(updated[amIdx].items[itemIdx].start_date, updated[amIdx].items[itemIdx].weeks, updated[amIdx].items[itemIdx].training_days);
                                                  updated[amIdx].items[itemIdx].period = `${updated[amIdx].items[itemIdx].start_date} - ${updated[amIdx].items[itemIdx].end_date}`;
                                                }
                                                setAdditionalMembers(updated);
                                              }} className="w-7 text-xs text-center bg-transparent outline-none font-semibold text-blue-700" />
                                              <span className="text-xs text-blue-600">{language === 'ar' ? 'أ' : 'w'}</span>
                                            </span>
                                          </Label>
                                          <Input type="date" value={item.end_date || ''} onChange={(e) => { const updated = [...additionalMembers]; updated[amIdx].items[itemIdx].end_date = e.target.value; updated[amIdx].items[itemIdx].period = `${updated[amIdx].items[itemIdx].start_date} - ${e.target.value}`; setAdditionalMembers(updated); }} className="h-7 text-xs" />
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                                        <div className="flex flex-wrap gap-1">
                                          {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                                            <button key={day} type="button" onClick={() => {
                                              const currentDays = item.training_days || [];
                                              const newDays = currentDays.includes(day) ? currentDays.filter(d => d !== day) : [...currentDays, day];
                                              const updated = [...additionalMembers];
                                              updated[amIdx].items[itemIdx].training_days = newDays;
                                              if (updated[amIdx].items[itemIdx].start_date) {
                                                const w = updated[amIdx].items[itemIdx].weeks ?? 4;
                                                updated[amIdx].items[itemIdx].end_date = calcEndDate(updated[amIdx].items[itemIdx].start_date, w, newDays);
                                                updated[amIdx].items[itemIdx].period = `${updated[amIdx].items[itemIdx].start_date} - ${updated[amIdx].items[itemIdx].end_date}`;
                                              }
                                              const formatSchedule = (days, time) => {
                                                if (days.length === 0) return time || '';
                                                const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                                const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                                let daysStr;
                                                if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; }
                                                return time ? `${daysStr} - ${time}` : daysStr;
                                              };
                                              updated[amIdx].items[itemIdx].schedule = formatSchedule(newDays, item.training_time);
                                              setAdditionalMembers(updated);
                                            }} className={`px-2 py-1 text-xs rounded border transition-colors ${(item.training_days || []).includes(day) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>{day}</button>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                          <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                                          <Input type="number" min="1" max="12" onWheel={(e) => e.currentTarget.blur()} placeholder={language === 'ar' ? 'مثال: 4' : 'e.g., 4'} value={item.training_time_hour || ''} onChange={(e) => {
                                            const hour = e.target.value;
                                            const updated = [...additionalMembers];
                                            updated[amIdx].items[itemIdx].training_time_hour = hour;
                                            const timeStr = hour ? `${hour}:00 م` : '';
                                            updated[amIdx].items[itemIdx].training_time = timeStr;
                                            const formatSchedule = (days, time) => {
                                              if (!days || days.length === 0) return time || '';
                                              const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                              const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                              let daysStr;
                                              if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; }
                                              return time ? `${daysStr} - ${time}` : daysStr;
                                            };
                                            updated[amIdx].items[itemIdx].schedule = formatSchedule(updated[amIdx].items[itemIdx].training_days, timeStr);
                                            setAdditionalMembers(updated);
                                          }} className="h-7 text-sm" />
                                          {item.training_time && <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>}
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                                          {(() => {
                                            const selKey = `am-${amIdx}-${itemIdx}`;
                                            const selectAmLevel = (levelId) => {
                                              const updated = [...additionalMembers];
                                              const level = levels.find(l => l.id === levelId);
                                              updated[amIdx].items[itemIdx].level_id = levelId;
                                              updated[amIdx].items[itemIdx].level_name = level ? `${level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)} - ${level.activity_name}` : '';
                                              setAdditionalMembers(updated);
                                              resetLevelSelector(selKey);
                                            };
                                            const clearAmLevel = () => {
                                              const updated = [...additionalMembers];
                                              updated[amIdx].items[itemIdx].level_id = '';
                                              updated[amIdx].items[itemIdx].level_name = '';
                                              setAdditionalMembers(updated);
                                            };
                                            const _grouped = getGroupedLevelsForDays(item.training_days || []);
                                            return !levelSelectorState[selKey] ? (
                                              <div>
                                                {item.level_id ? (
                                                  <div className="flex items-center justify-between p-2 border rounded-lg bg-gray-50">
                                                    <span className="text-sm">{item.level_name}</span>
                                                    <div className="flex gap-1">
                                                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => initLevelSelector(selKey)}>{language === 'ar' ? 'تغيير' : 'Change'}</Button>
                                                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={clearAmLevel}>✕</Button>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <Button type="button" variant="outline" className="w-full h-8 text-sm justify-start gap-2" onClick={() => initLevelSelector(selKey)}>
                                                    <span>🎯</span>{language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                                                  </Button>
                                                )}
                                              </div>
                                            ) : (
                                              <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                                                <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
                                                  <div className="flex items-center gap-2">
                                                    {levelSelectorState[selKey].step !== 'activity' && <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => goBackLevelSelector(selKey)}>{language === 'ar' ? '→' : '←'}</Button>}
                                                    <span className="text-xs font-medium text-gray-600">
                                                      {levelSelectorState[selKey].step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                                      {levelSelectorState[selKey].step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                                      {levelSelectorState[selKey].step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                                    </span>
                                                  </div>
                                                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => resetLevelSelector(selKey)}>✕</Button>
                                                </div>
                                                {levelSelectorState[selKey].step === 'activity' && (
                                                  <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                                    {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                                      const activityLevels = _grouped[activity.id] || {};
                                                      const timeCount = Object.keys(activityLevels).length;
                                                      if (timeCount === 0) return null;
                                                      return (
                                                        <button key={activity.id} type="button" className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10 hover:bg-opacity-20`} onClick={() => selectLevelActivity(selKey, activity.id)}>
                                                          <div className="flex items-center gap-2"><span className="text-xl">{activity.icon}</span><span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span></div>
                                                          <div className="flex items-center gap-1 text-gray-500"><span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span><span>{language === 'ar' ? '←' : '→'}</span></div>
                                                        </button>
                                                      );
                                                    })}
                                                    {_grouped["other"] && Object.keys(_grouped["other"]).length > 0 && (
                                                      <button type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors bg-gray-100" onClick={() => selectLevelActivity(selKey, 'other')}>
                                                        <div className="flex items-center gap-2"><span className="text-xl">📋</span><span className="font-medium">{language === 'ar' ? 'أخرى' : 'Other'}</span></div>
                                                        <span>{language === 'ar' ? '←' : '→'}</span>
                                                      </button>
                                                    )}
                                                  </div>
                                                )}
                                                {levelSelectorState[selKey].step === 'time' && (
                                                  <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                                    {Object.entries(_grouped[levelSelectorState[selKey].selectedActivity] || {}).sort(([a], [b]) => { const na = parseInt((a.match(/\d+/) || [])[0]) || 0; const nb = parseInt((b.match(/\d+/) || [])[0]) || 0; return na - nb; }).map(([timeSlot, timeLevels]) => {
                                                      const _itemDays = item.training_days || [];
                                                      const totalMembers = timeLevels.reduce((sum, l) => {
                                                        const activeDet = (l.members_details || []).filter(m => m.has_active_sub !== false);
                                                        if (_itemDays.length > 0 && activeDet.length > 0) {
                                                          const perDay = _itemDays.map(day => activeDet.filter(m => m.schedule && m.schedule.includes(day)).length);
                                                          return sum + Math.max(...perDay, 0);
                                                        }
                                                        return sum + activeDet.length;
                                                      }, 0);
                                                      const totalCapacity = timeLevels.reduce((sum, l) => sum + (l.capacity || 10), 0);
                                                      return (
                                                        <button key={timeSlot} type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border" onClick={() => selectLevelTime(selKey, timeSlot)}>
                                                          <div className="flex items-center gap-2"><span className="text-lg">🕐</span><span className="font-medium text-sm">{timeSlot}</span></div>
                                                          <div className="flex items-center gap-2"><span className="text-xs text-gray-500">{timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}</span><span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span></div>
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                                {levelSelectorState[selKey].step === 'level' && (
                                                  <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                                    {(_grouped[levelSelectorState[selKey].selectedActivity]?.[levelSelectorState[selKey].selectedTime] || []).sort((a, b) => a.level_number - b.level_number).map(level => {
                                                      const _days = item.training_days || [];
                                                      const _activeDet = (level.members_details || []).filter(m => m.has_active_sub !== false);
                                                      const memberCount = (_days.length > 0 && _activeDet.length > 0) ? Math.max(..._days.map(day => _activeDet.filter(m => m.schedule && m.schedule.includes(day)).length), 0) : _activeDet.length;
                                                      const maxCapacity = level.capacity || 10;
                                                      const isFull = memberCount >= maxCapacity;
                                                      const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                                      const levelCoach = level.coach_id ? coaches.find(c => c.id === level.coach_id) : null;
                                                      const coachName = levelCoach ? (levelCoach.name_ar || levelCoach.name) : null;
                                                      return (
                                                        <button key={level.id} type="button" className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`} onClick={() => selectAmLevel(level.id)}>
                                                          <div className="flex items-center justify-between mb-1">
                                                            <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>{level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)}</span>
                                                            <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>{memberCount}/{maxCapacity} {isFull && '⚠️'}</span>
                                                          </div>
                                                          {coachName && (
                                                            <div className="text-xs text-blue-600 mb-1 text-right">
                                                              👤 {language === 'ar' ? 'المدرب: ' : 'Coach: '}{coachName}
                                                            </div>
                                                          )}
                                                          <div className="w-full bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(fillPercent, 100)}%` }} /></div>
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <div className="space-y-2">
            <Label>{t('payment_method')}</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t('cash')}</SelectItem>
                <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                <SelectItem value="شبكة">{language === 'ar' ? 'شبكة' : 'Network'}</SelectItem>
                <SelectItem value="مدى">{language === 'ar' ? 'مدى' : 'Mada'}</SelectItem>
                <SelectItem value="فيزا">{language === 'ar' ? 'فيزا' : 'Visa'}</SelectItem>
                <SelectItem value="transfer">{t('transfer')}</SelectItem>
                <SelectItem value="تابي">{language === 'ar' ? 'تابي' : 'Tabby'}</SelectItem>
                <SelectItem value="تمارة">{language === 'ar' ? 'تمارة' : 'Tamara'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="p-4 border-purple-200 bg-purple-50/50">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-purple-600" />
              <Label className="font-semibold text-purple-700">{language === 'ar' ? 'كود الخصم' : 'Discount Coupon'}</Label>
            </div>
            {appliedCoupon ? (
              <div className="flex items-center justify-between p-3 bg-green-100 border border-green-300 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-800">{appliedCoupon.code}</p>
                    <p className="text-sm text-green-600">{appliedCoupon.value} {t('sar')} {language === 'ar' ? 'خصم' : 'off'}</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-green-700">-{couponDiscount} {t('sar')}</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder={language === 'ar' ? 'أدخل كود الخصم...' : 'Enter coupon code...'} className="flex-1" data-testid="coupon-input" />
                <Button type="button" onClick={validateCoupon} disabled={!couponCode.trim() || validatingCoupon || invoiceItems.length === 0} variant="outline" className="border-purple-400 text-purple-700 hover:bg-purple-100" data-testid="apply-coupon-btn">
                  {validatingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Percent className="w-4 h-4 me-1" />{language === 'ar' ? 'تطبيق' : 'Apply'}</>}
                </Button>
              </div>
            )}
          </Card>

          <div className="space-y-2"><Label>{t('notes')}</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          {(invoiceItems.length > 0 || additionalMembers.some(am => am.items.length > 0)) && (
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              {additionalMembers.some(am => am.items.length > 0) && (
                <div className="mb-2 pb-2 border-b border-primary/10">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>{language === 'ar' ? 'العضو الأساسي' : 'Primary member'}</span><span>{invoiceItems.reduce((s, i) => s + i.fee, 0).toFixed(2)} {t('sar')}</span></div>
                  {additionalMembers.filter(am => am.member && am.items.length > 0).map((am, i) => (
                    <div key={i} className="flex justify-between text-xs text-muted-foreground mb-1"><span>{am.member.name_ar || am.member.name}</span><span>{am.items.reduce((s, item) => s + item.fee, 0).toFixed(2)} {t('sar')}</span></div>
                  ))}
                </div>
              )}
              <div className="flex justify-between text-sm mb-2"><span>{t('subtotal')}</span><span>{subtotal.toFixed(2)} {t('sar')}</span></div>
              <div className="flex justify-between text-sm mb-2 text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}</span><span>{vatAmount.toFixed(2)} {t('sar')}</span></div>
              {couponDiscount > 0 && <div className="flex justify-between text-sm mb-2 text-purple-600"><span className="flex items-center gap-1"><Tag className="w-3 h-3" />{language === 'ar' ? 'خصم الكوبون' : 'Coupon Discount'} ({appliedCoupon?.code})</span><span>- {couponDiscount.toFixed(2)} {t('sar')}</span></div>}
              <div className="flex justify-between text-lg font-bold border-t pt-2"><span>{t('total')}</span><span className="text-primary">{total.toFixed(2)} {t('sar')}</span></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeCreateDialog}>{t('cancel')}</Button>
          <Button onClick={handleCreateInvoice} disabled={saving || invoiceItems.length === 0 || !customerNameAr}>
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}{t('create_invoice')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
