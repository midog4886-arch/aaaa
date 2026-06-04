import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Badge } from '../../../../components/ui/badge';
import { Card } from '../../../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../../../components/ui/command';
import { Textarea } from '../../../../components/ui/textarea';
import { CheckCircle, ChevronsUpDown, FileText, Plus, Printer, Trash2, UserPlus, X } from 'lucide-react';
import { MAIN_ACTIVITIES_FOR_LEVELS } from '../../constants';
import { membersAPI } from '../../../../services/api';
import { toast } from 'sonner';

const MemberCombobox = ({ members, selectedLabel, onSelect, onAddNew, language }) => {
  const [open, setOpen] = React.useState(false);
  const list = (members || []).filter(m => m.id);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full flex-1 justify-between font-normal"
          data-testid="regform-member-combobox-trigger"
        >
          <span className="truncate text-start">{selectedLabel || (language === 'ar' ? 'اختر عضو...' : 'Select member...')}</span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0 ms-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(value, search) => {
            if (!search) return 1;
            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder={language === 'ar' ? 'بحث بالاسم أو الجوال أو الرقم...' : 'Search by name, phone, or ID...'}
            className="h-9"
          />
          <CommandList className="max-h-72">
            <CommandEmpty>{language === 'ar' ? 'لا توجد نتائج' : 'No results'}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__new__"
                onSelect={() => { onAddNew(); setOpen(false); }}
                className="text-primary font-medium"
              >
                <Plus className="w-4 h-4 inline me-2" />
                {language === 'ar' ? '+ إضافة عضو جديد' : '+ Add New Member'}
              </CommandItem>
              {list.map(m => {
                const search = `${m.member_id || ''} ${m.name_ar || ''} ${m.name || ''} ${m.phone || ''}`;
                return (
                  <CommandItem
                    key={m.id}
                    value={search}
                    onSelect={() => { onSelect(m); setOpen(false); }}
                  >
                    {m.member_id && <span className="font-mono text-primary font-semibold me-1">#{m.member_id}</span>}
                    {(language === 'ar' ? (m.name_ar || m.name) : (m.name || m.name_ar)) || ''} - {m.phone}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const RegistrationFormDialog = ({
  isOpen, onOpenChange,
  editRegFormId,
  members, activities, products, levels, coaches = [],
  regFormData, setRegFormData,
  regFormItems, setRegFormItems,
  regFormItemType, setRegFormItemType,
  regFormPaymentMethod, setRegFormPaymentMethod,
  regFormNotes, setRegFormNotes,
  regFormCouponCode, setRegFormCouponCode,
  regFormAppliedCoupon, setRegFormAppliedCoupon,
  regFormCouponDiscount, setRegFormCouponDiscount,
  regFormDiscount,
  regFormAdditionalMembers, setRegFormAdditionalMembers,
  regFormAdditionalMemberNewForm, setRegFormAdditionalMemberNewForm,
  regFormLevelSelectorState, regFormLevelWarnings,
  addActivityToRegForm, addProductToRegForm, removeActivityFromRegForm,
  initRegFormLevelSelector, goBackRegFormLevelSelector, resetRegFormLevelSelector,
  selectRegFormLevelActivity, selectRegFormLevelTime, updateRegFormItemLevel,
  handleAcceptRegFormFullLevel, handleRejectRegFormFullLevel,
  validateRegFormCoupon,
  closeRegistrationFormDialog, handleSaveRegistrationFormOnly, handlePrintNewRegistrationForm,
  calcEndDate,
  groupedLevelsForSelector,
  getGroupedLevelsForDays,
  setAddMemberSource, setIsAddMemberDialogOpen, setMembers,
  language, t
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {language === 'ar' ? 'إنشاء استمارة تسجيل' : 'Create Registration Form'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم المشترك *' : 'Customer Name *'}</Label>
              <div className="flex gap-2">
                <MemberCombobox
                  members={members}
                  selectedLabel={regFormData.customer_name}
                  onSelect={(member) => setRegFormData({ ...regFormData, customer_name: member.name_ar || member.name, customer_phone: member.phone || '' })}
                  onAddNew={() => { setAddMemberSource('registration'); setIsAddMemberDialogOpen(true); }}
                  language={language}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('phone')} *</Label>
              <Input value={regFormData.customer_phone} onChange={(e) => setRegFormData({...regFormData, customer_phone: e.target.value})} type="tel" dir="ltr" placeholder="05xxxxxxxx" />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant={regFormItemType === 'activity' ? 'default' : 'outline'} size="sm" onClick={() => setRegFormItemType('activity')}>
              {language === 'ar' ? 'نشاط' : 'Activity'}
            </Button>
            <Button variant={regFormItemType === 'product' ? 'default' : 'outline'} size="sm" onClick={() => setRegFormItemType('product')}>
              {language === 'ar' ? 'منتج' : 'Product'}
            </Button>
          </div>

          {regFormItemType === 'activity' && (
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'إضافة نشاط' : 'Add Activity'}</Label>
              <Select onValueChange={(val) => { const activity = activities.find(a => a.id === val); if (activity) addActivityToRegForm(activity); }}>
                <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر نشاط...' : 'Select activity...'} /></SelectTrigger>
                <SelectContent>
                  {(activities || []).map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name} - {a.monthly_fee} {t('sar')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {regFormItemType === 'product' && (
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'إضافة منتج من المخزن' : 'Add Product'}</Label>
              <Select onValueChange={(val) => { const product = products.find(p => p.id === val); if (product) addProductToRegForm(product); }}>
                <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر منتج...' : 'Select product...'} /></SelectTrigger>
                <SelectContent>
                  {products.filter(p => p.id && p.quantity > 0).map(p => <SelectItem key={p.id} value={p.id}>{p.name} - {p.price} {t('sar')} ({language === 'ar' ? `متوفر: ${p.quantity}` : `Stock: ${p.quantity}`})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {regFormItems.length > 0 && (
            <div className="border rounded-lg p-3 space-y-3">
              <Label>{language === 'ar' ? 'العناصر المختارة' : 'Selected Items'}</Label>
              {(regFormItems || []).map((item, idx) => (
                <div key={idx} className="bg-muted/50 p-3 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.activity_name}</span>
                      {item.is_product && <Badge variant="outline" className="text-xs">{language === 'ar' ? 'منتج' : 'Product'}</Badge>}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeActivityFromRegForm(idx)}><X className="w-4 h-4 text-destructive" /></Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {item.is_product ? (
                      <>
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
                          <Input type="number" min="1" value={item.quantity} onChange={(e) => { const updated = [...regFormItems]; updated[idx].quantity = parseInt(e.target.value) || 1; setRegFormItems(updated); }} className="text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'السعر' : 'Price'}</Label>
                          <Input type="number" value={item.fee} onChange={(e) => { const updated = [...regFormItems]; updated[idx].fee = parseFloat(e.target.value) || 0; setRegFormItems(updated); }} className="text-sm" />
                        </div>
                        <div className="flex items-end">
                          <span className="text-sm font-semibold text-primary pb-2">{((item.fee || 0) * (item.quantity || 1)).toFixed(2)} {t('sar')}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                          <Input type="date" value={item.start_date || ''} onChange={(e) => { const updated = [...regFormItems]; updated[idx].start_date = e.target.value; const w = updated[idx].weeks ?? 4; updated[idx].end_date = calcEndDate(e.target.value, w, updated[idx].training_days); updated[idx].period = `${e.target.value} - ${updated[idx].end_date}`; setRegFormItems(updated); }} className="h-14 text-lg" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium flex items-center gap-2">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}
                            <span className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                              <input type="number" min="1" max="52" value={item.weeks || 4} onChange={(e) => { const updated = [...regFormItems]; updated[idx].weeks = parseInt(e.target.value, 10) || 4; if (updated[idx].start_date) { updated[idx].end_date = calcEndDate(updated[idx].start_date, updated[idx].weeks, updated[idx].training_days); updated[idx].period = `${updated[idx].start_date} - ${updated[idx].end_date}`; } setRegFormItems(updated); }} className="w-8 text-xs text-center bg-transparent outline-none font-semibold text-blue-700" title={language === 'ar' ? 'عدد الأسابيع' : 'Weeks'} />
                              <span className="text-xs text-blue-600">{language === 'ar' ? 'أسبوع' : 'wks'}</span>
                            </span>
                          </Label>
                          <Input type="date" value={item.end_date || ''} onChange={(e) => { const updated = [...regFormItems]; updated[idx].end_date = e.target.value; if (updated[idx].start_date) updated[idx].period = `${updated[idx].start_date} - ${e.target.value}`; setRegFormItems(updated); }} className="h-14 text-lg" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'السعر' : 'Price'}</Label>
                          <Input type="number" value={item.fee} onChange={(e) => { const updated = [...regFormItems]; updated[idx].fee = parseFloat(e.target.value) || 0; setRegFormItems(updated); }} className="text-sm" />
                        </div>
                      </>
                    )}
                  </div>
                  {!item.is_product && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                        <div className="flex flex-wrap gap-1">
                          {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                            <button key={day} type="button" onClick={() => {
                              const currentDays = item.training_days || [];
                              const newDays = currentDays.includes(day) ? currentDays.filter(d => d !== day) : [...currentDays, day];
                              const updated = [...regFormItems];
                              updated[idx].training_days = newDays;
                              if (!editRegFormId && updated[idx].start_date) { const w = updated[idx].weeks ?? 4; updated[idx].end_date = calcEndDate(updated[idx].start_date, w, newDays); updated[idx].period = `${updated[idx].start_date} - ${updated[idx].end_date}`; }
                              const formatSchedule = (days, time) => { if (days.length === 0) return time || ''; const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)); let daysStr; if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; } return time ? `${daysStr} - ${time}` : daysStr; };
                              updated[idx].schedule = formatSchedule(newDays, item.training_time);
                              setRegFormItems(updated);
                            }} className={`px-2 py-1 text-xs rounded border transition-colors ${(item.training_days || []).includes(day) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>{day}</button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                          <Input type="number" min="1" max="12" placeholder={language === 'ar' ? 'مثال: 4' : 'e.g., 4'} value={item.training_time_hour || ''} onChange={(e) => {
                            const hour = e.target.value;
                            const updated = [...regFormItems];
                            updated[idx].training_time_hour = hour;
                            const timeStr = hour ? `${hour}:00 م` : '';
                            updated[idx].training_time = timeStr;
                            const formatSchedule = (days, time) => { if (!days || days.length === 0) return time || ''; const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)); let daysStr; if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; } return time ? `${daysStr} - ${time}` : daysStr; };
                            updated[idx].schedule = formatSchedule(updated[idx].training_days, timeStr);
                            setRegFormItems(updated);
                          }} className="text-sm" />
                          {item.training_time && <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                          {!regFormLevelSelectorState[idx] ? (
                            <div>
                              {item.level_id ? (
                                <div className={`flex items-center justify-between p-2 border rounded-lg ${regFormLevelWarnings[idx]?.isFull && !regFormLevelWarnings[idx]?.isAccepted ? 'border-orange-500 border-2 bg-orange-50' : regFormLevelWarnings[idx]?.isAccepted ? 'border-green-500 border-2 bg-green-50' : 'bg-gray-50'}`}>
                                  <span className="text-sm">{item.level_name}</span>
                                  <div className="flex gap-1">
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => initRegFormLevelSelector(idx)}>{language === 'ar' ? 'تغيير' : 'Change'}</Button>
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={() => updateRegFormItemLevel(idx, '')}>✕</Button>
                                  </div>
                                </div>
                              ) : (
                                <Button type="button" variant="outline" className="w-full h-8 text-sm justify-start gap-2" onClick={() => initRegFormLevelSelector(idx)}>
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
                                  {regFormLevelSelectorState[idx].step !== 'activity' && <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => goBackRegFormLevelSelector(idx)}>{language === 'ar' ? '→' : '←'}</Button>}
                                  <span className="text-xs font-medium text-gray-600">
                                    {regFormLevelSelectorState[idx].step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                    {regFormLevelSelectorState[idx].step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                    {regFormLevelSelectorState[idx].step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                  </span>
                                </div>
                                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => resetRegFormLevelSelector(idx)}>✕</Button>
                              </div>
                              {regFormLevelSelectorState[idx].step === 'activity' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                    const activityLevels = _grouped[activity.id] || {};
                                    const timeCount = Object.keys(activityLevels).length;
                                    if (timeCount === 0) return null;
                                    return (
                                      <button key={activity.id} type="button" className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10 hover:bg-opacity-20`} onClick={() => selectRegFormLevelActivity(idx, activity.id)}>
                                        <div className="flex items-center gap-2"><span className="text-xl">{activity.icon}</span><span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span></div>
                                        <div className="flex items-center gap-1 text-gray-500"><span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span><span>{language === 'ar' ? '←' : '→'}</span></div>
                                      </button>
                                    );
                                  })}
                                  {_grouped["other"] && Object.keys(_grouped["other"]).length > 0 && (
                                    <button type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors bg-gray-100" onClick={() => selectRegFormLevelActivity(idx, 'other')}>
                                      <div className="flex items-center gap-2"><span className="text-xl">📋</span><span className="font-medium">{language === 'ar' ? 'أخرى' : 'Other'}</span></div>
                                      <span>{language === 'ar' ? '←' : '→'}</span>
                                    </button>
                                  )}
                                </div>
                              )}
                              {regFormLevelSelectorState[idx].step === 'time' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {Object.entries(_grouped[regFormLevelSelectorState[idx].selectedActivity] || {}).map(([timeSlot, timeLevels]) => {
                                    const _itemDays = item.training_days || [];
                                    const _startDate = item.start_date || '';
                                    const _isActiveAtStart = (mid, lvlId) => {
                                      if (!_startDate) return true;
                                      const mem = (members || []).find(mm => mm.id === mid);
                                      if (!mem) return true;
                                      const acts = mem.activities || [];
                                      const levelActs = acts.filter(a => a.level_id === lvlId);
                                      const candidates = levelActs.length > 0 ? levelActs : acts;
                                      return candidates.some(a => !a.end_date || a.end_date >= _startDate);
                                    };
                                    const _dedupCount = (arr) => new Set((arr || []).map(m => typeof m === 'string' ? m : (m?.id || m?.member_id)).filter(Boolean)).size;
                                    const totalMembers = timeLevels.reduce((sum, l) => {
                                      let det = (l.members_details || []).filter((m, i, arr) => arr.findIndex(x => (x.id || x.member_id) === (m.id || m.member_id)) === i);
                                      det = det.filter(m => _isActiveAtStart(m.member_id || m.id, l.id));
                                      if (_itemDays.length > 0 && det.length > 0) { const perDay = _itemDays.map(day => det.filter(m => m.schedule && m.schedule.includes(day)).length); return sum + Math.max(...perDay, 0); }
                                      return sum + (det.length > 0 ? det.length : _dedupCount(l.members));
                                    }, 0);
                                    const totalCapacity = timeLevels.reduce((sum, l) => sum + (l.capacity || 10), 0);
                                    return (
                                      <button key={timeSlot} type="button" className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border" onClick={() => selectRegFormLevelTime(idx, timeSlot)}>
                                        <div className="flex items-center gap-2"><span className="text-lg">🕐</span><span className="font-medium text-sm">{timeSlot}</span></div>
                                        <div className="flex items-center gap-2"><span className="text-xs text-gray-500">{timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}</span><span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span></div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              {regFormLevelSelectorState[idx].step === 'level' && (
                                <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                  {(_grouped[regFormLevelSelectorState[idx].selectedActivity]?.[regFormLevelSelectorState[idx].selectedTime] || []).sort((a, b) => a.level_number - b.level_number).map(level => {
                                    const _days = item.training_days || [];
                                    const _startDateLv = item.start_date || '';
                                    const _isActiveAtStartLv = (mid) => {
                                      if (!_startDateLv) return true;
                                      const mem = (members || []).find(mm => mm.id === mid);
                                      if (!mem) return true;
                                      const acts = mem.activities || [];
                                      const levelActs = acts.filter(a => a.level_id === level.id);
                                      const candidates = levelActs.length > 0 ? levelActs : acts;
                                      return candidates.some(a => !a.end_date || a.end_date >= _startDateLv);
                                    };
                                    const _dedupRaw = (level.members_details || []).filter((m, i, arr) => arr.findIndex(x => (x.id || x.member_id) === (m.id || m.member_id)) === i);
                                    const _dedup = _dedupRaw.filter(m => _isActiveAtStartLv(m.member_id || m.id));
                                    const _dedupMembersCount = new Set(((level.members) || []).map(m => typeof m === 'string' ? m : (m?.id || m?.member_id)).filter(Boolean).filter(mid => _isActiveAtStartLv(mid))).size;
                                    const memberCount = (_days.length > 0 && _dedup.length > 0) ? Math.max(..._days.map(day => _dedup.filter(m => m.schedule && m.schedule.includes(day)).length), 0) : (_dedup.length > 0 ? _dedup.length : _dedupMembersCount);
                                    const maxCapacity = level.capacity || 10;
                                    const isFull = memberCount >= maxCapacity;
                                    const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                    const levelCoach = level.coach_id ? coaches.find(c => c.id === level.coach_id) : null;
                                    const coachName = levelCoach ? (levelCoach.name_ar || levelCoach.name) : null;
                                    return (
                                      <button key={level.id} type="button" className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`} onClick={() => updateRegFormItemLevel(idx, level.id, { memberCount, maxCapacity, isFull })}>
                                        <div className="flex items-center justify-between mb-1">
                                          <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>{level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)}</span>
                                          <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>{memberCount}/{maxCapacity} {isFull && '⚠️'}</span>
                                        </div>
                                        {(level.time_slot || level.schedule) && (
                                          <div className="text-xs font-bold text-amber-700 mb-1 text-right flex items-center justify-end gap-1">
                                            <span>🕐</span><span>{level.time_slot || level.schedule}</span>
                                          </div>
                                        )}
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
                          {regFormLevelWarnings[idx]?.isFull && !regFormLevelWarnings[idx]?.isAccepted && (
                            <div className="mt-2 p-2 bg-orange-50 border border-orange-300 rounded-lg">
                              <p className="text-xs text-orange-700 font-medium mb-2">⚠️ {regFormLevelWarnings[idx].message}</p>
                              <div className="flex gap-2">
                                <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-7" onClick={() => handleAcceptRegFormFullLevel(idx)}>✓ {language === 'ar' ? 'موافق' : 'Accept'}</Button>
                                <Button type="button" size="sm" variant="outline" className="border-red-500 text-red-600 hover:bg-red-50 text-xs h-7" onClick={() => handleRejectRegFormFullLevel(idx)}>✗ {language === 'ar' ? 'رفض' : 'Reject'}</Button>
                              </div>
                            </div>
                          )}
                          {regFormLevelWarnings[idx]?.isAccepted && <p className="text-xs text-green-600 font-medium mt-1">✓ {language === 'ar' ? 'تم قبول التسجيل رغم اكتمال العدد' : 'Registration accepted despite full capacity'}</p>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
            <Select value={regFormPaymentMethod} onValueChange={setRegFormPaymentMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{language === 'ar' ? 'نقدي' : 'Cash'}</SelectItem>
                <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                <SelectItem value="تابي">{language === 'ar' ? 'تابي' : 'Tabby'}</SelectItem>
                <SelectItem value="تمارة">{language === 'ar' ? 'تمارا' : 'Tamara'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'كود الخصم' : 'Discount Code'}</Label>
            <div className="flex gap-2">
              <Input value={regFormCouponCode} onChange={(e) => setRegFormCouponCode(e.target.value)} placeholder={language === 'ar' ? 'أدخل كود الخصم' : 'Enter coupon code'} disabled={!!regFormAppliedCoupon} />
              {!regFormAppliedCoupon ? (
                <Button variant="outline" onClick={validateRegFormCoupon} disabled={!regFormCouponCode.trim()}>{language === 'ar' ? 'تطبيق' : 'Apply'}</Button>
              ) : (
                <Button variant="outline" onClick={() => { setRegFormAppliedCoupon(null); setRegFormCouponCode(''); setRegFormCouponDiscount(0); }}><X className="w-4 h-4" /></Button>
              )}
            </div>
            {regFormAppliedCoupon && <p className="text-sm text-green-600">✅ {language === 'ar' ? `تم تطبيق الكوبون: ${regFormAppliedCoupon.code}` : `Coupon applied: ${regFormAppliedCoupon.code}`}</p>}
          </div>

          <Card className="p-3 border-blue-200 bg-blue-50/30">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-blue-700 flex items-center gap-2">
                <UserPlus className="w-4 h-4" />{language === 'ar' ? 'أعضاء إضافيين (إخوة)' : 'Additional Members (Siblings)'}
              </h4>
              <Button type="button" size="sm" variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-100" onClick={() => setRegFormAdditionalMembers([...regFormAdditionalMembers, { member: null, items: [] }])}>
                <UserPlus className="w-4 h-4 me-1" />{language === 'ar' ? 'إضافة عضو آخر' : 'Add Another Member'}
              </Button>
            </div>
            {regFormAdditionalMembers.length > 0 && (
              <div className="space-y-4">
                {regFormAdditionalMembers.map((am, amIdx) => (
                  <div key={amIdx} className="p-3 bg-white rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-blue-700">{language === 'ar' ? `العضو ${amIdx + 2}` : `Member ${amIdx + 2}`}{am.member && ` - ${am.member.name_ar || am.member.name}`}</span>
                      <Button type="button" size="sm" variant="ghost" className="text-red-500 h-7 w-7 p-0" onClick={() => setRegFormAdditionalMembers(regFormAdditionalMembers.filter((_, i) => i !== amIdx))}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                    <Select value={am.member?.id || 'none'} onValueChange={(val) => {
                      if (val === 'none') return;
                      if (val === 'new_member') { setRegFormAdditionalMemberNewForm({ show: true, index: amIdx, data: { name_ar: '' } }); return; }
                      const member = members.find(m => m.id === val);
                      const updated = [...regFormAdditionalMembers]; updated[amIdx] = { ...updated[amIdx], member }; setRegFormAdditionalMembers(updated);
                    }}>
                      <SelectTrigger className="mb-2"><SelectValue placeholder={language === 'ar' ? 'اختر العضو...' : 'Select member...'} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{language === 'ar' ? '-- اختر --' : '-- Select --'}</SelectItem>
                        <SelectItem value="new_member" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                        {(members || []).filter(m => m.id && !regFormAdditionalMembers.some((a, i) => i !== amIdx && a.member?.id === m.id)).map(m => <SelectItem key={m.id} value={m.id}>{m.member_id && <span className="font-mono text-primary font-semibold me-1">#{m.member_id}</span>}{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {regFormAdditionalMemberNewForm.show && regFormAdditionalMemberNewForm.index === amIdx && (
                      <div className="p-3 mb-2 bg-green-50 border border-green-300 rounded-lg space-y-2">
                        <h5 className="text-sm font-bold text-green-800">{language === 'ar' ? 'إضافة عضو جديد' : 'Add New Member'}</h5>
                        <Input placeholder={language === 'ar' ? 'اسم العميل *' : 'Customer name *'} value={regFormAdditionalMemberNewForm.data.name_ar} onChange={(e) => setRegFormAdditionalMemberNewForm(prev => ({ ...prev, data: { ...prev.data, name_ar: e.target.value } }))} />
                        <div className="flex gap-2 justify-end">
                          <Button type="button" size="sm" variant="outline" onClick={() => setRegFormAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '' } })}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</Button>
                          <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700" disabled={!regFormAdditionalMemberNewForm.data.name_ar} onClick={async () => {
                            try {
                              const res = await membersAPI.create({ name_ar: regFormAdditionalMemberNewForm.data.name_ar, name: regFormAdditionalMemberNewForm.data.name_ar, phone: regFormData?.customer_phone || '', status: 'active' });
                              const newMember = res.data;
                              if (setMembers) setMembers(prev => [...prev, newMember]);
                              const updated = [...regFormAdditionalMembers]; updated[amIdx] = { ...updated[amIdx], member: newMember }; setRegFormAdditionalMembers(updated);
                              setRegFormAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '' } });
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
                          const newItem = { activity_id: activity.id, activity_name: activity.name_ar || activity.name, fee: activity.monthly_fee || 0, period: `${today} - ${endDate}`, schedule: activity.schedule || '', start_date: today, end_date: endDate, weeks: defaultWeeks, is_product: false, training_days: [], training_time: '', training_time_hour: '', level_id: '', level_name: '' };
                          const updated = [...regFormAdditionalMembers]; updated[amIdx] = { ...updated[amIdx], items: [...updated[amIdx].items, newItem] }; setRegFormAdditionalMembers(updated);
                        }}>
                          <SelectTrigger className="mb-2"><SelectValue placeholder={language === 'ar' ? '+ اختر نشاط...' : '+ Select activity...'} /></SelectTrigger>
                          <SelectContent>{(activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name} - {a.monthly_fee} {language === 'ar' ? 'ر.س' : 'SAR'}</SelectItem>)}</SelectContent>
                        </Select>
                        {am.items.length > 0 && (
                          <div className="space-y-2">
                            {am.items.map((item, itemIdx) => (
                              <div key={itemIdx} className="p-2 bg-blue-50 rounded text-sm space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{item.activity_name}</span>
                                  <div className="flex items-center gap-2">
                                    <Input type="number" value={item.fee} onChange={(e) => { const updated = [...regFormAdditionalMembers]; updated[amIdx].items[itemIdx].fee = parseFloat(e.target.value) || 0; setRegFormAdditionalMembers(updated); }} className="w-20 h-7 text-sm text-center" />
                                    <span className="text-xs text-muted-foreground">{language === 'ar' ? 'ر.س' : 'SAR'}</span>
                                    <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => { const updated = [...regFormAdditionalMembers]; updated[amIdx].items = updated[amIdx].items.filter((_, i) => i !== itemIdx); setRegFormAdditionalMembers(updated); }}><X className="w-3 h-3" /></Button>
                                  </div>
                                </div>
                                {!item.is_product && (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <Label className="text-xs">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                                        <Input type="date" value={item.start_date || ''} onChange={(e) => { const updated = [...regFormAdditionalMembers]; updated[amIdx].items[itemIdx].start_date = e.target.value; const w = updated[amIdx].items[itemIdx].weeks ?? 4; updated[amIdx].items[itemIdx].end_date = calcEndDate(e.target.value, w, updated[amIdx].items[itemIdx].training_days); updated[amIdx].items[itemIdx].period = `${e.target.value} - ${updated[amIdx].items[itemIdx].end_date}`; setRegFormAdditionalMembers(updated); }} className="h-7 text-xs" />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs flex items-center gap-1">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}
                                          <span className="flex items-center gap-0.5 bg-blue-50 border border-blue-200 rounded px-1 py-0.5">
                                            <input type="number" min="1" max="52" value={item.weeks ?? 4} onChange={(e) => { const updated = [...regFormAdditionalMembers]; updated[amIdx].items[itemIdx].weeks = parseInt(e.target.value, 10) || 4; if (updated[amIdx].items[itemIdx].start_date) { updated[amIdx].items[itemIdx].end_date = calcEndDate(updated[amIdx].items[itemIdx].start_date, updated[amIdx].items[itemIdx].weeks, updated[amIdx].items[itemIdx].training_days); updated[amIdx].items[itemIdx].period = `${updated[amIdx].items[itemIdx].start_date} - ${updated[amIdx].items[itemIdx].end_date}`; } setRegFormAdditionalMembers(updated); }} className="w-7 text-xs text-center bg-transparent outline-none font-semibold text-blue-700" />
                                            <span className="text-xs text-blue-600">{language === 'ar' ? 'أ' : 'w'}</span>
                                          </span>
                                        </Label>
                                        <Input type="date" value={item.end_date || ''} onChange={(e) => { const updated = [...regFormAdditionalMembers]; updated[amIdx].items[itemIdx].end_date = e.target.value; updated[amIdx].items[itemIdx].period = `${updated[amIdx].items[itemIdx].start_date} - ${e.target.value}`; setRegFormAdditionalMembers(updated); }} className="h-7 text-xs" />
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                                      <div className="flex flex-wrap gap-1">
                                        {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                                          <button key={day} type="button" onClick={() => {
                                            const currentDays = item.training_days || [];
                                            const newDays = currentDays.includes(day) ? currentDays.filter(d => d !== day) : [...currentDays, day];
                                            const updated = [...regFormAdditionalMembers];
                                            updated[amIdx].items[itemIdx].training_days = newDays;
                                            if (updated[amIdx].items[itemIdx].start_date) { const w = updated[amIdx].items[itemIdx].weeks ?? 4; updated[amIdx].items[itemIdx].end_date = calcEndDate(updated[amIdx].items[itemIdx].start_date, w, newDays); updated[amIdx].items[itemIdx].period = `${updated[amIdx].items[itemIdx].start_date} - ${updated[amIdx].items[itemIdx].end_date}`; }
                                            const formatSchedule = (days, time) => { if (days.length === 0) return time || ''; const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)); let daysStr; if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; } return time ? `${daysStr} - ${time}` : daysStr; };
                                            updated[amIdx].items[itemIdx].schedule = formatSchedule(newDays, item.training_time);
                                            setRegFormAdditionalMembers(updated);
                                          }} className={`px-2 py-1 text-xs rounded border transition-colors ${(item.training_days || []).includes(day) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}>{day}</button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                                        <Input type="number" min="1" max="12" onWheel={(e) => e.currentTarget.blur()} placeholder={language === 'ar' ? 'مثال: 4' : 'e.g., 4'} value={item.training_time_hour || ''} onChange={(e) => { const hour = e.target.value; const updated = [...regFormAdditionalMembers]; updated[amIdx].items[itemIdx].training_time_hour = hour; const timeStr = hour ? `${hour}:00 م` : ''; updated[amIdx].items[itemIdx].training_time = timeStr; const formatSchedule = (days, time) => { if (!days || days.length === 0) return time || ''; const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)); let daysStr; if (sortedDays.length === 1) { daysStr = sortedDays[0]; } else { const lastDay = sortedDays.pop(); daysStr = sortedDays.join('، ') + ' و ' + lastDay; } return time ? `${daysStr} - ${time}` : daysStr; }; updated[amIdx].items[itemIdx].schedule = formatSchedule(updated[amIdx].items[itemIdx].training_days, timeStr); setRegFormAdditionalMembers(updated); }} className="h-7 text-sm" />
                                        {item.training_time && <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>}
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                                        <Select value={item.level_id || 'none'} onValueChange={(val) => { const updated = [...regFormAdditionalMembers]; if (val === 'none') { updated[amIdx].items[itemIdx].level_id = ''; updated[amIdx].items[itemIdx].level_name = ''; } else { const level = levels.find(l => l.id === val); const levelLabel = level ? `${level.activity_name || ''} - ${language === 'ar' ? 'مستوى' : 'Level'} ${level.level_number}` : ''; updated[amIdx].items[itemIdx].level_id = val; updated[amIdx].items[itemIdx].level_name = levelLabel; } setRegFormAdditionalMembers(updated); }}>
                                          <SelectTrigger className="h-7 text-sm"><SelectValue placeholder={language === 'ar' ? 'اختياري' : 'Optional'} /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="none">{language === 'ar' ? '-- بدون --' : '-- None --'}</SelectItem>
                                            {(() => {
                                              // Smart level filtering for the additional-sibling row:
                                              // 1) Prefer EXACT activity_name match (our naming
                                              //    convention encodes the time slot in the name).
                                              // 2) When the row has a training_time, restrict to
                                              //    levels whose time_slot/schedule matches it so a
                                              //    sibling at 5pm karate doesn't see 6pm karate.
                                              // 3) Fallback to the looser activity_name === item.activity_name
                                              //    || empty when no exact-match levels exist.
                                              // Hide temporarily-closed levels from NEW choices, but
                                              // always keep the one already selected on this item so an
                                              // existing/edit selection is never silently dropped.
                                              const all = (levels || []).filter(l => l.id && (l.is_active !== false || l.id === item.level_id));
                                              const targetTime = (item.training_time || '').trim();
                                              const norm = (s) => (s || '').toString().trim();
                                              const exact = all.filter(l => norm(l.activity_name) === norm(item.activity_name));
                                              let pool = exact.length ? exact : all.filter(l => norm(l.activity_name) === norm(item.activity_name) || !l.activity_name);
                                              if (targetTime) {
                                                const timeMatched = pool.filter(l => {
                                                  const slot = norm(l.time_slot) || norm(l.schedule);
                                                  if (!slot) return true; // legacy levels with no time → keep
                                                  return slot.includes(targetTime) || targetTime.includes(slot);
                                                });
                                                if (timeMatched.length) pool = timeMatched;
                                              }
                                              return pool.map(l => {
                                                const slot = norm(l.time_slot) || norm(l.schedule);
                                                return (
                                                  <SelectItem key={l.id} value={l.id}>
                                                    {l.activity_name} - {language === 'ar' ? 'مستوى' : 'Level'} {l.level_number}
                                                    {slot ? ` 🕐 ${slot}` : ''}
                                                  </SelectItem>
                                                );
                                              });
                                            })()}
                                          </SelectContent>
                                        </Select>
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

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
            <Textarea value={regFormNotes} onChange={(e) => setRegFormNotes(e.target.value)} placeholder={language === 'ar' ? 'أدخل ملاحظات...' : 'Enter notes...'} rows={2} />
          </div>

          {regFormItems.length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{language === 'ar' ? 'المجموع:' : 'Subtotal:'}</span>
                  <span>{regFormItems.reduce((sum, i) => sum + ((i.fee || 0) * (i.quantity || 1)), 0).toFixed(2)} {t('sar')}</span>
                </div>
                {(regFormDiscount > 0 || regFormCouponDiscount > 0) && (
                  <div className="flex justify-between text-sm text-red-600">
                    <span>{language === 'ar' ? 'الخصم:' : 'Discount:'}</span>
                    <span>- {(regFormDiscount + regFormCouponDiscount).toFixed(2)} {t('sar')}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg text-primary pt-2 border-t">
                  <span>{t('total')}:</span>
                  <span>{(regFormItems.reduce((sum, i) => sum + ((i.fee || 0) * (i.quantity || 1)), 0) - regFormDiscount - regFormCouponDiscount).toFixed(2)} {t('sar')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={closeRegistrationFormDialog}>{t('cancel')}</Button>
          <Button variant="outline" onClick={handleSaveRegistrationFormOnly} disabled={!regFormData.customer_name || regFormItems.length === 0} className="bg-teal-50 border-teal-400 text-teal-700 hover:bg-teal-100">
            <FileText className="w-4 h-4 me-2" />{language === 'ar' ? 'حفظ الاستمارة' : 'Save Form'}
          </Button>
          <Button onClick={handlePrintNewRegistrationForm} disabled={!regFormData.customer_name || regFormItems.length === 0} className="bg-gray-800 hover:bg-gray-900">
            <Printer className="w-4 h-4 me-2" />{language === 'ar' ? 'حفظ وطباعة' : 'Save & Print'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
