import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { invoicesAPI, discountsAPI, levelsAPI, membersAPI } from '../../../services/api';
import { COMPANY_INFO } from '../constants';
import { verifyOperationPassword } from '../../../utils/operationPassword';

const MAIN_ACTIVITIES_FOR_LEVELS = [
  { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', color: 'bg-blue-500' },
  { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', color: 'bg-green-500' },
  { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', color: 'bg-red-500' },
];

export const calcEndDate = (startDate, weeks, trainingDays = []) => {
  if (!startDate || !weeks) return '';
  const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const numWeeks = parseInt(weeks, 10);
  if (!trainingDays || trainingDays.length === 0) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + numWeeks * 7);
    return d.toISOString().split('T')[0];
  }
  const trainingIndices = trainingDays.map(day => dayOrder.indexOf(day)).filter(idx => idx !== -1);
  if (trainingIndices.length === 0) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + numWeeks * 7);
    return d.toISOString().split('T')[0];
  }
  const lastDay = new Date(startDate);
  lastDay.setDate(lastDay.getDate() + numWeeks * 7 - 1);
  for (let i = 0; i < 7; i++) {
    if (trainingIndices.includes(lastDay.getDay())) return lastDay.toISOString().split('T')[0];
    lastDay.setDate(lastDay.getDate() - 1);
  }
  const d = new Date(startDate);
  d.setDate(d.getDate() + numWeeks * 7);
  return d.toISOString().split('T')[0];
};

export const stripTransient = (item) => { const { weeks, ...rest } = item; return rest; };

export const useInvoiceForm = ({
  members, activities, products, levels,
  selectedBranchId, language, t, loadData,
  setIsViewDialogOpen, setIsAddMemberDialogOpen, setAddMemberSource,
  setQrCardMember, setQrCardSubscription, setIsQRCardDialogOpen
}) => {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('شبكة');
  const [saving, setSaving] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  // Marketer (affiliate) discount carried in from a referred registration. Shown
  // and applied live in the dialog so the staff sees it BEFORE saving (the backend
  // also resolves it, but it respects an already-sent discount so no double-apply).
  const [marketerDiscountPercent, setMarketerDiscountPercent] = useState(0);
  const [marketerName, setMarketerName] = useState('');
  const [itemType, setItemType] = useState('activity');
  const [feeEditUnlocked, setFeeEditUnlocked] = useState(false);
  const [additionalMembers, setAdditionalMembers] = useState([]);
  const [additionalMemberNewForm, setAdditionalMemberNewForm] = useState({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
  const [levelCapacityWarnings, setLevelCapacityWarnings] = useState({});
  const [levelSelectorState, setLevelSelectorState] = useState({});
  const [customerNameAr, setCustomerNameAr] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const parseActivityForLevel = (activityName) => {
    if (!activityName) return 'other';
    const name = activityName.toLowerCase();
    if (name.includes('سباح') || name.includes('swim')) return 'swimming';
    if (name.includes('كر') || name.includes('foot') || name.includes('قدم')) return 'football';
    if (name.includes('كارات') || name.includes('karate')) return 'karate';
    return 'other';
  };

  const buildGroupedLevels = (sourceLevels) => {
    const grouped = {};
    sourceLevels.forEach(level => {
      const mainActivity = parseActivityForLevel(level.activity_name);
      if (!grouped[mainActivity]) grouped[mainActivity] = {};
      let timeSlot = level.activity_name;
      if (level.activity_name.includes(' - ')) {
        timeSlot = level.activity_name.split(' - ')[1] || level.activity_name;
      }
      if (!grouped[mainActivity][timeSlot]) grouped[mainActivity][timeSlot] = [];
      grouped[mainActivity][timeSlot].push(level);
    });
    return grouped;
  };

  const groupedLevelsForSelector = useMemo(() => buildGroupedLevels((levels || []).filter(l => l.is_active !== false)), [levels]);

  const AR_TO_EN_DAY = {
    'الأحد': 'sunday',
    'الإثنين': 'monday',
    'الاثنين': 'monday',
    'الثلاثاء': 'tuesday',
    'الأربعاء': 'wednesday',
    'الاربعاء': 'wednesday',
    'الخميس': 'thursday',
    'الجمعة': 'friday',
    'السبت': 'saturday',
  };

  const filterLevelsByDays = (sourceLevels, trainingDays) => {
    if (!trainingDays || trainingDays.length === 0) return sourceLevels;
    const wanted = trainingDays.map(d => AR_TO_EN_DAY[d]).filter(Boolean);
    if (wanted.length === 0) return sourceLevels;
    return sourceLevels.filter(level => {
      const lvlDays = level.days;
      if (!lvlDays || !Array.isArray(lvlDays) || lvlDays.length === 0) return true;
      return lvlDays.some(d => wanted.includes(d));
    });
  };

  const getGroupedLevelsForDays = (trainingDays) => {
    return buildGroupedLevels(filterLevelsByDays((levels || []).filter(l => l.is_active !== false), trainingDays));
  };

  const calculateTotals = () => {
    const primarySubtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
    const additionalSubtotal = additionalMembers.reduce((sum, am) => sum + am.items.reduce((s, item) => s + item.fee, 0), 0);
    const subtotal = primarySubtotal + additionalSubtotal;
    const vatAmount = Math.round(subtotal * (COMPANY_INFO.vat_rate / 100) * 100) / 100;
    const totalBeforeDiscount = Math.round((subtotal + vatAmount) * 100) / 100;
    // Marketer discount is computed on the subtotal (matching the backend formula)
    // and only when no coupon is applied — the backend respects a manual/coupon
    // discount and won't stack the marketer discount on top of it.
    const marketerDiscount = (couponDiscount > 0 || !marketerDiscountPercent)
      ? 0
      : Math.round(subtotal * marketerDiscountPercent / 100 * 100) / 100;
    const totalDiscount = Math.round((couponDiscount + marketerDiscount) * 100) / 100;
    const total = Math.max(Math.round((totalBeforeDiscount - totalDiscount) * 100) / 100, 0);
    return { subtotal, vatAmount, totalBeforeDiscount, totalDiscount, marketerDiscount, total };
  };

  const handleMemberSelect = (memberId) => {
    if (memberId === 'new') { setAddMemberSource('invoice'); setIsAddMemberDialogOpen(true); return; }
    if (memberId === 'none') { setSelectedMember(null); return; }
    const member = members.find(m => m.id === memberId);
    setSelectedMember(member);
    if (member) { setCustomerNameAr(member.name_ar || ''); setCustomerPhone(member.phone || ''); setCustomerAddress(''); }
  };

  const addProductToInvoice = (productId, qty = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    if (product.quantity < qty) { toast.error(language === 'ar' ? 'الكمية غير متوفرة' : 'Insufficient stock'); return; }
    const existingIndex = invoiceItems.findIndex(i => i.product_id === productId);
    if (existingIndex >= 0) {
      const updated = [...invoiceItems];
      updated[existingIndex].quantity = (updated[existingIndex].quantity || 1) + qty;
      updated[existingIndex].fee = product.price * updated[existingIndex].quantity;
      setInvoiceItems(updated);
    } else {
      setInvoiceItems([...invoiceItems, { activity_id: productId, product_id: productId, activity_name: product.name_ar, fee: product.price * qty, period: '', schedule: '', is_product: true, quantity: qty }]);
    }
    if (appliedCoupon) { setAppliedCoupon(null); setCouponDiscount(0); setCouponCode(''); }
  };

  const validateCoupon = async () => {
    if (!couponCode.trim()) return;
    if (invoiceItems.length === 0) { toast.error(language === 'ar' ? 'أضف عناصر أولاً' : 'Add items first'); return; }
    setValidatingCoupon(true);
    try {
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
      const res = await discountsAPI.validate(couponCode, subtotal);
      setAppliedCoupon(res.data.discount);
      setCouponDiscount(res.data.discount.value);
      toast.success(language === 'ar' ? `تم تطبيق الكوبون! خصم ${res.data.discount.value} ر.س` : `Coupon applied! Discount ${res.data.discount.value} SAR`);
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'كوبون غير صالح' : 'Invalid coupon'));
      setAppliedCoupon(null); setCouponDiscount(0);
    } finally { setValidatingCoupon(false); }
  };

  const removeCoupon = () => { setAppliedCoupon(null); setCouponDiscount(0); setCouponCode(''); };

  const addActivityToInvoice = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    if (!activity) return;
    const today = new Date().toISOString().split('T')[0];
    const defaultWeeks = 4;
    const endDate = calcEndDate(today, defaultWeeks);
    const existingCount = invoiceItems.filter(item => item.activity_id === activityId).length;
    setInvoiceItems([...invoiceItems, {
      activity_id: activity.id, activity_name: language === 'ar' ? activity.name_ar : activity.name,
      fee: activity.monthly_fee, period: `${today} - ${endDate}`, start_date: today,
      end_date: endDate, weeks: defaultWeeks, schedule: '', level_id: '', level_name: '', instance: existingCount + 1
    }]);
    toast.success(language === 'ar' ? `تم إضافة ${activity.name_ar}` : `Added ${activity.name}`);
  };

  const unlockFeeEdit = async () => {
    const password = window.prompt(language === 'ar' ? 'أدخل كلمة المرور لتغيير السعر:' : 'Enter password to change price:');
    if (password === null) return false;
    const ok = await verifyOperationPassword('edit_price', password, selectedBranchId);
    if (ok) { setFeeEditUnlocked(true); toast.success(language === 'ar' ? 'تم فتح تعديل السعر' : 'Price edit unlocked'); return true; }
    toast.error(language === 'ar' ? 'كلمة المرور غير صحيحة' : 'Incorrect password');
    return false;
  };

  const updateItemFee = async (index, newFee) => {
    if (!feeEditUnlocked) { const ok = await unlockFeeEdit(); if (!ok) return; }
    const updated = [...invoiceItems]; updated[index].fee = parseFloat(newFee) || 0; setInvoiceItems(updated);
  };

  const updateItemDate = (index, field, value) => {
    const updated = [...invoiceItems]; updated[index][field] = value;
    if (field === 'start_date') { const w = updated[index].weeks ?? 4; updated[index].end_date = calcEndDate(value, w, updated[index].training_days); }
    updated[index].period = `${updated[index].start_date} - ${updated[index].end_date}`;
    setInvoiceItems(updated);
  };

  const updateItemWeeks = (index, weeks) => {
    const updated = [...invoiceItems]; updated[index].weeks = parseInt(weeks, 10) || 4;
    if (updated[index].start_date) { updated[index].end_date = calcEndDate(updated[index].start_date, updated[index].weeks, updated[index].training_days); updated[index].period = `${updated[index].start_date} - ${updated[index].end_date}`; }
    setInvoiceItems(updated);
  };

  const removeItem = (index) => setInvoiceItems(invoiceItems.filter((_, i) => i !== index));

  const updateItemSchedule = (index, schedule) => {
    const updated = [...invoiceItems]; updated[index].schedule = schedule; setInvoiceItems(updated);
  };

  const initLevelSelector = (index) => setLevelSelectorState(prev => ({ ...prev, [index]: { step: 'activity', selectedActivity: '', selectedTime: '' } }));
  const selectLevelActivity = (index, activityId) => setLevelSelectorState(prev => ({ ...prev, [index]: { step: 'time', selectedActivity: activityId, selectedTime: '' } }));
  const selectLevelTime = (index, timeSlot) => setLevelSelectorState(prev => ({ ...prev, [index]: { ...prev[index], step: 'level', selectedTime: timeSlot } }));
  const goBackLevelSelector = (index) => {
    const current = levelSelectorState[index]; if (!current) return;
    if (current.step === 'level') { setLevelSelectorState(prev => ({ ...prev, [index]: { ...prev[index], step: 'time', selectedTime: '' } })); }
    else if (current.step === 'time') { setLevelSelectorState(prev => ({ ...prev, [index]: { step: 'activity', selectedActivity: '', selectedTime: '' } })); }
  };
  const resetLevelSelector = (index) => setLevelSelectorState(prev => { const n = { ...prev }; delete n[index]; return n; });

  const updateItemLevel = async (index, levelId, capacityInfo = null) => {
    const updated = [...invoiceItems]; const level = levels.find(l => l.id === levelId);
    updated[index].level_id = levelId;
    updated[index].level_name = level ? `${level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)} - ${level.activity_name}` : '';
    resetLevelSelector(index);
    if (levelId) {
      try {
        let is_full, member_count, max_capacity;
        if (capacityInfo && typeof capacityInfo.memberCount === 'number') {
          member_count = capacityInfo.memberCount; max_capacity = capacityInfo.maxCapacity; is_full = capacityInfo.isFull;
        } else {
          const response = await levelsAPI.getMemberCount(levelId);
          ({ is_full, member_count, max_capacity } = response.data);
        }
        if (is_full) {
          setLevelCapacityWarnings(prev => ({ ...prev, [index]: { isFull: true, isAccepted: false, memberCount: member_count, maxCapacity: max_capacity, message: language === 'ar' ? `العدد في هذا المستوى مكتمل (${member_count}/${max_capacity} مشتركين)` : `This level is full (${member_count}/${max_capacity} members)` } }));
        } else {
          setLevelCapacityWarnings(prev => { const n = { ...prev }; delete n[index]; return n; });
        }
      } catch (error) { console.error('Error checking level capacity:', error); }
    } else { setLevelCapacityWarnings(prev => { const n = { ...prev }; delete n[index]; return n; }); }
    setInvoiceItems(updated);
  };

  const handleAcceptFullLevel = (index) => {
    setLevelCapacityWarnings(prev => ({ ...prev, [index]: { ...prev[index], isAccepted: true } }));
    toast.success(language === 'ar' ? 'تم قبول التسجيل في هذا المستوى' : 'Registration accepted for this level');
  };

  const handleRejectFullLevel = (index) => {
    const updated = [...invoiceItems]; updated[index].level_id = ''; updated[index].level_name = ''; setInvoiceItems(updated);
    setLevelCapacityWarnings(prev => { const n = { ...prev }; delete n[index]; return n; });
  };

  const handleCreateInvoice = async () => {
    if (invoiceItems.length === 0) { toast.error(language === 'ar' ? 'أضف نشاط واحد على الأقل' : 'Add at least one activity'); return; }
    if (!customerNameAr) { toast.error(language === 'ar' ? 'أدخل اسم العميل' : 'Enter customer name'); return; }
    if (!isEditMode) {
      const missingLevelMain = (invoiceItems || []).find(it => !it.is_product && !it.level_id);
      if (missingLevelMain) {
        const mainLabel = customerNameAr || (language === 'ar' ? 'العضو الرئيسي' : 'Primary member');
        toast.error(language === 'ar'
          ? `يجب اختيار المستوى للعضو "${mainLabel}" - النشاط: ${missingLevelMain.activity_name || ''}`
          : `Please select a level for member "${mainLabel}" - activity: ${missingLevelMain.activity_name || ''}`);
        return;
      }
      for (let i = 0; i < (additionalMembers || []).length; i++) {
        const am = additionalMembers[i];
        const memberLabel = am.member?.name_ar || am.member?.name || (language === 'ar' ? `العضو ${i + 2}` : `Member ${i + 2}`);
        const missing = (am.items || []).find(it => !it.is_product && !it.level_id);
        if (missing) {
          toast.error(language === 'ar'
            ? `يجب اختيار المستوى للعضو "${memberLabel}" - النشاط: ${missing.activity_name || ''}`
            : `Please select a level for member "${memberLabel}" - activity: ${missing.activity_name || ''}`);
          return;
        }
      }
    }
    const hasUnacceptedFullLevel = Object.values(levelCapacityWarnings).some(w => w.isFull && !w.isAccepted);
    if (hasUnacceptedFullLevel) { toast.error(language === 'ar' ? 'يوجد مستوى مكتمل العدد، يرجى الموافقة أو اختيار مستوى آخر.' : 'A selected level is full, please accept or choose another level.'); return; }
    setSaving(true);
    const { totalDiscount } = calculateTotals();
    try {
      if (isEditMode && editingInvoiceId) {
        await invoicesAPI.update(editingInvoiceId, {
          member_id: selectedMember?.id || null, items: invoiceItems.map(stripTransient),
          discount: totalDiscount, discount_code: appliedCoupon?.code || null,
          notes, payment_method: paymentMethod, customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress
        });
        toast.success(language === 'ar' ? 'تم تحديث الفاتورة' : 'Invoice updated');
      } else {
        const createPayload = {
          member_id: selectedMember?.id || null, items: invoiceItems.map(stripTransient),
          discount: totalDiscount, discount_code: appliedCoupon?.code || null,
          notes, payment_method: paymentMethod, customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress, branch_id: selectedBranchId
        };
        if (additionalMembers.length > 0) {
          createPayload.additional_members = additionalMembers.map(am => ({ member_id: am.member.id, member_name: am.member.name_ar || am.member.name, member_code: am.member.member_code || '', items: am.items.map(stripTransient) }));
        }
        await invoicesAPI.create(createPayload);
        toast.success(t('success'));
        if (selectedMember) {
          const subscriptionItems = (invoiceItems || []).map(item => ({ activity_name: item.activity_name, start_date: item.start_date, end_date: item.end_date, schedule: item.schedule }));
          setQrCardMember({ id: selectedMember.id, name_ar: customerNameAr || selectedMember.name_ar || selectedMember.name, member_code: selectedMember.member_code, phone: customerPhone || selectedMember.phone });
          setQrCardSubscription(subscriptionItems);
          setIsQRCardDialogOpen(true);
        }
      }
      loadData();
      closeCreateDialog();
    } catch (error) { toast.error(t('error')); } finally { setSaving(false); }
  };

  const openEditDialog = (invoice) => {
    if (invoice.status !== 'pending') { toast.error(language === 'ar' ? 'يمكن تعديل الفواتير المعلقة فقط' : 'Can only edit pending invoices'); return; }
    setIsEditMode(true); setEditingInvoiceId(invoice.id);
    setSelectedMember(members.find(m => m.id === invoice.member_id) || null);
    setInvoiceItems((invoice.items || []).map(item => ({
      activity_id: item.activity_id, activity_name: item.activity_name, fee: item.fee, period: item.period,
      schedule: item.schedule || '', start_date: item.start_date || (item.period || '').split(' - ')[0] || '',
      end_date: item.end_date || (item.period || '').split(' - ')[1] || '',
      training_days: item.training_days || [], training_time: item.training_time || '',
      training_time_hour: item.training_time_hour || '', level_id: item.level_id || '', level_name: item.level_name || '',
      weeks: item.weeks ?? (() => { const sd = item.start_date || (item.period || '').split(' - ')[0] || ''; const ed = item.end_date || (item.period || '').split(' - ')[1] || ''; if (sd && ed) { const diff = Math.round((new Date(ed) - new Date(sd)) / (7 * 24 * 60 * 60 * 1000)); return diff > 0 ? diff : 4; } return 4; })()
    })));
    setDiscount(invoice.discount || 0); setNotes(invoice.notes || ''); setPaymentMethod(invoice.payment_method || 'card');
    setCustomerNameAr(invoice.customer_name_ar || ''); setCustomerPhone(invoice.customer_phone || ''); setCustomerAddress(invoice.customer_address || '');
    setIsCreateDialogOpen(true); setIsViewDialogOpen(false);
  };

  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false); setSelectedMember(null); setInvoiceItems([]); setDiscount(0); setNotes(''); setPaymentMethod('card');
    setCustomerNameAr(''); setCustomerPhone(''); setCustomerAddress(''); setIsEditMode(false); setEditingInvoiceId(null);
    setCouponCode(''); setAppliedCoupon(null); setCouponDiscount(0); setMarketerDiscountPercent(0); setMarketerName(''); setItemType('activity'); setFeeEditUnlocked(false);
    setAdditionalMembers([]); setAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
  };

  const { subtotal, vatAmount, totalBeforeDiscount, totalDiscount, marketerDiscount, total } = calculateTotals();

  return {
    isCreateDialogOpen, setIsCreateDialogOpen, isEditMode, editingInvoiceId, selectedMember, setSelectedMember,
    invoiceItems, setInvoiceItems, discount, setDiscount, notes, setNotes, paymentMethod, setPaymentMethod,
    saving, setSaving, couponCode, setCouponCode, appliedCoupon, setAppliedCoupon, couponDiscount, setCouponDiscount,
    marketerDiscountPercent, setMarketerDiscountPercent, marketerName, setMarketerName, marketerDiscount,
    validatingCoupon, itemType, setItemType, feeEditUnlocked, setFeeEditUnlocked,
    additionalMembers, setAdditionalMembers, additionalMemberNewForm, setAdditionalMemberNewForm,
    levelCapacityWarnings, setLevelCapacityWarnings, levelSelectorState, setLevelSelectorState,
    customerNameAr, setCustomerNameAr, customerPhone, setCustomerPhone, customerAddress, setCustomerAddress,
    MAIN_ACTIVITIES_FOR_LEVELS, groupedLevelsForSelector, getGroupedLevelsForDays, parseActivityForLevel,
    subtotal, vatAmount, totalBeforeDiscount, totalDiscount, total,
    handleMemberSelect, addProductToInvoice, addActivityToInvoice, validateCoupon, removeCoupon,
    updateItemFee, updateItemDate, updateItemWeeks, removeItem, updateItemSchedule, updateItemLevel,
    handleAcceptFullLevel, handleRejectFullLevel, initLevelSelector, selectLevelActivity, selectLevelTime,
    goBackLevelSelector, resetLevelSelector, unlockFeeEdit, handleCreateInvoice, openEditDialog, closeCreateDialog
  };
};
