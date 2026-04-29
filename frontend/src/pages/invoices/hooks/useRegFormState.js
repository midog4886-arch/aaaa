import { useState } from 'react';
import { toast } from 'sonner';
import html2pdf from 'html2pdf.js';
import { registrationFormsAPI, discountsAPI, levelsAPI, membersAPI } from '../../../services/api';
import { COMPANY_INFO } from '../constants';
import { calcEndDate, stripTransient } from './useInvoiceForm';

export const useRegFormState = ({
  activities, products, levels, selectedBranchId, language, t, loadData,
  loyaltySettings, loyaltyLevelSettings, branches, getBranchName,
  setMembers, setIsAddMemberDialogOpen, setAddMemberSource, setRegistrationForms
}) => {
  const [isRegistrationFormDialogOpen, setIsRegistrationFormDialogOpen] = useState(false);
  const [isViewRegFormDialogOpen, setIsViewRegFormDialogOpen] = useState(false);
  const [isEditRegFormDialogOpen, setIsEditRegFormDialogOpen] = useState(false);
  const [selectedRegForm, setSelectedRegForm] = useState(null);
  const [editRegFormId, setEditRegFormId] = useState(null);

  const [regFormData, setRegFormData] = useState({ customer_name: '', customer_phone: '' });
  const [regFormItems, setRegFormItems] = useState([]);
  const [regFormDiscount, setRegFormDiscount] = useState(0);
  const [regFormNotes, setRegFormNotes] = useState('');
  const [regFormPaymentMethod, setRegFormPaymentMethod] = useState('cash');
  const [regFormCouponCode, setRegFormCouponCode] = useState('');
  const [regFormAppliedCoupon, setRegFormAppliedCoupon] = useState(null);
  const [regFormCouponDiscount, setRegFormCouponDiscount] = useState(0);
  const [regFormItemType, setRegFormItemType] = useState('activity');
  const [regFormAdditionalMembers, setRegFormAdditionalMembers] = useState([]);
  const [regFormAdditionalMemberNewForm, setRegFormAdditionalMemberNewForm] = useState({ show: false, index: -1, data: { name_ar: '' } });
  const [regFormLevelWarnings, setRegFormLevelWarnings] = useState({});
  const [regFormLevelSelectorState, setRegFormLevelSelectorState] = useState({});

  const addActivityToRegForm = (activity) => {
    const today = new Date().toISOString().split('T')[0];
    const defaultWeeks = 4;
    const endDate = calcEndDate(today, defaultWeeks);
    setRegFormItems(prev => [...prev, {
      activity_id: activity.id, activity_name: language === 'ar' ? activity.name_ar : activity.name,
      fee: activity.monthly_fee || activity.fee || 0, start_date: today, end_date: endDate,
      weeks: defaultWeeks, period: `${today} - ${endDate}`, schedule: '', level_id: '', level_name: '',
      is_product: false, quantity: 1
    }]);
  };

  const addProductToRegForm = (product) => {
    setRegFormItems(prev => [...prev, {
      product_id: product.id, activity_name: product.name, fee: product.price || 0,
      start_date: '', end_date: '', period: '', schedule: '', is_product: true, quantity: 1
    }]);
  };

  const removeActivityFromRegForm = (index) => setRegFormItems(prev => prev.filter((_, i) => i !== index));

  const initRegFormLevelSelector = (index) => setRegFormLevelSelectorState(prev => ({ ...prev, [index]: { step: 'activity', selectedActivity: '', selectedTime: '' } }));
  const selectRegFormLevelActivity = (index, activityId) => setRegFormLevelSelectorState(prev => ({ ...prev, [index]: { step: 'time', selectedActivity: activityId, selectedTime: '' } }));
  const selectRegFormLevelTime = (index, timeSlot) => setRegFormLevelSelectorState(prev => ({ ...prev, [index]: { ...prev[index], step: 'level', selectedTime: timeSlot } }));
  const goBackRegFormLevelSelector = (index) => {
    const current = regFormLevelSelectorState[index]; if (!current) return;
    if (current.step === 'level') { setRegFormLevelSelectorState(prev => ({ ...prev, [index]: { ...prev[index], step: 'time', selectedTime: '' } })); }
    else if (current.step === 'time') { setRegFormLevelSelectorState(prev => ({ ...prev, [index]: { step: 'activity', selectedActivity: '', selectedTime: '' } })); }
  };
  const resetRegFormLevelSelector = (index) => setRegFormLevelSelectorState(prev => { const n = { ...prev }; delete n[index]; return n; });

  const updateRegFormItemLevel = async (index, levelId) => {
    const updated = [...regFormItems];
    const level = levels.find(l => l.id === levelId);
    updated[index].level_id = levelId;
    updated[index].level_name = level ? `${level.display_name || (level.custom_name ? level.custom_name : `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number}`)} - ${level.activity_name}` : '';
    resetRegFormLevelSelector(index);
    if (levelId) {
      try {
        const response = await levelsAPI.getMemberCount(levelId);
        const { is_full, member_count, max_capacity } = response.data;
        if (is_full) { setRegFormLevelWarnings(prev => ({ ...prev, [index]: { isFull: true, isAccepted: false, memberCount: member_count, maxCapacity: max_capacity, message: language === 'ar' ? `العدد في هذا المستوى مكتمل (${member_count}/${max_capacity} مشتركين)` : `This level is full (${member_count}/${max_capacity} members)` } })); }
        else { setRegFormLevelWarnings(prev => { const n = { ...prev }; delete n[index]; return n; }); }
      } catch (error) { console.error('Error checking level capacity:', error); }
    } else { setRegFormLevelWarnings(prev => { const n = { ...prev }; delete n[index]; return n; }); }
    setRegFormItems(updated);
  };

  const handleAcceptRegFormFullLevel = (index) => {
    setRegFormLevelWarnings(prev => ({ ...prev, [index]: { ...prev[index], isAccepted: true } }));
    toast.success(language === 'ar' ? 'تم قبول التسجيل في هذا المستوى' : 'Registration accepted for this level');
  };

  const handleRejectRegFormFullLevel = (index) => {
    const updated = [...regFormItems]; updated[index].level_id = ''; updated[index].level_name = ''; setRegFormItems(updated);
    setRegFormLevelWarnings(prev => { const n = { ...prev }; delete n[index]; return n; });
  };

  const validateRegFormCoupon = async () => {
    if (!regFormCouponCode.trim()) return;
    try {
      const response = await discountsAPI.validate(regFormCouponCode.trim());
      const coupon = response.data;
      setRegFormAppliedCoupon(coupon);
      const subtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
      let discountValue = 0;
      if (coupon.type === 'percentage') { discountValue = (subtotal * coupon.value) / 100; if (coupon.max_discount && discountValue > coupon.max_discount) discountValue = coupon.max_discount; }
      else { discountValue = coupon.value; }
      setRegFormCouponDiscount(discountValue);
      toast.success(language === 'ar' ? `تم تطبيق الكوبون: خصم ${discountValue.toFixed(2)} ر.س` : `Coupon applied: ${discountValue.toFixed(2)} SAR discount`);
    } catch (error) {
      toast.error(language === 'ar' ? 'كوبون غير صالح' : 'Invalid coupon');
      setRegFormAppliedCoupon(null); setRegFormCouponDiscount(0);
    }
  };

  const closeRegistrationFormDialog = () => {
    setIsRegistrationFormDialogOpen(false); setRegFormData({ customer_name: '', customer_phone: '' });
    setRegFormItems([]); setRegFormDiscount(0); setRegFormNotes(''); setRegFormPaymentMethod('cash');
    setRegFormCouponCode(''); setRegFormAppliedCoupon(null); setRegFormCouponDiscount(0); setRegFormItemType('activity');
    setRegFormAdditionalMembers([]); setRegFormAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '' } });
  };

  const closeEditRegFormDialog = () => {
    setIsEditRegFormDialogOpen(false); setEditRegFormId(null); setRegFormData({ customer_name: '', customer_phone: '' });
    setRegFormItems([]); setRegFormDiscount(0); setRegFormNotes(''); setRegFormPaymentMethod('cash');
    setRegFormCouponCode(''); setRegFormAppliedCoupon(null); setRegFormCouponDiscount(0);
  };

  const buildFormPayload = () => {
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount;
    const payload = {
      customer_name: regFormData.customer_name, customer_phone: regFormData.customer_phone,
      items: regFormItems.map(stripTransient), subtotal: formSubtotal, discount: totalDiscountAmount,
      discount_code: regFormAppliedCoupon?.code || '', vat_amount: 0, total: formTotal,
      payment_method: regFormPaymentMethod, notes: regFormNotes,
      branch_id: selectedBranchId !== 'all' ? selectedBranchId : null
    };
    if (regFormAdditionalMembers.length > 0) {
      payload.additional_members = regFormAdditionalMembers.filter(am => am.member && am.items.length > 0).map(am => ({ member_id: am.member.id, member_name: am.member.name_ar || am.member.name, member_code: am.member.member_code || '', items: am.items.map(stripTransient) }));
    }
    return payload;
  };

  const validateRegFormLevels = () => {
    const missingMain = (regFormItems || []).find(it => !it.is_product && !it.level_id);
    if (missingMain) {
      const mainLabel = regFormData?.customer_name || (language === 'ar' ? 'العضو الرئيسي' : 'Primary member');
      toast.error(language === 'ar'
        ? `يجب اختيار المستوى للعضو "${mainLabel}" - النشاط: ${missingMain.activity_name || ''}`
        : `Please select a level for member "${mainLabel}" - activity: ${missingMain.activity_name || ''}`);
      return false;
    }
    for (let i = 0; i < (regFormAdditionalMembers || []).length; i++) {
      const am = regFormAdditionalMembers[i];
      if (!am.member || !(am.items || []).length) continue;
      const memberLabel = am.member?.name_ar || am.member?.name || (language === 'ar' ? `العضو ${i + 2}` : `Member ${i + 2}`);
      const missing = (am.items || []).find(it => !it.is_product && !it.level_id);
      if (missing) {
        toast.error(language === 'ar'
          ? `يجب اختيار المستوى للعضو "${memberLabel}" - النشاط: ${missing.activity_name || ''}`
          : `Please select a level for member "${memberLabel}" - activity: ${missing.activity_name || ''}`);
        return false;
      }
    }
    return true;
  };

  const handlePrintNewRegistrationForm = async () => {
    const hasUnacceptedFullLevel = Object.values(regFormLevelWarnings).some(w => w.isFull && !w.isAccepted);
    if (hasUnacceptedFullLevel) { toast.error(language === 'ar' ? 'يوجد مستوى مكتمل العدد، يرجى الموافقة أو اختيار مستوى آخر.' : 'A selected level is full, please accept or choose another level.'); return; }
    if (!validateRegFormLevels()) return;
    const branchName = branches.find(b => b.id === selectedBranchId)?.name_ar || '';
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount;
    const itemsRows = (regFormItems || []).map((item, idx) => `<tr><td>${idx + 1}</td><td>${item.activity_name || ''}${item.is_product ? ' (منتج)' : ''}</td><td>${item.is_product ? (item.quantity || 1) : (item.period || '-')}</td><td>${item.schedule || '-'}</td><td>${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center">لا يوجد عناصر</td></tr>';
    const paymentText = regFormPaymentMethod === 'cash' ? 'نقداً' : regFormPaymentMethod === 'card' ? 'بطاقة' : regFormPaymentMethod === 'transfer' ? 'تحويل بنكي' : regFormPaymentMethod === 'tabby' ? 'تابي' : regFormPaymentMethod === 'tamara' ? 'تمارا' : regFormPaymentMethod;
    const printWindow = window.open('', '', 'width=800,height=600');
    const content = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>استمارة تسجيل</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');@page{size:A4;margin:6mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:10px;max-width:800px;margin:0 auto;color:#000;font-size:10px}.header-banner{background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);color:white;padding:8px;text-align:center;margin:-10px -10px 8px -10px}.header-banner .company-name{font-size:13px;font-weight:bold;margin-bottom:2px}.header-banner .branch-name{font-size:9px;margin-top:3px;background:rgba(255,255,255,0.2);display:inline-block;padding:2px 8px;border-radius:10px}.header-banner .company-info{font-size:8px;opacity:0.9;margin-top:3px}.form-title{font-size:15px;font-weight:bold;text-align:center;margin:8px 0;padding:6px;background:#f8fafc;border:2px solid #1e3a8a;border-radius:6px;color:#1e3a8a}.info-section{margin-bottom:8px;padding:8px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc}.info-section h4{font-size:11px;font-weight:bold;margin-bottom:5px;color:#1e3a8a;border-bottom:1px solid #1e3a8a;padding-bottom:3px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}.info-row{display:flex;gap:5px;padding:2px 0;font-size:10px}.info-label{font-weight:bold;min-width:70px;color:#374151}table{width:100%;border-collapse:collapse;margin:5px 0}th,td{padding:5px;border:1px solid #d1d5db;text-align:right;font-size:9px}th{background:#1e3a8a;color:white;font-weight:bold}tr:nth-child(even){background:#f8fafc}.totals-section{margin-top:8px;border:2px solid #1e3a8a;padding:8px;border-radius:6px;background:#eff6ff}.totals-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #bfdbfe}.totals-row.discount{color:#dc2626;font-weight:500}.totals-row.total{font-size:13px;font-weight:bold;border-top:2px solid #1e3a8a;border-bottom:none;margin-top:4px;padding-top:6px;color:#1e3a8a}.totals-note{text-align:center;font-size:8px;color:#6b7280;margin-top:4px}.payment-section{margin-top:8px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#fefce8;font-size:10px}.terms-section{margin-top:8px;padding:8px;border:2px solid #f59e0b;border-radius:6px;background:#fffbeb}.terms-section h4{font-weight:bold;margin-bottom:4px;color:#92400e;font-size:10px}.terms-section ul{padding-right:15px;font-size:9px;color:#78350f}.terms-section li{margin-bottom:2px}.signature-section{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:15px}.signature-box{border:1px solid #d1d5db;padding:8px;text-align:center;border-radius:6px;background:white}.signature-box p{margin-bottom:20px;font-weight:bold;color:#374151;font-size:10px}.signature-line{border-top:1px solid #000;margin-top:20px;padding-top:4px;font-size:8px}.loyalty-section{margin-top:8px;padding:8px;border:2px solid #9333EA;border-radius:6px;background:#faf5ff}.loyalty-section h4{font-weight:bold;margin-bottom:4px;color:#9333EA;font-size:11px;text-align:center}.loyalty-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;font-size:8px;margin-bottom:4px}.loyalty-item{padding:1px 3px}.loyalty-levels{border-top:1px solid #e9d5ff;padding-top:4px;margin-top:3px}.loyalty-levels h5{font-weight:bold;font-size:9px;margin-bottom:3px;color:#7c3aed}.levels-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:3px;font-size:8px}.footer{margin-top:8px;text-align:center;font-size:8px;color:#6b7280;border-top:1px solid #e2e8f0;padding-top:6px}</style></head><body><div class="header-banner"><div class="company-name">${COMPANY_INFO.name_ar}</div>${branchName ? `<div class="branch-name">🏢 فرع: ${branchName}</div>` : ''}<div class="company-info">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div></div><div class="form-title">📋 استمارة تسجيل</div><div class="info-section"><h4>👤 بيانات المشترك</h4><div class="info-grid"><div class="info-row"><span class="info-label">الاسم:</span><span>${regFormData.customer_name || '_______________'}</span></div><div class="info-row"><span class="info-label">رقم الجوال:</span><span dir="ltr">${regFormData.customer_phone || '_______________'}</span></div><div class="info-row"><span class="info-label">التاريخ:</span><span>${new Date().toLocaleDateString('ar-SA')}</span></div></div></div><div class="info-section"><h4>📝 الأنشطة والمنتجات</h4><table><thead><tr><th>#</th><th>البند</th><th>الفترة/الكمية</th><th>المواعيد</th><th>الرسوم</th></tr></thead><tbody>${itemsRows}</tbody></table></div><div class="totals-section">${totalDiscountAmount > 0 ? `<div class="totals-row discount"><span>الخصم${regFormAppliedCoupon ? ` (${regFormAppliedCoupon.code})` : ''}:</span><span>- ${totalDiscountAmount.toFixed(2)} ر.س</span></div>` : ''}<div class="totals-row total"><span>💰 الإجمالي:</span><span>${formTotal.toFixed(2)} ر.س</span></div></div><div class="payment-section"><div class="info-row"><span class="info-label">💳 طريقة الدفع:</span><span>${paymentText}</span></div></div>${regFormNotes ? `<div style="margin-top:8px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#f0fdf4;font-size:9px"><strong>📌 ملاحظات:</strong> ${regFormNotes}</div>` : ''}<div class="terms-section"><h4>⚠️ شروط وأحكام:</h4><ul><li>الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</li><li>المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</li></ul></div><div class="loyalty-section"><h4>🏆 برنامج نقاط الولاء</h4><div class="loyalty-grid">${loyaltySettings?.attendance_points != null ? `<div class="loyalty-item">✅ كل حضور: ${loyaltySettings.attendance_points} نقاط</div>` : ''}${loyaltySettings?.streak_5_days_bonus != null ? `<div class="loyalty-item">🔥 سلسلة 5 أيام: ${loyaltySettings.streak_5_days_bonus} نقطة</div>` : ''}${loyaltySettings?.video_watch_points != null ? `<div class="loyalty-item">🎬 مشاهدة فيديو: ${loyaltySettings.video_watch_points} نقاط</div>` : ''}${loyaltySettings?.referral_points != null ? `<div class="loyalty-item">👥 إحالة صديق: ${loyaltySettings.referral_points} نقطة</div>` : ''}${loyaltySettings?.monthly_renewal_points != null ? `<div class="loyalty-item">🔄 تجديد شهري: ${loyaltySettings.monthly_renewal_points} نقطة</div>` : ''}${loyaltySettings?.birthday_points != null ? `<div class="loyalty-item">🎂 عيد ميلاد: ${loyaltySettings.birthday_points} نقطة</div>` : ''}</div><div class="loyalty-levels"><h5>المستويات والمزايا:</h5><div class="levels-grid"><div>🥉 برونزي: ${loyaltyLevelSettings?.bronze_min ?? 0}+</div><div>🥈 فضي: ${loyaltyLevelSettings?.silver_min ?? 500}+ (خصم ${loyaltyLevelSettings?.silver_discount ?? 3}%)</div><div>🥇 ذهبي: ${loyaltyLevelSettings?.gold_min ?? 1500}+ (خصم ${loyaltyLevelSettings?.gold_discount ?? 5}%)</div><div>💎 ماسي: ${loyaltyLevelSettings?.diamond_min ?? 3000}+ (خصم ${loyaltyLevelSettings?.diamond_discount ?? 10}%)</div></div></div></div><div class="signature-section"><div class="signature-box"><p>✍️ توقيع المشترك / ولي الأمر</p><div class="signature-line">التاريخ: _______________</div></div><div class="signature-box"><p>✍️ توقيع الموظف</p><div class="signature-line">التاريخ: _______________</div></div></div><div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div></body></html>`;
    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
    try {
      await registrationFormsAPI.create(buildFormPayload());
      toast.success(language === 'ar' ? 'تم حفظ وطباعة الاستمارة' : 'Form saved and printed');
      loadData(); closeRegistrationFormDialog();
    } catch (error) { console.error('Error saving form:', error); closeRegistrationFormDialog(); }
  };

  const handleSaveRegistrationFormOnly = async () => {
    const hasUnacceptedFullLevel = Object.values(regFormLevelWarnings).some(w => w.isFull && !w.isAccepted);
    if (hasUnacceptedFullLevel) { toast.error(language === 'ar' ? 'يوجد مستوى مكتمل العدد، يرجى الموافقة أو اختيار مستوى آخر.' : 'A selected level is full, please accept or choose another level.'); return; }
    if (!validateRegFormLevels()) return;
    try {
      await registrationFormsAPI.create(buildFormPayload());
      toast.success(language === 'ar' ? 'تم حفظ استمارة التسجيل بنجاح' : 'Registration form saved successfully');
      loadData(); closeRegistrationFormDialog();
    } catch (error) { console.error('Error saving form:', error); toast.error(language === 'ar' ? 'خطأ في حفظ الاستمارة' : 'Error saving form'); }
  };

  const handleConvertFormToInvoice = async (formId) => {
    try { await registrationFormsAPI.convert(formId); toast.success(language === 'ar' ? 'تم تحويل الاستمارة إلى فاتورة' : 'Form converted to invoice'); loadData(); }
    catch (error) { toast.error(error.response?.data?.detail || t('error')); }
  };

  const handleDeleteRegForm = async (formId) => {
    let warningMsg = language === 'ar' ? 'هل أنت متأكد من حذف هذه الاستمارة؟' : 'Are you sure you want to delete this form?';
    if (!window.confirm(warningMsg)) return;
    try { await registrationFormsAPI.delete(formId); toast.success(language === 'ar' ? 'تم حذف الاستمارة' : 'Form deleted'); loadData(); }
    catch (error) { toast.error(t('error')); }
  };

  const handleViewRegForm = (form) => { setSelectedRegForm(form); setIsViewRegFormDialogOpen(true); };

  const handleSaveRegFormPdf = async (form) => {
    const branchName = getBranchName(form.branch_id);
    const paymentText = form.payment_method === 'cash' ? 'نقداً' : form.payment_method === 'card' ? 'بطاقة' : form.payment_method === 'transfer' ? 'تحويل بنكي' : form.payment_method === 'tabby' ? 'تابي' : form.payment_method === 'tamara' ? 'تمارا' : form.payment_method;
    const itemsRows = form.items?.map((item, idx) => `<tr><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${idx + 1}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.activity_name || ''}${item.is_product ? ' (منتج)' : ''}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.is_product ? (item.quantity || 1) : (item.period || '-')}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.schedule || '-'}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">لا يوجد عناصر</td></tr>';
    const htmlContent = `<div style="font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:20px;max-width:800px;margin:0 auto"><div style="background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);color:white;padding:12px;text-align:center;margin:-20px -20px 15px -20px"><div style="font-size:16px;font-weight:bold;margin-bottom:3px">${COMPANY_INFO.name_ar}</div>${branchName ? `<div style="font-size:11px;margin-top:5px;background:rgba(255,255,255,0.2);display:inline-block;padding:3px 12px;border-radius:15px">🏢 فرع: ${branchName}</div>` : ''}<div style="font-size:9px;opacity:0.9;margin-top:5px">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div></div><div style="font-size:20px;font-weight:bold;text-align:center;margin:20px 0;padding:12px;background:#f8fafc;border:2px solid #1e3a8a;border-radius:8px;color:#1e3a8a">📋 استمارة تسجيل - ${form.form_number}</div><div style="margin-bottom:15px;padding:15px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc"><h4 style="font-size:14px;font-weight:bold;margin-bottom:10px;color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:5px">👤 بيانات المشترك</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div style="display:flex;gap:8px;padding:5px 0"><span style="font-weight:bold;min-width:90px;color:#374151">الاسم:</span><span>${form.customer_name || '-'}</span></div><div style="display:flex;gap:8px;padding:5px 0"><span style="font-weight:bold;min-width:90px;color:#374151">رقم الجوال:</span><span dir="ltr">${form.customer_phone || '-'}</span></div></div></div><div style="margin-bottom:15px;padding:15px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc"><h4 style="font-size:14px;font-weight:bold;margin-bottom:10px;color:#1e3a8a">📝 الأنشطة والمنتجات</h4><table style="width:100%;border-collapse:collapse;margin:10px 0"><thead><tr style="background:#1e3a8a;color:white"><th style="padding:10px;text-align:right">#</th><th style="padding:10px;text-align:right">البند</th><th style="padding:10px;text-align:right">الفترة/الكمية</th><th style="padding:10px;text-align:right">المواعيد</th><th style="padding:10px;text-align:right">الرسوم</th></tr></thead><tbody>${itemsRows}</tbody></table></div><div style="margin-top:15px;border:2px solid #1e3a8a;padding:15px;border-radius:8px;background:#eff6ff">${form.discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #bfdbfe;color:#dc2626;font-weight:500"><span>الخصم:</span><span>- ${form.discount?.toFixed(2)} ر.س</span></div>` : ''}<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:bold;padding-top:12px;color:#1e3a8a"><span>💰 الإجمالي:</span><span>${form.total?.toFixed(2)} ر.س</span></div></div><div style="margin-top:15px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#fefce8"><span style="font-weight:bold">💳 طريقة الدفع:</span> ${paymentText}</div>${form.notes ? `<div style="margin-top:15px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f0fdf4"><strong>📌 ملاحظات:</strong> ${form.notes}</div>` : ''}<div style="margin-top:20px;padding:15px;border:2px solid #f59e0b;border-radius:8px;background:#fffbeb"><h4 style="font-weight:bold;margin-bottom:10px;color:#92400e">⚠️ شروط وأحكام:</h4><ul style="padding-right:20px;font-size:11px;color:#78350f;margin:0"><li style="margin-bottom:5px">الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</li><li>المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</li></ul></div><div style="margin-top:25px;display:grid;grid-template-columns:1fr 1fr;gap:30px"><div style="border:2px solid #d1d5db;padding:15px;text-align:center;border-radius:8px;background:white"><p style="margin-bottom:40px;font-weight:bold;color:#374151">✍️ توقيع المشترك / ولي الأمر</p><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px;font-size:10px">التاريخ: _______________</div></div><div style="border:2px solid #d1d5db;padding:15px;text-align:center;border-radius:8px;background:white"><p style="margin-bottom:40px;font-weight:bold;color:#374151">✍️ توقيع الموظف</p><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px;font-size:10px">التاريخ: _______________</div></div></div><div style="margin-top:20px;text-align:center;font-size:10px;color:#6b7280;border-top:2px solid #e2e8f0;padding-top:15px">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div></div>`;
    const element = document.createElement('div'); element.innerHTML = htmlContent; document.body.appendChild(element);
    const opt = { margin: 10, filename: `استمارة_${form.customer_name.replace(/\s+/g, '_')}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    try { await html2pdf().set(opt).from(element).save(); toast.success(language === 'ar' ? 'تم حفظ PDF بنجاح' : 'PDF saved successfully'); }
    catch (error) { console.error('PDF error:', error); toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'PDF save failed'); }
    finally { document.body.removeChild(element); }
  };

  const handlePrintViewedRegForm = (form) => {
    const branchName = getBranchName(form.branch_id);
    const paymentText = form.payment_method === 'cash' ? 'نقداً' : form.payment_method === 'card' ? 'بطاقة' : form.payment_method === 'transfer' ? 'تحويل بنكي' : form.payment_method === 'tabby' ? 'تابي' : form.payment_method === 'tamara' ? 'تمارا' : form.payment_method;
    const itemsRows = form.items?.map((item, idx) => `<tr><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${idx + 1}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.activity_name || ''}${item.is_product ? ' (منتج)' : ''}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.is_product ? (item.quantity || 1) : (item.period || '-')}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.schedule || '-'}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">لا يوجد عناصر</td></tr>';
    const printContent = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>استمارة تسجيل - ${form.form_number}</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:10px;max-width:800px;margin:0 auto;font-size:10px}@media print{body{padding:5px}@page{size:A4;margin:6mm}}.header{background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);color:white;padding:8px;text-align:center;margin-bottom:8px;border-radius:6px}.company-name{font-size:13px;font-weight:bold;margin-bottom:2px}.branch-name{font-size:9px;margin-top:3px;background:rgba(255,255,255,0.2);display:inline-block;padding:2px 8px;border-radius:10px}.tax-info{font-size:8px;opacity:0.9;margin-top:3px}.form-title{font-size:15px;font-weight:bold;text-align:center;margin:8px 0;padding:6px;background:#f8fafc;border:2px solid #1e3a8a;border-radius:6px;color:#1e3a8a}.section{margin-bottom:8px;padding:8px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc}.section-title{font-size:11px;font-weight:bold;margin-bottom:5px;color:#1e3a8a;border-bottom:1px solid #1e3a8a;padding-bottom:3px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}.info-item{display:flex;gap:5px;padding:2px 0;font-size:10px}.info-label{font-weight:bold;min-width:70px;color:#374151}table{width:100%;border-collapse:collapse;margin:5px 0}thead tr{background:#1e3a8a;color:white}th,td{padding:5px;text-align:right;font-size:9px}.totals{margin-top:8px;border:2px solid #1e3a8a;padding:8px;border-radius:6px;background:#eff6ff}.total-row{display:flex;justify-content:space-between;padding:4px 0}.total-main{font-size:13px;font-weight:bold;padding-top:6px;color:#1e3a8a;border-top:1px solid #bfdbfe}.payment-box{margin-top:8px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#fefce8;font-size:10px}.terms{margin-top:8px;padding:8px;border:2px solid #f59e0b;border-radius:6px;background:#fffbeb}.terms-title{font-weight:bold;margin-bottom:4px;color:#92400e;font-size:10px}.terms-list{padding-right:15px;font-size:9px;color:#78350f}.terms-list li{margin-bottom:2px}.loyalty-section{margin-top:8px;padding:8px;border:2px solid #9333EA;border-radius:6px;background:#faf5ff}.loyalty-section h4{font-weight:bold;margin-bottom:4px;color:#9333EA;font-size:11px;text-align:center}.loyalty-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;font-size:8px;margin-bottom:4px}.loyalty-item{padding:1px 3px}.loyalty-levels{border-top:1px solid #e9d5ff;padding-top:4px;margin-top:3px}.loyalty-levels h5{font-weight:bold;font-size:9px;margin-bottom:3px;color:#7c3aed}.levels-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:3px;font-size:8px}.signatures{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:15px}.signature-box{border:1px solid #d1d5db;padding:8px;text-align:center;border-radius:6px;background:white}.signature-label{margin-bottom:20px;font-weight:bold;color:#374151;font-size:10px}.signature-line{border-top:1px solid #000;margin-top:20px;padding-top:4px;font-size:8px}.footer{margin-top:8px;text-align:center;font-size:8px;color:#6b7280;border-top:1px solid #e2e8f0;padding-top:6px}</style></head><body><div class="header"><div class="company-name">${COMPANY_INFO.name_ar}</div>${branchName ? `<div class="branch-name">🏢 فرع: ${branchName}</div>` : ''}<div class="tax-info">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div></div><div class="form-title">📋 استمارة تسجيل - ${form.form_number}</div><div class="section"><div class="section-title">👤 بيانات المشترك</div><div class="info-grid"><div class="info-item"><span class="info-label">الاسم:</span><span>${form.customer_name || '-'}</span></div><div class="info-item"><span class="info-label">رقم الجوال:</span><span dir="ltr">${form.customer_phone || '-'}</span></div><div class="info-item"><span class="info-label">التاريخ:</span><span>${new Date(form.created_at).toLocaleDateString('ar-SA')}</span></div></div></div><div class="section"><div class="section-title">📝 الأنشطة والمنتجات</div><table><thead><tr><th>#</th><th>البند</th><th>الفترة/الكمية</th><th>المواعيد</th><th>الرسوم</th></tr></thead><tbody>${itemsRows}</tbody></table></div><div class="totals">${form.discount > 0 ? `<div class="total-row" style="color:#dc2626;font-weight:500;border-bottom:1px solid #bfdbfe"><span>الخصم:</span><span>- ${form.discount?.toFixed(2)} ر.س</span></div>` : ''}<div class="total-row total-main"><span>💰 الإجمالي:</span><span>${form.total?.toFixed(2)} ر.س</span></div></div><div class="payment-box"><span style="font-weight:bold">💳 طريقة الدفع:</span> ${paymentText}</div>${form.notes ? `<div style="margin-top:8px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;background:#f0fdf4;font-size:9px"><strong>📌 ملاحظات:</strong> ${form.notes}</div>` : ''}<div class="terms"><div class="terms-title">⚠️ شروط وأحكام:</div><ul class="terms-list"><li>الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</li><li>المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</li></ul></div><div class="loyalty-section"><h4>🏆 برنامج نقاط الولاء</h4><div class="loyalty-grid">${loyaltySettings?.attendance_points != null ? `<div class="loyalty-item">✅ كل حضور: ${loyaltySettings.attendance_points} نقاط</div>` : ''}${loyaltySettings?.streak_5_days_bonus != null ? `<div class="loyalty-item">🔥 سلسلة 5 أيام: ${loyaltySettings.streak_5_days_bonus} نقطة</div>` : ''}${loyaltySettings?.referral_points != null ? `<div class="loyalty-item">👥 إحالة صديق: ${loyaltySettings.referral_points} نقطة</div>` : ''}</div><div class="loyalty-levels"><h5>المستويات والمزايا:</h5><div class="levels-grid"><div>🥉 برونزي: ${loyaltyLevelSettings?.bronze_min ?? 0}+</div><div>🥈 فضي: ${loyaltyLevelSettings?.silver_min ?? 500}+ (خصم ${loyaltyLevelSettings?.silver_discount ?? 3}%)</div><div>🥇 ذهبي: ${loyaltyLevelSettings?.gold_min ?? 1500}+ (خصم ${loyaltyLevelSettings?.gold_discount ?? 5}%)</div><div>💎 ماسي: ${loyaltyLevelSettings?.diamond_min ?? 3000}+ (خصم ${loyaltyLevelSettings?.diamond_discount ?? 10}%)</div></div></div></div><div class="signatures"><div class="signature-box"><div class="signature-label">✍️ توقيع المشترك / ولي الأمر</div><div class="signature-line">التاريخ: _______________</div></div><div class="signature-box"><div class="signature-label">✍️ توقيع الموظف</div><div class="signature-line">التاريخ: _______________</div></div></div><div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div></body></html>`;
    const printWindow = window.open('', '_blank'); printWindow.document.write(printContent); printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  };

  const handleSendRegFormWhatsApp = (form) => {
    if (!form) return;
    const phone = form.customer_phone || '';
    if (!phone) { toast.info(language === 'ar' ? 'لا يوجد رقم جوال للعميل' : 'No phone number'); return; }
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '966' + formattedPhone.slice(1);
    const itemsList = form.items?.map(item => {
      const endDate = item.end_date || ((item.period || '').split(' - ')[1] || '').trim();
      const endTs = endDate ? new Date(endDate).getTime() : NaN;
      const endLine = !isNaN(endTs) ? `\n  ⏳ تاريخ الانتهاء: ${new Date(endTs).toLocaleDateString('ar-SA')}` : '';
      return `• ${item.activity_name}${item.is_product ? ` (كمية: ${item.quantity || 1})` : ''}: ${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س${item.schedule ? `\n  🕐 ${item.schedule}` : ''}${item.period ? `\n  📅 ${item.period}` : ''}${endLine}`;
    }).join('\n') || '';
    const paymentText = form.payment_method === 'cash' ? 'نقداً' : form.payment_method === 'card' ? 'بطاقة' : form.payment_method === 'transfer' ? 'تحويل بنكي' : (form.payment_method || '');
    const message = `📲 *لتحميل أيقونة تطبيق الأعضاء اندرويد اضغط على الرابط:*\nhttps://play.google.com/store/apps/details?id=com.champions.academy.member\n🍎 *لتحميل الأيفون اضغط على الرابط:*\nhttps://adaa-alabtal.replit.app/member-login\n👥 *انضم لمجموعتنا على الواتساب:*\nhttps://chat.whatsapp.com/JDf5d5mwAcxBy6nXA9gvhs\n━━━━━━━━━━━━━━\n🏆 *${COMPANY_INFO.name_ar}*\n━━━━━━━━━━━━━━\n📋 *استمارة تسجيل رقم:* #${form.form_number}\n📅 *التاريخ:* ${new Date(form.created_at).toLocaleDateString('ar-SA')}\n👤 *العميل:* ${form.customer_name}\n━━━━━━━━━━━━━━\n*الأنشطة والمواعيد:*\n${itemsList}\n━━━━━━━━━━━━━━`;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleEditRegForm = (form) => {
    setEditRegFormId(form.id);
    setRegFormData({ customer_name: form.customer_name || '', customer_phone: form.customer_phone || '' });
    setRegFormItems((form.items || []).map(item => {
      const sd = item.start_date || (item.period || '').split(' - ')[0] || '';
      const ed = item.end_date || (item.period || '').split(' - ')[1] || '';
      const derivedWeeks = item.weeks != null ? item.weeks : sd && ed ? Math.round((new Date(ed) - new Date(sd)) / (7 * 24 * 60 * 60 * 1000)) || 4 : 4;
      return { ...item, weeks: derivedWeeks };
    }));
    setRegFormDiscount(form.discount || 0); setRegFormNotes(form.notes || ''); setRegFormPaymentMethod(form.payment_method || 'cash');
    setRegFormCouponCode(form.discount_code || ''); setRegFormAppliedCoupon(form.discount_code ? { code: form.discount_code } : null); setRegFormCouponDiscount(0);
    setIsEditRegFormDialogOpen(true);
  };

  const handleSaveEditedRegForm = async () => {
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount;
    try {
      const formData = { customer_name: regFormData.customer_name, customer_phone: regFormData.customer_phone, items: regFormItems.map(stripTransient), subtotal: formSubtotal, discount: totalDiscountAmount, discount_code: regFormAppliedCoupon?.code || '', vat_amount: 0, total: formTotal, payment_method: regFormPaymentMethod, notes: regFormNotes, branch_id: selectedBranchId !== 'all' ? selectedBranchId : null };
      await registrationFormsAPI.update(editRegFormId, formData);
      toast.success(language === 'ar' ? 'تم تحديث الاستمارة بنجاح' : 'Form updated successfully');
      loadData(); closeEditRegFormDialog();
    } catch (error) { console.error('Error updating form:', error); toast.error(language === 'ar' ? 'خطأ في تحديث الاستمارة' : 'Error updating form'); }
  };

  const handleToggleRegFormCheck = async (id) => {
    try { const res = await registrationFormsAPI.toggleCheck(id); setRegistrationForms(prev => prev.map(f => f.id === id ? { ...f, is_checked: res.data.is_checked } : f)); } catch (e) { console.error(e); }
  };

  return {
    isRegistrationFormDialogOpen, setIsRegistrationFormDialogOpen,
    isViewRegFormDialogOpen, setIsViewRegFormDialogOpen,
    isEditRegFormDialogOpen, setIsEditRegFormDialogOpen,
    selectedRegForm, setSelectedRegForm, editRegFormId,
    regFormData, setRegFormData, regFormItems, setRegFormItems,
    regFormDiscount, setRegFormDiscount, regFormNotes, setRegFormNotes,
    regFormPaymentMethod, setRegFormPaymentMethod, regFormCouponCode, setRegFormCouponCode,
    regFormAppliedCoupon, setRegFormAppliedCoupon, regFormCouponDiscount, setRegFormCouponDiscount,
    regFormItemType, setRegFormItemType, regFormAdditionalMembers, setRegFormAdditionalMembers,
    regFormAdditionalMemberNewForm, setRegFormAdditionalMemberNewForm,
    regFormLevelWarnings, setRegFormLevelWarnings, regFormLevelSelectorState, setRegFormLevelSelectorState,
    addActivityToRegForm, addProductToRegForm, removeActivityFromRegForm,
    initRegFormLevelSelector, selectRegFormLevelActivity, selectRegFormLevelTime,
    goBackRegFormLevelSelector, resetRegFormLevelSelector, updateRegFormItemLevel,
    handleAcceptRegFormFullLevel, handleRejectRegFormFullLevel, validateRegFormCoupon,
    closeRegistrationFormDialog, closeEditRegFormDialog,
    handlePrintNewRegistrationForm, handleSaveRegistrationFormOnly, handleConvertFormToInvoice,
    handleDeleteRegForm, handleViewRegForm, handleSaveRegFormPdf, handlePrintViewedRegForm,
    handleSendRegFormWhatsApp, handleEditRegForm, handleSaveEditedRegForm, handleToggleRegFormCheck
  };
};
