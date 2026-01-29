import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { invoicesAPI, membersAPI, activitiesAPI, exportAPI, productsAPI, discountsAPI, branchesAPI, registrationFormsAPI, creditNotesAPI } from '../services/api';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import { 
  Plus, Search, Eye, Printer, Loader2, Receipt, CheckCircle, XCircle, Clock,
  Filter, MessageSquare, X, UserPlus, Trash2, RotateCcw, FileSpreadsheet, Image, Share2, RefreshCcw, Edit, FileText, Package, Percent, Tag, Lock, ClipboardList, ArrowRightCircle, CreditCard
} from 'lucide-react';

const COMPANY_INFO = {
  name_ar: "شركة اداء الابطال العالمية للرياضة",
  name_en: "Global Champions Sports Performance",
  tax_number: "312655637900003",
  commercial_reg: "7043630230",
  vat_rate: 15
};

const INVOICE_TERMS = {
  ar: [
    "الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك",
    "المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك"
  ],
  en: [
    "Subscription has fixed start and end dates. Missed sessions will not be compensated",
    "Paid amount is non-refundable after one week from subscription date"
  ]
};

export const InvoicesPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [invoices, setInvoices] = useState([]);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [registrationForms, setRegistrationForms] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [activeTab, setActiveTab] = useState('invoices');
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [addMemberSource, setAddMemberSource] = useState('invoice'); // 'invoice' or 'registration'
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [isRegistrationFormDialogOpen, setIsRegistrationFormDialogOpen] = useState(false);
  const [isViewCreditNoteDialogOpen, setIsViewCreditNoteDialogOpen] = useState(false);
  const [selectedCreditNote, setSelectedCreditNote] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [savingImage, setSavingImage] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  
  // Registration Form state
  const [regFormData, setRegFormData] = useState({
    customer_name: '', customer_phone: ''
  });
  const [regFormItems, setRegFormItems] = useState([]);
  const [regFormDiscount, setRegFormDiscount] = useState(0);
  const [regFormNotes, setRegFormNotes] = useState('');
  const [regFormPaymentMethod, setRegFormPaymentMethod] = useState('cash');
  const [regFormCouponCode, setRegFormCouponCode] = useState('');
  const [regFormAppliedCoupon, setRegFormAppliedCoupon] = useState(null);
  const [regFormCouponDiscount, setRegFormCouponDiscount] = useState(0);
  const [regFormItemType, setRegFormItemType] = useState('activity');
  
  // View/Edit Registration Form state
  const [isViewRegFormDialogOpen, setIsViewRegFormDialogOpen] = useState(false);
  const [isEditRegFormDialogOpen, setIsEditRegFormDialogOpen] = useState(false);
  const [selectedRegForm, setSelectedRegForm] = useState(null);
  const [editRegFormId, setEditRegFormId] = useState(null);
  
  // Products & Discounts
  const [products, setProducts] = useState([]);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [itemType, setItemType] = useState('activity'); // activity or product
  
  // Refund state
  const [refundType, setRefundType] = useState('full'); // full or partial
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState('');
  
  const [customerNameAr, setCustomerNameAr] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  
  const [newMemberData, setNewMemberData] = useState({
    name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: ''
  });
  
  const printRef = useRef();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [invoicesRes, membersRes, activitiesRes, productsRes, branchesRes, regFormsRes, creditNotesRes] = await Promise.all([
        invoicesAPI.getAll(branchParams), membersAPI.getAll(branchParams), activitiesAPI.getAll(), productsAPI.getAll(branchParams),
        branchesAPI.getAll(), registrationFormsAPI.getAll(branchParams), creditNotesAPI.getAll(branchParams)
      ]);
      setInvoices(invoicesRes.data);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
      setProducts(productsRes.data);
      setBranches(branchesRes.data || []);
      setRegistrationForms(regFormsRes.data || []);
      setCreditNotes(creditNotesRes.data || []);
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };
  
  const getBranchName = (branchId) => {
    if (!branchId) return language === 'ar' ? 'الفرع الرئيسي' : 'Main Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || branchId;
  };

  const handleMemberSelect = (memberId) => {
    if (memberId === 'new') { setAddMemberSource('invoice'); setIsAddMemberDialogOpen(true); return; }
    if (memberId === 'none') { setSelectedMember(null); return; }
    const member = members.find(m => m.id === memberId);
    setSelectedMember(member);
    if (member) {
      setCustomerNameAr(member.name_ar || '');
      setCustomerPhone(member.phone || '');
      setCustomerAddress('');
    }
  };

  // Add product to invoice
  const addProductToInvoice = (productId, qty = 1) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    if (product.quantity < qty) {
      toast.error(language === 'ar' ? 'الكمية غير متوفرة' : 'Insufficient stock');
      return;
    }
    const existingIndex = invoiceItems.findIndex(i => i.product_id === productId);
    if (existingIndex >= 0) {
      const updated = [...invoiceItems];
      updated[existingIndex].quantity = (updated[existingIndex].quantity || 1) + qty;
      updated[existingIndex].fee = product.price * updated[existingIndex].quantity;
      setInvoiceItems(updated);
    } else {
      setInvoiceItems([...invoiceItems, {
        activity_id: productId,
        product_id: productId,
        activity_name: product.name_ar,
        fee: product.price * qty,
        period: '',
        schedule: '',
        is_product: true,
        quantity: qty
      }]);
    }
    // Reset coupon when items change
    if (appliedCoupon) {
      setAppliedCoupon(null);
      setCouponDiscount(0);
      setCouponCode('');
    }
  };

  // Validate and apply coupon
  const validateCoupon = async () => {
    if (!couponCode.trim()) return;
    if (invoiceItems.length === 0) {
      toast.error(language === 'ar' ? 'أضف عناصر أولاً' : 'Add items first');
      return;
    }
    setValidatingCoupon(true);
    try {
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
      const res = await discountsAPI.validate(couponCode, subtotal);
      setAppliedCoupon(res.data.discount);
      // تطبيق قيمة الخصم الثابتة من الكوبون مباشرة
      setCouponDiscount(res.data.discount.value);
      toast.success(language === 'ar' ? `تم تطبيق الكوبون! خصم ${res.data.discount.value} ر.س` : `Coupon applied! Discount ${res.data.discount.value} SAR`);
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'كوبون غير صالح' : 'Invalid coupon'));
      setAppliedCoupon(null);
      setCouponDiscount(0);
    } finally {
      setValidatingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setCouponCode('');
  };

  const addActivityToInvoice = (activityId) => {
    const activity = activities.find(a => a.id === activityId);
    if (!activity) return;
    
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const endDate = nextMonth.toISOString().split('T')[0];
    
    // Generate unique key for duplicate activities
    const existingCount = invoiceItems.filter(item => item.activity_id === activityId).length;
    
    setInvoiceItems([...invoiceItems, {
      activity_id: activity.id,
      activity_name: language === 'ar' ? activity.name_ar : activity.name,
      fee: activity.monthly_fee,
      period: `${today} - ${endDate}`,
      start_date: today,
      end_date: endDate,
      schedule: '', // جدول المواعيد
      instance: existingCount + 1 // Track which instance this is
    }]);
    
    toast.success(language === 'ar' ? `تم إضافة ${activity.name_ar}` : `Added ${activity.name}`);
  };

  const updateItemSchedule = (index, schedule) => {
    const updated = [...invoiceItems];
    updated[index].schedule = schedule;
    setInvoiceItems(updated);
  };

  // Save invoice as image and share to WhatsApp
  const handleSaveAsImage = async () => {
    if (!printRef.current) return;
    setSavingImage(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true
      });
      
      // Download the image
      const link = document.createElement('a');
      link.download = `invoice_${selectedInvoice.id.slice(0, 8)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      
      toast.success(language === 'ar' ? 'تم حفظ الصورة! يمكنك الآن مشاركتها على الواتساب' : 'Image saved! You can now share it on WhatsApp');
      
      // Open WhatsApp with message
      const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
      if (phone) {
        const message = `مرحباً، مرفق فاتورتكم من ${COMPANY_INFO.name_ar} رقم #${selectedInvoice.id.slice(0, 8)}`;
        setTimeout(() => {
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
        }, 500);
      }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ الصورة' : 'Error saving image');
    } finally {
      setSavingImage(false);
    }
  };

  const EDIT_PASSWORD = '242456';
  const [feeEditUnlocked, setFeeEditUnlocked] = useState(false);

  const unlockFeeEdit = () => {
    const password = window.prompt(language === 'ar' ? 'أدخل كلمة المرور لتغيير السعر:' : 'Enter password to change price:');
    if (password === EDIT_PASSWORD) {
      setFeeEditUnlocked(true);
      toast.success(language === 'ar' ? 'تم فتح تعديل السعر' : 'Price edit unlocked');
      return true;
    } else {
      toast.error(language === 'ar' ? 'كلمة المرور غير صحيحة' : 'Incorrect password');
      return false;
    }
  };

  const updateItemFee = (index, newFee) => {
    if (!feeEditUnlocked) {
      if (!unlockFeeEdit()) return;
    }
    const updated = [...invoiceItems];
    updated[index].fee = parseFloat(newFee) || 0;
    setInvoiceItems(updated);
  };

  const updateItemDate = (index, field, value) => {
    const updated = [...invoiceItems];
    updated[index][field] = value;
    updated[index].period = `${updated[index].start_date} - ${updated[index].end_date}`;
    setInvoiceItems(updated);
  };

  const removeItem = (index) => setInvoiceItems(invoiceItems.filter((_, i) => i !== index));

  const calculateTotals = () => {
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
    const vatAmount = Math.round(subtotal * (COMPANY_INFO.vat_rate / 100) * 100) / 100;
    const totalBeforeDiscount = Math.round((subtotal + vatAmount) * 100) / 100;
    const totalDiscount = couponDiscount;
    const total = Math.max(Math.round((totalBeforeDiscount - totalDiscount) * 100) / 100, 0);
    return { subtotal, vatAmount, totalBeforeDiscount, totalDiscount, total };
  };

  const handleCreateMember = async () => {
    if (!newMemberData.name_ar || !newMemberData.phone) {
      toast.error(language === 'ar' ? 'أدخل الاسم ورقم الجوال' : 'Enter name and phone');
      return;
    }
    setSaving(true);
    try {
      // Determine which items to use based on source
      const itemsToUse = addMemberSource === 'registration' ? regFormItems : invoiceItems;
      
      // Build activities from items (only activity items, not products)
      const memberActivities = itemsToUse
        .filter(item => !item.is_product && item.activity_id)
        .map(item => ({
          activity_id: item.activity_id,
          activity_name: item.activity_name,
          start_date: item.start_date || new Date().toISOString().split('T')[0],
          end_date: item.end_date || new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
          fee: item.fee || 0,
          status: 'active',
          coach_id: ''
        }));
      
      const response = await membersAPI.create({ 
        ...newMemberData, 
        age: parseInt(newMemberData.age) || 0, 
        activities: memberActivities,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : null
      });
      const membersRes = await membersAPI.getAll();
      setMembers(membersRes.data);
      
      // Update the appropriate form based on source
      if (addMemberSource === 'registration') {
        setRegFormData({
          ...regFormData,
          customer_name: response.data.name_ar,
          customer_phone: response.data.phone
        });
      } else {
        setSelectedMember(response.data);
        setCustomerNameAr(response.data.name_ar);
        setCustomerPhone(response.data.phone);
      }
      
      setIsAddMemberDialogOpen(false);
      setNewMemberData({ name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' });
      toast.success(language === 'ar' ? 'تم إضافة العضو وحفظه في قائمة الأعضاء' : 'Member added and saved to members list');
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (invoiceItems.length === 0) {
      toast.error(language === 'ar' ? 'أضف نشاط واحد على الأقل' : 'Add at least one activity');
      return;
    }
    if (!customerNameAr) {
      toast.error(language === 'ar' ? 'أدخل اسم العميل' : 'Enter customer name');
      return;
    }
    setSaving(true);
    const totalDiscount = couponDiscount;
    try {
      if (isEditMode && editingInvoiceId) {
        await invoicesAPI.update(editingInvoiceId, {
          member_id: selectedMember?.id || null,
          items: invoiceItems,
          discount: totalDiscount,
          discount_code: appliedCoupon?.code || null,
          notes, payment_method: paymentMethod,
          customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress
        });
        toast.success(language === 'ar' ? 'تم تحديث الفاتورة' : 'Invoice updated');
      } else {
        await invoicesAPI.create({
          member_id: selectedMember?.id || null,
          items: invoiceItems,
          discount: totalDiscount,
          discount_code: appliedCoupon?.code || null,
          notes, payment_method: paymentMethod,
          customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress,
          branch_id: selectedBranchId  // Send selected branch for admin
        });
        toast.success(t('success'));
      }
      loadData();
      closeCreateDialog();
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  // Open edit dialog for pending invoice
  const openEditDialog = (invoice) => {
    if (invoice.status !== 'pending') {
      toast.error(language === 'ar' ? 'يمكن تعديل الفواتير المعلقة فقط' : 'Can only edit pending invoices');
      return;
    }
    setIsEditMode(true);
    setEditingInvoiceId(invoice.id);
    setSelectedMember(members.find(m => m.id === invoice.member_id) || null);
    setInvoiceItems(invoice.items.map(item => ({
      activity_id: item.activity_id,
      activity_name: item.activity_name,
      fee: item.fee,
      period: item.period,
      schedule: item.schedule || ''
    })));
    setDiscount(invoice.discount || 0);
    setNotes(invoice.notes || '');
    setPaymentMethod(invoice.payment_method || 'cash');
    setCustomerNameAr(invoice.customer_name_ar || '');
    setCustomerPhone(invoice.customer_phone || '');
    setCustomerAddress(invoice.customer_address || '');
    setIsCreateDialogOpen(true);
    setIsViewDialogOpen(false);
  };

  // Save invoice as PDF only (without WhatsApp)
  const handleSaveAsPdfOnly = async () => {
    if (!printRef.current) return;
    setSavingPdf(true);
    try {
      const element = printRef.current;
      const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0,8);
      const customerName = selectedInvoice.customer_name_ar || selectedInvoice.member_name || 'invoice';
      const filename = `فاتورة_${invoiceNum}_${customerName}.pdf`;
      
      const opt = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      
      await html2pdf().from(element).set(opt).save();
      toast.success(language === 'ar' ? 'تم حفظ الفاتورة كـ PDF' : 'Invoice saved as PDF');
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'Failed to save PDF');
    } finally {
      setSavingPdf(false);
    }
  };

  // Save invoice as PDF and share via WhatsApp
  const handleSaveAsPdf = async () => {
    if (!printRef.current) return;
    setSavingPdf(true);
    try {
      const element = printRef.current;
      const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0,8);
      const customerName = selectedInvoice.customer_name_ar || selectedInvoice.member_name || 'invoice';
      const branchName = getBranchName(selectedInvoice.branch_id);
      const filename = `فاتورة_${invoiceNum}_${customerName}.pdf`;
      
      const opt = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      
      const pdfBlob = await html2pdf().from(element).set(opt).outputPdf('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      
      // Download PDF
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = opt.filename;
      link.click();
      
      toast.success(language === 'ar' ? 'تم حفظ الفاتورة كـ PDF! يمكنك إرفاقها في الواتساب' : 'Invoice saved as PDF! You can attach it in WhatsApp');
      
      // Open WhatsApp with message
      const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
      if (phone) {
        const message = `السلام عليكم،

مرفق فاتورتكم رقم #${invoiceNum}
المبلغ الإجمالي: ${selectedInvoice.total} ر.س
الفرع: ${branchName}

يرجى إرفاق ملف PDF المحفوظ في هذه المحادثة.

شكراً لكم،
شركة اداء الابطال العالمية للرياضة
📞 ${branchName}`;
        
        // Small delay to ensure PDF download starts first
        setTimeout(() => {
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
        }, 500);
      } else {
        toast.info(language === 'ar' ? 'لا يوجد رقم جوال للعميل' : 'No phone number for customer');
      }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'Failed to save PDF');
    } finally {
      setSavingPdf(false);
    }
  };
  
  // Share to WhatsApp directly (without PDF)
  const handleShareWhatsApp = () => {
    if (!selectedInvoice) return;
    
    const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0,8);
    const branchName = getBranchName(selectedInvoice.branch_id);
    const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
    
    const items = selectedInvoice.items?.map(item => 
      `• ${item.activity_name}: ${item.fee} ر.س`
    ).join('\n') || '';
    
    const message = `السلام عليكم،

📄 *فاتورة رقم #${invoiceNum}*

${items}

💰 المجموع الفرعي: ${selectedInvoice.subtotal} ر.س
${selectedInvoice.discount > 0 ? `🎁 الخصم: ${selectedInvoice.discount} ر.س\n` : ''}📊 ضريبة القيمة المضافة (15%): ${selectedInvoice.vat_amount} ر.س
✅ *الإجمالي: ${selectedInvoice.total} ر.س*

🏢 الفرع: ${branchName}
📅 التاريخ: ${new Date(selectedInvoice.created_at).toLocaleDateString('ar-SA')}

شكراً لكم،
شركة اداء الابطال العالمية للرياضة`;

    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    } else {
      // Copy message to clipboard and open WhatsApp
      navigator.clipboard.writeText(message);
      toast.success(language === 'ar' ? 'تم نسخ الرسالة! يمكنك لصقها في الواتساب' : 'Message copied! Paste it in WhatsApp');
      window.open('https://wa.me/', '_blank');
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try { await invoicesAPI.pay(invoiceId); toast.success(t('success')); loadData(); } catch { toast.error(t('error')); }
  };

  const handleRestoreInvoice = async (invoiceId) => {
    try { await invoicesAPI.restore(invoiceId); toast.success(language === 'ar' ? 'تم استرجاع الفاتورة' : 'Invoice restored'); loadData(); } catch { toast.error(t('error')); }
  };

  const DELETE_PASSWORD = '242456';

  const handleDeleteInvoice = async (invoiceId, invoiceStatus) => {
    if (!isAdmin) {
      toast.error(language === 'ar' ? 'الحذف متاح للمدير فقط' : 'Delete is admin only');
      return;
    }
    
    // For paid invoices, require password
    if (invoiceStatus === 'paid') {
      const password = window.prompt(language === 'ar' ? 'أدخل كلمة المرور لحذف الفاتورة المدفوعة:' : 'Enter password to delete paid invoice:');
      if (password !== DELETE_PASSWORD) {
        toast.error(language === 'ar' ? 'كلمة المرور غير صحيحة' : 'Incorrect password');
        return;
      }
    }
    
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف الفاتورة نهائياً؟' : 'Are you sure you want to permanently delete this invoice?')) return;
    try { await invoicesAPI.delete(invoiceId); toast.success(language === 'ar' ? 'تم حذف الفاتورة' : 'Invoice deleted'); loadData(); setIsViewDialogOpen(false); } catch { toast.error(t('error')); }
  };

  // Open refund dialog
  const openRefundDialog = (invoice) => {
    setSelectedInvoice(invoice);
    setRefundType('full');
    setRefundAmount(invoice.total);
    setRefundReason('');
    setIsRefundDialogOpen(true);
  };

  // Handle refund submission
  const handleRefund = async () => {
    if (!selectedInvoice) return;
    const amount = refundType === 'full' ? selectedInvoice.total : parseFloat(refundAmount);
    if (amount <= 0 || amount > selectedInvoice.total) {
      toast.error(language === 'ar' ? 'مبلغ الاسترجاع غير صحيح' : 'Invalid refund amount');
      return;
    }
    setSaving(true);
    try {
      const response = await invoicesAPI.refund(selectedInvoice.id, { amount, reason: refundReason, refund_type: refundType });
      toast.success(language === 'ar' ? `تم إنشاء إشعار دائن رقم ${response.data.credit_note?.credit_note_number} بمبلغ ${amount} ر.س` : `Credit note ${response.data.credit_note?.credit_note_number} created for ${amount} SAR`);
      setIsRefundDialogOpen(false);
      setIsViewDialogOpen(false);
      loadData();
      // Open the credit note view
      if (response.data.credit_note) {
        setSelectedCreditNote(response.data.credit_note);
        setIsViewCreditNoteDialogOpen(true);
      }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في إنشاء إشعار الدائن' : 'Failed to create credit note');
    } finally {
      setSaving(false);
    }
  };

  // View credit note
  const handleViewCreditNote = (creditNote) => {
    setSelectedCreditNote(creditNote);
    setIsViewCreditNoteDialogOpen(true);
  };

  // Delete credit note
  const handleDeleteCreditNote = async (creditNoteId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف إشعار الدائن؟' : 'Delete this credit note?')) return;
    try {
      await creditNotesAPI.delete(creditNoteId);
      toast.success(language === 'ar' ? 'تم حذف إشعار الدائن' : 'Credit note deleted');
      loadData();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حذف إشعار الدائن' : 'Failed to delete credit note');
    }
  };

  // Print credit note
  const handlePrintCreditNote = async (creditNote) => {
    const branchName = getBranchName(creditNote.branch_id);
    
    // Generate QR code for credit note
    let qrDataUrl = '';
    try {
      const qrResponse = await creditNotesAPI.getQR(creditNote.id);
      qrDataUrl = qrResponse.data?.qr_image || '';
    } catch (e) {
      console.log('QR generation failed:', e);
    }
    
    const printWindow = window.open('', '', 'width=800,height=600');
    const content = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>إشعار دائن ${creditNote.credit_note_number}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
          @page { size: A4; margin: 10mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; padding: 20px; max-width: 800px; margin: 0 auto; font-size: 12px; }
          .header { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; padding: 20px; text-align: center; margin: -20px -20px 20px -20px; }
          .header .company-name { font-size: 22px; font-weight: bold; margin-bottom: 5px; }
          .header .doc-type { font-size: 18px; margin-top: 10px; background: rgba(255,255,255,0.2); display: inline-block; padding: 5px 20px; border-radius: 20px; }
          .header .branch-name { font-size: 14px; margin-top: 8px; }
          .header .company-info { font-size: 10px; opacity: 0.9; margin-top: 5px; }
          .info-section { margin-bottom: 15px; padding: 15px; border: 1px solid #fecaca; border-radius: 8px; background: #fef2f2; }
          .info-section h4 { font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 5px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .info-row { display: flex; gap: 8px; padding: 5px 0; }
          .info-label { font-weight: bold; min-width: 100px; color: #374151; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th, td { padding: 10px; border: 1px solid #fecaca; text-align: right; font-size: 11px; }
          th { background: #dc2626; color: white; font-weight: bold; }
          tr:nth-child(even) { background: #fef2f2; }
          .totals-section { margin-top: 15px; border: 2px solid #dc2626; padding: 15px; border-radius: 8px; background: #fef2f2; }
          .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #fecaca; }
          .totals-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #dc2626; border-bottom: none; margin-top: 8px; padding-top: 12px; color: #dc2626; }
          .qr-section { margin-top: 20px; display: flex; justify-content: center; align-items: center; gap: 20px; padding: 15px; border: 2px dashed #dc2626; border-radius: 8px; background: #fff; }
          .qr-section img { width: 120px; height: 120px; }
          .qr-section .qr-info { text-align: center; font-size: 10px; color: #6b7280; }
          .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #6b7280; border-top: 2px solid #fecaca; padding-top: 15px; }
          .refund-badge { background: #dc2626; color: white; padding: 3px 10px; border-radius: 12px; font-size: 11px; margin-right: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">${COMPANY_INFO.name_ar}</div>
          <div class="doc-type">📄 إشعار دائن (مرتجع)</div>
          ${branchName ? `<div class="branch-name">🏢 ${branchName}</div>` : ''}
          <div class="company-info">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div>
        </div>
        <div class="info-section">
          <h4>📋 بيانات إشعار الدائن</h4>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">رقم الإشعار:</span><span style="font-weight:bold;color:#dc2626">${creditNote.credit_note_number}</span></div>
            <div class="info-row"><span class="info-label">التاريخ:</span><span>${new Date(creditNote.created_at).toLocaleDateString('ar-SA')}</span></div>
            <div class="info-row"><span class="info-label">الفاتورة الأصلية:</span><span class="refund-badge">${creditNote.original_invoice_number}</span></div>
            <div class="info-row"><span class="info-label">المحرر:</span><span>${creditNote.created_by || '-'}</span></div>
          </div>
        </div>
        <div class="info-section">
          <h4>👤 بيانات العميل</h4>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">الاسم:</span><span>${creditNote.customer_name_ar}</span></div>
            <div class="info-row"><span class="info-label">الجوال:</span><span dir="ltr">${creditNote.customer_phone || '-'}</span></div>
          </div>
        </div>
        <div class="info-section">
          <h4>📝 البنود المرتجعة</h4>
          <table>
            <thead><tr><th>#</th><th>البند</th><th>الكمية</th><th>المبلغ</th></tr></thead>
            <tbody>
              ${creditNote.items?.map((item, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${item.activity_name}${item.is_product ? ' (منتج)' : ''}</td>
                  <td>${item.quantity || 1}</td>
                  <td>${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td>
                </tr>
              `).join('') || '<tr><td colspan="4">لا توجد بنود</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="totals-section">
          <div class="totals-row"><span>المجموع الفرعي:</span><span>${creditNote.subtotal?.toFixed(2)} ر.س</span></div>
          <div class="totals-row"><span>ضريبة القيمة المضافة (15%):</span><span>${creditNote.vat_amount?.toFixed(2)} ر.س</span></div>
          <div class="totals-row total"><span>💰 إجمالي المرتجع:</span><span>${creditNote.refund_amount?.toFixed(2)} ر.س</span></div>
        </div>
        ${creditNote.reason ? `<div class="info-section"><strong>📌 سبب المرتجع:</strong> ${creditNote.reason}</div>` : ''}
        ${creditNote.notes ? `<div class="info-section"><strong>📝 ملاحظات:</strong> ${creditNote.notes}</div>` : ''}
        ${qrDataUrl ? `
        <div class="qr-section">
          <img src="${qrDataUrl}" alt="QR Code" />
          <div class="qr-info">
            <p><strong>رمز التحقق الإلكتروني</strong></p>
            <p>امسح للتحقق من صحة الإشعار</p>
          </div>
        </div>
        ` : ''}
        <div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div>
      </body>
      </html>
    `;
    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
  };

  const handleCancelInvoice = async (invoiceId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من إلغاء الفاتورة؟' : 'Cancel this invoice?')) return;
    try { await invoicesAPI.cancel(invoiceId); toast.success(language === 'ar' ? 'تم إلغاء الفاتورة' : 'Invoice cancelled'); loadData(); } catch { toast.error(t('error')); }
  };

  const loadQRCode = async (invoiceId, status) => {
    // Only load QR for paid invoices
    if (status !== 'paid') {
      setQrCode(null);
      return;
    }
    try {
      const response = await invoicesAPI.getQR(invoiceId);
      setQrCode(response.data.qr_image);
    } catch { setQrCode(null); }
  };

  const handleViewInvoice = async (invoice) => {
    setSelectedInvoice(invoice);
    setIsViewDialogOpen(true);
    loadQRCode(invoice.id, invoice.status);
  };

  const handleSendWhatsApp = (invoice) => {
    const phone = invoice.customer_phone || '';
    if (!phone) { toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number'); return; }
    const formattedPhone = phone.replace(/^0/, '966');
    const vatAmount = invoice.vat_amount || 0;
    
    // Build items list with schedule
    const itemsList = invoice.items?.map((item, i) => {
      let line = `${i + 1}. ${item.activity_name} - ${item.fee} ر.س`;
      if (item.schedule) {
        line += `\n   📅 ${item.schedule}`;
      }
      return line;
    }).join('\n') || '';
    
    const message = `🏆 *${COMPANY_INFO.name_ar}*
━━━━━━━━━━━━━━
📄 *فاتورة رقم:* #${invoice.id.slice(0, 8)}
📅 *التاريخ:* ${new Date(invoice.created_at).toLocaleDateString('ar-SA')}
👤 *العميل:* ${invoice.customer_name_ar || invoice.member_name}
━━━━━━━━━━━━━━
*الأنشطة والمواعيد:*
${itemsList}
━━━━━━━━━━━━━━
💰 *المجموع:* ${invoice.subtotal} ر.س
${invoice.discount > 0 ? `🎁 *الخصم:* ${invoice.discount} ر.س\n` : ''}📊 *ضريبة القيمة المضافة (15%):* ${vatAmount} ر.س
━━━━━━━━━━━━━━
✨ *الإجمالي:* ${invoice.total} ر.س
📌 *الحالة:* ${invoice.status === 'paid' ? '✅ مدفوعة' : '⏳ غير مدفوعة'}
━━━━━━━━━━━━━━
⚠️ *شروط وأحكام:*
• ${INVOICE_TERMS.ar[0]}
• ${INVOICE_TERMS.ar[1]}
━━━━━━━━━━━━━━
🏛️ الرقم الضريبي: ${COMPANY_INFO.tax_number}
📋 السجل التجاري: ${COMPANY_INFO.commercial_reg}`;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write(`<html><head><title>فاتورة</title><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');@page{size:A4;margin:10mm}body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:15px;max-width:800px;margin:0 auto;font-size:11px}.company-name{font-size:16px;font-weight:bold;color:#1E3A8A}.company-info{font-size:9px;color:#666;margin-top:3px}.invoice-details{text-align:left;font-size:10px}.customer-info{background:#f8fafc;padding:10px;border-radius:6px;margin-bottom:10px}.customer-info h4{margin:0 0 5px 0;color:#1E3A8A;font-size:12px}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-size:10px}th{background:#f1f5f9;font-weight:600}.schedule-cell{color:#1d4ed8;font-weight:500}.totals{margin-top:10px}.totals-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0;font-size:11px}.totals-row.vat{color:#059669}.totals-row.total{font-size:14px;font-weight:bold;color:#F97316;border-top:2px solid #1E3A8A;border-bottom:none;padding-top:8px}.payment-info{margin-top:10px;padding:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:10px}.footer{margin-top:15px;padding-top:10px;border-top:1px solid #e2e8f0;text-align:center;font-size:9px;color:#666}.qr-code{text-align:center;margin-top:10px}.qr-code img{width:80px;height:80px}.terms-box{margin-top:10px;padding:8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px}.terms-box p{font-size:9px;font-weight:bold;color:#92400e;margin:0 0 5px 0}.terms-box ul{font-size:8px;color:#a16207;margin:0;padding-right:15px}.notes-box{margin-top:8px;padding:8px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;font-size:9px}</style></head><body>${printContent.innerHTML}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  // Print Registration Form (Black & White, No QR)
  const handlePrintRegistrationForm = () => {
    if (!selectedInvoice) return;
    const branchName = branches.find(b => b.id === selectedInvoice.branch_id)?.name_ar || '';
    const printWindow = window.open('', '', 'width=800,height=600');
    
    // Build items table rows
    const itemsRows = selectedInvoice.items?.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${item.activity_name || ''}</td>
        <td>${item.period || '-'}</td>
        <td>${item.schedule || '-'}</td>
        <td>${item.fee?.toFixed(2) || '0.00'} ر.س</td>
      </tr>
    `).join('') || '';
    
    const content = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>استمارة تسجيل</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
          @page { size: A4; margin: 10mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: 'Tajawal', Arial, sans-serif; 
            direction: rtl; 
            padding: 20px; 
            max-width: 800px; 
            margin: 0 auto; 
            color: #000;
            font-size: 12px;
          }
          .header { 
            text-align: center; 
            border-bottom: 2px solid #000; 
            padding-bottom: 15px; 
            margin-bottom: 15px; 
          }
          .company-name { 
            font-size: 20px; 
            font-weight: bold; 
            margin-bottom: 5px; 
          }
          .company-info { 
            font-size: 10px; 
            color: #333; 
          }
          .form-title { 
            font-size: 18px; 
            font-weight: bold; 
            text-align: center; 
            margin: 15px 0; 
            padding: 8px; 
            background: #f0f0f0; 
            border: 1px solid #000; 
          }
          .info-section { 
            margin-bottom: 15px; 
            padding: 10px; 
            border: 1px solid #000; 
          }
          .info-section h4 { 
            font-size: 13px; 
            font-weight: bold; 
            margin-bottom: 8px; 
            border-bottom: 1px solid #ccc; 
            padding-bottom: 5px; 
          }
          .info-grid { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 8px; 
          }
          .info-row { 
            display: flex; 
            gap: 5px; 
          }
          .info-label { 
            font-weight: bold; 
            min-width: 80px; 
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 10px 0; 
          }
          th, td { 
            padding: 8px; 
            border: 1px solid #000; 
            text-align: right; 
            font-size: 11px; 
          }
          th { 
            background: #e0e0e0; 
            font-weight: bold; 
          }
          .totals-section { 
            margin-top: 10px; 
            border: 1px solid #000; 
            padding: 10px; 
          }
          .totals-row { 
            display: flex; 
            justify-content: space-between; 
            padding: 5px 0; 
            border-bottom: 1px solid #ccc; 
          }
          .totals-row.total { 
            font-size: 14px; 
            font-weight: bold; 
            border-top: 2px solid #000; 
            border-bottom: none; 
            margin-top: 5px; 
            padding-top: 8px; 
          }
          .payment-section {
            margin-top: 10px;
            padding: 10px;
            border: 1px solid #000;
          }
          .payment-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .notes-section {
            margin-top: 10px;
            padding: 10px;
            border: 1px solid #000;
          }
          .terms-section { 
            margin-top: 15px; 
            padding: 10px; 
            border: 1px solid #000; 
          }
          .terms-section h4 { 
            font-weight: bold; 
            margin-bottom: 8px; 
          }
          .terms-section ul { 
            padding-right: 20px; 
            font-size: 10px; 
          }
          .terms-section li { 
            margin-bottom: 3px; 
          }
          .signature-section { 
            margin-top: 20px; 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 20px; 
          }
          .signature-box { 
            border: 1px solid #000; 
            padding: 10px; 
            text-align: center; 
          }
          .signature-box p { 
            margin-bottom: 30px; 
            font-weight: bold; 
          }
          .signature-line { 
            border-top: 1px solid #000; 
            margin-top: 30px; 
            padding-top: 5px; 
            font-size: 10px; 
          }
          .footer { 
            margin-top: 15px; 
            text-align: center; 
            font-size: 9px; 
            color: #333; 
            border-top: 1px solid #000; 
            padding-top: 10px; 
          }
          .branch-name {
            font-size: 14px;
            font-weight: bold;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">${COMPANY_INFO.name_ar}</div>
          ${branchName ? `<div class="branch-name">فرع: ${branchName}</div>` : ''}
          <div class="company-info">
            الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}
          </div>
        </div>
        
        <div class="form-title">استمارة تسجيل</div>
        
        <div class="info-section">
          <h4>بيانات المشترك</h4>
          <div class="info-grid">
            <div class="info-row">
              <span class="info-label">الاسم:</span>
              <span>${selectedInvoice.customer_name_ar || selectedInvoice.member_name || ''}</span>
            </div>
            <div class="info-row">
              <span class="info-label">رقم الجوال:</span>
              <span dir="ltr">${selectedInvoice.customer_phone || ''}</span>
            </div>
            <div class="info-row">
              <span class="info-label">رقم الاستمارة:</span>
              <span>#${selectedInvoice.invoice_number || selectedInvoice.id?.slice(0, 8) || ''}</span>
            </div>
            <div class="info-row">
              <span class="info-label">التاريخ:</span>
              <span>${new Date(selectedInvoice.created_at).toLocaleDateString('ar-SA')}</span>
            </div>
            ${selectedInvoice.customer_address ? `
            <div class="info-row" style="grid-column: span 2;">
              <span class="info-label">العنوان:</span>
              <span>${selectedInvoice.customer_address}</span>
            </div>` : ''}
          </div>
        </div>
        
        <div class="info-section">
          <h4>الأنشطة المسجلة</h4>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>النشاط</th>
                <th>الفترة</th>
                <th>المواعيد</th>
                <th>الرسوم</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
        </div>
        
        <div class="totals-section">
          <div class="totals-row">
            <span>المجموع الفرعي:</span>
            <span>${selectedInvoice.subtotal?.toFixed(2) || '0.00'} ر.س</span>
          </div>
          ${selectedInvoice.discount > 0 ? `
          <div class="totals-row">
            <span>الخصم:</span>
            <span>${selectedInvoice.discount?.toFixed(2) || '0.00'} ر.س</span>
          </div>` : ''}
          <div class="totals-row">
            <span>ضريبة القيمة المضافة (15%):</span>
            <span>${selectedInvoice.vat_amount?.toFixed(2) || '0.00'} ر.س</span>
          </div>
          <div class="totals-row total">
            <span>الإجمالي:</span>
            <span>${selectedInvoice.total?.toFixed(2) || '0.00'} ر.س</span>
          </div>
        </div>
        
        <div class="payment-section">
          <div class="payment-grid">
            <div class="info-row">
              <span class="info-label">طريقة الدفع:</span>
              <span>${selectedInvoice.payment_method === 'cash' ? 'نقداً' : 
                      selectedInvoice.payment_method === 'card' ? 'بطاقة' : 
                      selectedInvoice.payment_method === 'transfer' ? 'تحويل بنكي' : 
                      selectedInvoice.payment_method === 'tabby' ? 'تابي' : 
                      selectedInvoice.payment_method === 'tamara' ? 'تمارا' : 
                      selectedInvoice.payment_method || '-'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">الحالة:</span>
              <span>${selectedInvoice.status === 'paid' ? '✅ مدفوعة' : 
                      selectedInvoice.status === 'pending' ? '⏳ غير مدفوعة' : '❌ ملغاة'}</span>
            </div>
          </div>
        </div>
        
        ${selectedInvoice.notes ? `
        <div class="notes-section">
          <strong>ملاحظات:</strong> ${selectedInvoice.notes}
        </div>` : ''}
        
        <div class="terms-section">
          <h4>الشروط والأحكام:</h4>
          <ul>
            <li>${INVOICE_TERMS.ar[0]}</li>
            <li>${INVOICE_TERMS.ar[1]}</li>
          </ul>
        </div>
        
        <div class="signature-section">
          <div class="signature-box">
            <p>توقيع المشترك / ولي الأمر</p>
            <div class="signature-line">التاريخ: _______________</div>
          </div>
          <div class="signature-box">
            <p>توقيع الموظف</p>
            <div class="signature-line">التاريخ: _______________</div>
          </div>
        </div>
        
        <div class="footer">
          ${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة
        </div>
      </body>
      </html>
    `;
    
    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
  };

  // Print new Registration Form (standalone)
  const handlePrintNewRegistrationForm = async () => {
    const branchName = branches.find(b => b.id === selectedBranchId)?.name_ar || '';
    
    // Calculate totals WITHOUT VAT
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount; // NO VAT for registration form
    
    // Build items table rows
    const itemsRows = regFormItems.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${item.activity_name || ''}${item.is_product ? ' (منتج)' : ''}</td>
        <td>${item.is_product ? (item.quantity || 1) : (item.period || '-')}</td>
        <td>${item.schedule || '-'}</td>
        <td>${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td>
      </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center">لا يوجد عناصر</td></tr>';
    
    // Payment method text
    const paymentText = regFormPaymentMethod === 'cash' ? 'نقداً' : 
                        regFormPaymentMethod === 'card' ? 'بطاقة' : 
                        regFormPaymentMethod === 'transfer' ? 'تحويل بنكي' : 
                        regFormPaymentMethod === 'tabby' ? 'تابي' : 
                        regFormPaymentMethod === 'tamara' ? 'تمارا' : regFormPaymentMethod;
    
    const printWindow = window.open('', '', 'width=800,height=600');
    const content = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>استمارة تسجيل</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
          @page { size: A4; margin: 10mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; padding: 20px; max-width: 800px; margin: 0 auto; color: #000; font-size: 12px; }
          .header-banner { background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white; padding: 20px; text-align: center; margin: -20px -20px 20px -20px; }
          .header-banner .company-name { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
          .header-banner .branch-name { font-size: 16px; margin-top: 8px; background: rgba(255,255,255,0.2); display: inline-block; padding: 4px 16px; border-radius: 20px; }
          .header-banner .company-info { font-size: 11px; opacity: 0.9; margin-top: 8px; }
          .form-title { font-size: 20px; font-weight: bold; text-align: center; margin: 20px 0; padding: 12px; background: #f8fafc; border: 2px solid #1e3a8a; border-radius: 8px; color: #1e3a8a; }
          .info-section { margin-bottom: 15px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
          .info-section h4 { font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 5px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .info-row { display: flex; gap: 8px; padding: 5px 0; }
          .info-label { font-weight: bold; min-width: 90px; color: #374151; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th, td { padding: 10px; border: 1px solid #d1d5db; text-align: right; font-size: 11px; }
          th { background: #1e3a8a; color: white; font-weight: bold; }
          tr:nth-child(even) { background: #f8fafc; }
          .totals-section { margin-top: 15px; border: 2px solid #1e3a8a; padding: 15px; border-radius: 8px; background: #eff6ff; }
          .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #bfdbfe; }
          .totals-row.discount { color: #dc2626; font-weight: 500; }
          .totals-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #1e3a8a; border-bottom: none; margin-top: 8px; padding-top: 12px; color: #1e3a8a; }
          .totals-note { text-align: center; font-size: 10px; color: #6b7280; margin-top: 8px; }
          .payment-section { margin-top: 15px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fefce8; }
          .notes-section { margin-top: 15px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f0fdf4; font-size: 11px; }
          .terms-section { margin-top: 20px; padding: 15px; border: 2px solid #f59e0b; border-radius: 8px; background: #fffbeb; }
          .terms-section h4 { font-weight: bold; margin-bottom: 10px; color: #92400e; }
          .terms-section ul { padding-right: 20px; font-size: 11px; color: #78350f; }
          .terms-section li { margin-bottom: 5px; }
          .signature-section { margin-top: 25px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
          .signature-box { border: 2px solid #d1d5db; padding: 15px; text-align: center; border-radius: 8px; background: white; }
          .signature-box p { margin-bottom: 40px; font-weight: bold; color: #374151; }
          .signature-line { border-top: 1px solid #000; margin-top: 40px; padding-top: 8px; font-size: 10px; }
          .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #6b7280; border-top: 2px solid #e2e8f0; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header-banner">
          <div class="company-name">${COMPANY_INFO.name_ar}</div>
          ${branchName ? `<div class="branch-name">🏢 فرع: ${branchName}</div>` : ''}
          <div class="company-info">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div>
        </div>
        <div class="form-title">📋 استمارة تسجيل</div>
        <div class="info-section">
          <h4>👤 بيانات المشترك</h4>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">الاسم:</span><span>${regFormData.customer_name || '_______________'}</span></div>
            <div class="info-row"><span class="info-label">رقم الجوال:</span><span dir="ltr">${regFormData.customer_phone || '_______________'}</span></div>
            <div class="info-row"><span class="info-label">التاريخ:</span><span>${new Date().toLocaleDateString('ar-SA')}</span></div>
          </div>
        </div>
        <div class="info-section">
          <h4>📝 الأنشطة والمنتجات</h4>
          <table>
            <thead><tr><th>#</th><th>البند</th><th>الفترة/الكمية</th><th>المواعيد</th><th>الرسوم</th></tr></thead>
            <tbody>${itemsRows}</tbody>
          </table>
        </div>
        <div class="totals-section">
          ${totalDiscountAmount > 0 ? `<div class="totals-row discount"><span>الخصم${regFormAppliedCoupon ? ` (${regFormAppliedCoupon.code})` : ''}:</span><span>- ${totalDiscountAmount.toFixed(2)} ر.س</span></div>` : ''}
          <div class="totals-row total"><span>💰 الإجمالي:</span><span>${formTotal.toFixed(2)} ر.س</span></div>
          <div class="totals-note">* الأسعار لا تشمل ضريبة القيمة المضافة</div>
        </div>
        <div class="payment-section">
          <div class="info-row"><span class="info-label">💳 طريقة الدفع:</span><span>${paymentText}</span></div>
        </div>
        ${regFormNotes ? `<div class="notes-section"><strong>📌 ملاحظات:</strong> ${regFormNotes}</div>` : ''}
        <div class="terms-section">
          <h4>⚠️ شروط وأحكام:</h4>
          <ul>
            <li>الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</li>
            <li>المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</li>
          </ul>
        </div>
        <div class="signature-section">
          <div class="signature-box"><p>✍️ توقيع المشترك / ولي الأمر</p><div class="signature-line">التاريخ: _______________</div></div>
          <div class="signature-box"><p>✍️ توقيع الموظف</p><div class="signature-line">التاريخ: _______________</div></div>
        </div>
        <div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div>
      </body>
      </html>
    `;
    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.print();
    
    // Save the registration form to database
    try {
      const formData = {
        customer_name: regFormData.customer_name,
        customer_phone: regFormData.customer_phone,
        items: regFormItems,
        subtotal: formSubtotal,
        discount: totalDiscountAmount,
        discount_code: regFormAppliedCoupon?.code || '',
        vat_amount: 0, // No VAT for registration form
        total: formTotal,
        payment_method: regFormPaymentMethod,
        notes: regFormNotes,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : null
      };
      await registrationFormsAPI.create(formData);
      toast.success(language === 'ar' ? 'تم حفظ وطباعة الاستمارة' : 'Form saved and printed');
      loadData();
      closeRegistrationFormDialog();
    } catch (error) {
      console.error('Error saving form:', error);
      closeRegistrationFormDialog();
    }
  };

  // Save registration form without printing
  const handleSaveRegistrationFormOnly = async () => {
    // Calculate totals WITHOUT VAT
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount;
    
    try {
      const formData = {
        customer_name: regFormData.customer_name,
        customer_phone: regFormData.customer_phone,
        items: regFormItems,
        subtotal: formSubtotal,
        discount: totalDiscountAmount,
        discount_code: regFormAppliedCoupon?.code || '',
        vat_amount: 0,
        total: formTotal,
        payment_method: regFormPaymentMethod,
        notes: regFormNotes,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : null
      };
      await registrationFormsAPI.create(formData);
      toast.success(language === 'ar' ? 'تم حفظ استمارة التسجيل بنجاح' : 'Registration form saved successfully');
      loadData();
      closeRegistrationFormDialog();
    } catch (error) {
      console.error('Error saving form:', error);
      toast.error(language === 'ar' ? 'خطأ في حفظ الاستمارة' : 'Error saving form');
    }
  };

  // Convert registration form to invoice
  const handleConvertFormToInvoice = async (formId) => {
    try {
      const response = await registrationFormsAPI.convert(formId);
      toast.success(language === 'ar' ? 'تم تحويل الاستمارة إلى فاتورة' : 'Form converted to invoice');
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || t('error'));
    }
  };

  // Delete registration form
  const handleDeleteRegForm = async (formId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذه الاستمارة؟' : 'Are you sure you want to delete this form?')) return;
    try {
      await registrationFormsAPI.delete(formId);
      toast.success(language === 'ar' ? 'تم حذف الاستمارة' : 'Form deleted');
      loadData();
    } catch (error) {
      toast.error(t('error'));
    }
  };

  // View registration form
  const handleViewRegForm = (form) => {
    setSelectedRegForm(form);
    setIsViewRegFormDialogOpen(true);
  };

  // Save registration form as PDF
  const handleSaveRegFormPdf = async (form) => {
    const branchName = getBranchName(form.branch_id);
    const paymentText = form.payment_method === 'cash' ? 'نقداً' : 
                        form.payment_method === 'card' ? 'بطاقة' : 
                        form.payment_method === 'transfer' ? 'تحويل بنكي' : 
                        form.payment_method === 'tabby' ? 'تابي' : 
                        form.payment_method === 'tamara' ? 'تمارا' : form.payment_method;
    
    const itemsRows = form.items?.map((item, idx) => `
      <tr>
        <td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${idx + 1}</td>
        <td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.activity_name || ''}${item.is_product ? ' (منتج)' : ''}</td>
        <td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.is_product ? (item.quantity || 1) : (item.period || '-')}</td>
        <td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${item.schedule || '-'}</td>
        <td style="padding:10px;border:1px solid #e2e8f0;text-align:right">${((item.fee || 0) * (item.quantity || 1)).toFixed(2)} ر.س</td>
      </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">لا يوجد عناصر</td></tr>';
    
    const htmlContent = `
      <div style="font-family:'Tajawal',Arial,sans-serif;direction:rtl;padding:20px;max-width:800px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);color:white;padding:20px;text-align:center;margin:-20px -20px 20px -20px">
          <div style="font-size:24px;font-weight:bold;margin-bottom:5px">${COMPANY_INFO.name_ar}</div>
          ${branchName ? `<div style="font-size:16px;margin-top:8px;background:rgba(255,255,255,0.2);display:inline-block;padding:4px 16px;border-radius:20px">🏢 فرع: ${branchName}</div>` : ''}
          <div style="font-size:11px;opacity:0.9;margin-top:8px">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div>
        </div>
        <div style="font-size:20px;font-weight:bold;text-align:center;margin:20px 0;padding:12px;background:#f8fafc;border:2px solid #1e3a8a;border-radius:8px;color:#1e3a8a">📋 استمارة تسجيل - ${form.form_number}</div>
        <div style="margin-bottom:15px;padding:15px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
          <h4 style="font-size:14px;font-weight:bold;margin-bottom:10px;color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:5px">👤 بيانات المشترك</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="display:flex;gap:8px;padding:5px 0"><span style="font-weight:bold;min-width:90px;color:#374151">الاسم:</span><span>${form.customer_name || '-'}</span></div>
            <div style="display:flex;gap:8px;padding:5px 0"><span style="font-weight:bold;min-width:90px;color:#374151">رقم الجوال:</span><span dir="ltr">${form.customer_phone || '-'}</span></div>
            <div style="display:flex;gap:8px;padding:5px 0"><span style="font-weight:bold;min-width:90px;color:#374151">التاريخ:</span><span>${new Date(form.created_at).toLocaleDateString('ar-SA')}</span></div>
          </div>
        </div>
        <div style="margin-bottom:15px;padding:15px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
          <h4 style="font-size:14px;font-weight:bold;margin-bottom:10px;color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:5px">📝 الأنشطة والمنتجات</h4>
          <table style="width:100%;border-collapse:collapse;margin:10px 0">
            <thead><tr style="background:#1e3a8a;color:white"><th style="padding:10px;text-align:right">#</th><th style="padding:10px;text-align:right">البند</th><th style="padding:10px;text-align:right">الفترة/الكمية</th><th style="padding:10px;text-align:right">المواعيد</th><th style="padding:10px;text-align:right">الرسوم</th></tr></thead>
            <tbody>${itemsRows}</tbody>
          </table>
        </div>
        <div style="margin-top:15px;border:2px solid #1e3a8a;padding:15px;border-radius:8px;background:#eff6ff">
          ${form.discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #bfdbfe;color:#dc2626;font-weight:500"><span>الخصم:</span><span>- ${form.discount?.toFixed(2)} ر.س</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:bold;padding-top:12px;color:#1e3a8a"><span>💰 الإجمالي:</span><span>${form.total?.toFixed(2)} ر.س</span></div>
          <div style="text-align:center;font-size:10px;color:#6b7280;margin-top:8px">* الأسعار لا تشمل ضريبة القيمة المضافة</div>
        </div>
        <div style="margin-top:15px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#fefce8">
          <span style="font-weight:bold">💳 طريقة الدفع:</span> ${paymentText}
        </div>
        ${form.notes ? `<div style="margin-top:15px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f0fdf4"><strong>📌 ملاحظات:</strong> ${form.notes}</div>` : ''}
        <div style="margin-top:20px;padding:15px;border:2px solid #f59e0b;border-radius:8px;background:#fffbeb">
          <h4 style="font-weight:bold;margin-bottom:10px;color:#92400e">⚠️ شروط وأحكام:</h4>
          <ul style="padding-right:20px;font-size:11px;color:#78350f;margin:0">
            <li style="margin-bottom:5px">الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</li>
            <li>المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</li>
          </ul>
        </div>
        <div style="margin-top:25px;display:grid;grid-template-columns:1fr 1fr;gap:30px">
          <div style="border:2px solid #d1d5db;padding:15px;text-align:center;border-radius:8px;background:white"><p style="margin-bottom:40px;font-weight:bold;color:#374151">✍️ توقيع المشترك / ولي الأمر</p><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px;font-size:10px">التاريخ: _______________</div></div>
          <div style="border:2px solid #d1d5db;padding:15px;text-align:center;border-radius:8px;background:white"><p style="margin-bottom:40px;font-weight:bold;color:#374151">✍️ توقيع الموظف</p><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px;font-size:10px">التاريخ: _______________</div></div>
        </div>
        <div style="margin-top:20px;text-align:center;font-size:10px;color:#6b7280;border-top:2px solid #e2e8f0;padding-top:15px">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div>
      </div>
    `;
    
    const element = document.createElement('div');
    element.innerHTML = htmlContent;
    document.body.appendChild(element);
    
    const opt = {
      margin: 10,
      filename: `استمارة_${form.customer_name.replace(/\s+/g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    try {
      await html2pdf().set(opt).from(element).save();
      toast.success(language === 'ar' ? 'تم حفظ PDF بنجاح' : 'PDF saved successfully');
    } catch (error) {
      console.error('PDF error:', error);
      toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'PDF save failed');
    } finally {
      document.body.removeChild(element);
    }
  };

  // Open edit registration form dialog
  const handleEditRegForm = (form) => {
    setEditRegFormId(form.id);
    setRegFormData({
      customer_name: form.customer_name || '',
      customer_phone: form.customer_phone || ''
    });
    setRegFormItems(form.items || []);
    setRegFormDiscount(form.discount || 0);
    setRegFormNotes(form.notes || '');
    setRegFormPaymentMethod(form.payment_method || 'cash');
    setRegFormCouponCode(form.discount_code || '');
    setRegFormAppliedCoupon(form.discount_code ? { code: form.discount_code } : null);
    setRegFormCouponDiscount(0);
    setIsEditRegFormDialogOpen(true);
  };

  // Save edited registration form
  const handleSaveEditedRegForm = async () => {
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount;
    
    try {
      const formData = {
        customer_name: regFormData.customer_name,
        customer_phone: regFormData.customer_phone,
        items: regFormItems,
        subtotal: formSubtotal,
        discount: totalDiscountAmount,
        discount_code: regFormAppliedCoupon?.code || '',
        vat_amount: 0,
        total: formTotal,
        payment_method: regFormPaymentMethod,
        notes: regFormNotes,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : null
      };
      await registrationFormsAPI.update(editRegFormId, formData);
      toast.success(language === 'ar' ? 'تم تحديث الاستمارة بنجاح' : 'Form updated successfully');
      loadData();
      closeEditRegFormDialog();
    } catch (error) {
      console.error('Error updating form:', error);
      toast.error(language === 'ar' ? 'خطأ في تحديث الاستمارة' : 'Error updating form');
    }
  };

  // Close edit registration form dialog
  const closeEditRegFormDialog = () => {
    setIsEditRegFormDialogOpen(false);
    setEditRegFormId(null);
    setRegFormData({ customer_name: '', customer_phone: '' });
    setRegFormItems([]);
    setRegFormDiscount(0);
    setRegFormNotes('');
    setRegFormPaymentMethod('cash');
    setRegFormCouponCode('');
    setRegFormAppliedCoupon(null);
    setRegFormCouponDiscount(0);
  };

  // Add activity to registration form
  const addActivityToRegForm = (activity) => {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
    setRegFormItems([...regFormItems, {
      activity_id: activity.id,
      activity_name: language === 'ar' ? activity.name_ar : activity.name,
      fee: activity.fee || 0,
      start_date: today,
      end_date: endDate,
      period: `${today} - ${endDate}`,
      schedule: '',
      is_product: false,
      quantity: 1
    }]);
  };

  // Add product to registration form
  const addProductToRegForm = (product) => {
    setRegFormItems([...regFormItems, {
      product_id: product.id,
      activity_name: product.name,
      fee: product.price || 0,
      start_date: '',
      end_date: '',
      period: '',
      schedule: '',
      is_product: true,
      quantity: 1
    }]);
  };

  // Remove item from registration form
  const removeActivityFromRegForm = (index) => {
    setRegFormItems(regFormItems.filter((_, i) => i !== index));
  };

  // Validate coupon for registration form
  const validateRegFormCoupon = async () => {
    if (!regFormCouponCode.trim()) return;
    try {
      const response = await discountsAPI.validate(regFormCouponCode.trim());
      const coupon = response.data;
      setRegFormAppliedCoupon(coupon);
      
      const subtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
      let discountValue = 0;
      if (coupon.type === 'percentage') {
        discountValue = (subtotal * coupon.value) / 100;
        if (coupon.max_discount && discountValue > coupon.max_discount) {
          discountValue = coupon.max_discount;
        }
      } else {
        discountValue = coupon.value;
      }
      setRegFormCouponDiscount(discountValue);
      toast.success(language === 'ar' ? `تم تطبيق الكوبون: خصم ${discountValue.toFixed(2)} ر.س` : `Coupon applied: ${discountValue.toFixed(2)} SAR discount`);
    } catch (error) {
      toast.error(language === 'ar' ? 'كوبون غير صالح' : 'Invalid coupon');
      setRegFormAppliedCoupon(null);
      setRegFormCouponDiscount(0);
    }
  };

  // Close registration form dialog
  const closeRegistrationFormDialog = () => {
    setIsRegistrationFormDialogOpen(false);
    setRegFormData({ customer_name: '', customer_phone: '' });
    setRegFormItems([]);
    setRegFormDiscount(0);
    setRegFormNotes('');
    setRegFormPaymentMethod('cash');
    setRegFormCouponCode('');
    setRegFormAppliedCoupon(null);
    setRegFormCouponDiscount(0);
    setRegFormItemType('activity');
  };

  const handleExportAllData = () => {
    const token = localStorage.getItem('token');
    const url = exportAPI.allData() + `?token=${token}`;
    window.open(url, '_blank');
  };

  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false); setSelectedMember(null); setInvoiceItems([]);
    setDiscount(0); setNotes(''); setPaymentMethod('cash');
    setCustomerNameAr(''); setCustomerPhone(''); setCustomerAddress('');
    setIsEditMode(false); setEditingInvoiceId(null);
    // Reset coupon state
    setCouponCode(''); setAppliedCoupon(null); setCouponDiscount(0);
    setItemType('activity');
    setFeeEditUnlocked(false);
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      paid: { label: t('paid'), icon: CheckCircle, class: 'bg-green-500/15 text-green-600 border-green-500/30' },
      pending: { label: t('unpaid'), icon: Clock, class: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
      cancelled: { label: t('cancelled'), icon: XCircle, class: 'bg-red-500/15 text-red-600 border-red-500/30' },
      refunded: { label: language === 'ar' ? 'مسترجع' : 'Refunded', icon: RefreshCcw, class: 'bg-purple-500/15 text-purple-600 border-purple-500/30' },
      partially_refunded: { label: language === 'ar' ? 'مسترجع جزئياً' : 'Partially Refunded', icon: RefreshCcw, class: 'bg-purple-500/15 text-purple-600 border-purple-500/30' }
    };
    const { label, icon: Icon, class: className } = statusMap[status] || statusMap.pending;
    return <Badge variant="outline" className={className}><Icon className="w-3 h-3 me-1" />{label}</Badge>;
  };

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = !searchTerm || invoice.member_name?.toLowerCase().includes(searchTerm.toLowerCase()) || invoice.id?.includes(searchTerm) || invoice.customer_phone?.includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || invoice.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const { subtotal, totalDiscount, vatAmount, total } = calculateTotals();

  if (loading) return <Layout title={t('invoices')}><div className="flex items-center justify-center h-64"><div className="spinner" /></div></Layout>;

  return (
    <Layout title={t('invoices')}>
      <div className="space-y-6" data-testid="invoices-page">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div className="flex flex-1 gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder={language === 'ar' ? 'بحث...' : 'Search...'} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="ps-10" />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                  <SelectItem value="pending">{t('unpaid')}</SelectItem>
                  <SelectItem value="paid">{t('paid')}</SelectItem>
                  <SelectItem value="cancelled">{t('cancelled')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}><Filter className="w-4 h-4" /></Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={handleExportAllData} data-testid="export-all-btn">
                <FileSpreadsheet className="w-4 h-4 me-2" />{language === 'ar' ? 'تصدير Excel' : 'Export All'}
              </Button>
              <Button variant="outline" onClick={() => setIsRegistrationFormDialogOpen(true)} className="bg-gray-800 text-white hover:bg-gray-900" data-testid="create-registration-form-btn">
                <FileText className="w-4 h-4 me-2" />{language === 'ar' ? 'استمارة تسجيل' : 'Registration Form'}
              </Button>
              <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="create-invoice-btn">
                <Plus className="w-4 h-4 me-2" />{t('create_invoice')}
              </Button>
            </div>
          </div>
          {showAdvancedSearch && (
            <Card className="p-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2"><Label>{t('activity_name')}</Label>
                  <Select value={filterActivity} onValueChange={setFilterActivity}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">{language === 'ar' ? 'الكل' : 'All'}</SelectItem>
                      {activities.map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name}</SelectItem>)}
                    </SelectContent></Select></div>
                <div className="space-y-2"><Label className="font-medium">{t('from')}</Label><Input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} className="h-14 text-lg w-48" /></div>
                <div className="space-y-2"><Label className="font-medium">{t('to')}</Label><Input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} className="h-14 text-lg w-48" /></div>
                <Button onClick={loadData}><Search className="w-4 h-4 me-2" />{t('search')}</Button>
                <Button variant="outline" onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterActivity('all'); setFilterStartDate(''); setFilterEndDate(''); loadData(); }}><X className="w-4 h-4 me-2" />{language === 'ar' ? 'مسح' : 'Clear'}</Button>
              </div>
            </Card>
          )}
        </div>

        {/* Tabs for Invoices, Registration Forms, and Credit Notes */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl">
            <TabsTrigger value="invoices" className="flex items-center gap-2">
              <Receipt className="w-4 h-4" />
              {language === 'ar' ? 'الفواتير' : 'Invoices'}
              <Badge variant="secondary" className="ms-1">{filteredInvoices.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="forms" className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              {language === 'ar' ? 'استمارات التسجيل' : 'Registration Forms'}
              <Badge variant="secondary" className="ms-1">{registrationForms.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="credit-notes" className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              {language === 'ar' ? 'إشعارات دائن' : 'Credit Notes'}
              <Badge variant="secondary" className="ms-1 bg-red-100 text-red-700">{creditNotes.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Invoices Tab */}
          <TabsContent value="invoices">
            <Card><CardContent className="p-0"><div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>{t('invoice_number')}</th><th>{language === 'ar' ? 'العميل' : 'Customer'}</th><th>{t('phone')}</th>
                  <th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th><th>{t('invoice_status')}</th><th>{t('invoice_date')}</th><th></th>
                </tr></thead>
                <tbody>
                  {filteredInvoices.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">{t('no_data')}</td></tr> :
                    filteredInvoices.map(invoice => (
                      <tr key={invoice.id}>
                        <td className="font-mono text-sm font-bold">#{invoice.invoice_number || invoice.id.slice(0, 8)}</td>
                        <td className="font-medium">{invoice.customer_name_ar || invoice.member_name}</td>
                        <td dir="ltr" className="text-sm">{invoice.customer_phone || '-'}</td>
                        <td className="font-bold text-primary">{invoice.total} {t('sar')}</td>
                        <td>{getStatusBadge(invoice.status)}</td>
                        <td className="text-sm text-muted-foreground">{new Date(invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                        <td>
                          <div className="action-buttons">
                            <button className="action-button" onClick={() => handleViewInvoice(invoice)} title={language === 'ar' ? 'عرض' : 'View'}><Eye className="w-4 h-4" /></button>
                            <button className="action-button text-green-600" onClick={() => handleSendWhatsApp(invoice)} title={language === 'ar' ? 'واتساب' : 'WhatsApp'}><MessageSquare className="w-4 h-4" /></button>
                            {invoice.status === 'pending' && (<>
                              <button className="action-button text-blue-600" onClick={() => openEditDialog(invoice)} title={language === 'ar' ? 'تعديل' : 'Edit'}><Edit className="w-4 h-4" /></button>
                              <button className="action-button text-green-600" onClick={() => handleMarkPaid(invoice.id)} title={language === 'ar' ? 'تم الدفع' : 'Mark Paid'}><CheckCircle className="w-4 h-4" /></button>
                              <button className="action-button text-amber-600" onClick={() => handleCancelInvoice(invoice.id)} title={language === 'ar' ? 'إلغاء' : 'Cancel'}><XCircle className="w-4 h-4" /></button>
                            </>)}
                            {invoice.status === 'paid' && (
                              <button className="action-button text-purple-600" onClick={() => openRefundDialog(invoice)} title={language === 'ar' ? 'استرجاع مبلغ' : 'Refund'}><RefreshCcw className="w-4 h-4" /></button>
                            )}
                            {invoice.status === 'cancelled' && (
                              <button className="action-button text-blue-600" onClick={() => handleRestoreInvoice(invoice.id)} title={language === 'ar' ? 'استرجاع الفاتورة' : 'Restore'}><RotateCcw className="w-4 h-4" /></button>
                            )}
                            {isAdmin && (
                              <button className="action-button text-red-600" onClick={() => handleDeleteInvoice(invoice.id, invoice.status)} title={language === 'ar' ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div></CardContent></Card>
          </TabsContent>

          {/* Registration Forms Tab */}
          <TabsContent value="forms">
            <Card><CardContent className="p-0"><div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>{language === 'ar' ? 'رقم الاستمارة' : 'Form Number'}</th>
                  <th>{language === 'ar' ? 'العميل' : 'Customer'}</th>
                  <th>{t('phone')}</th>
                  <th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                  <th>{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th>{t('invoice_date')}</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {registrationForms.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                      {language === 'ar' ? 'لا توجد استمارات تسجيل' : 'No registration forms'}
                    </td></tr>
                  ) : (
                    registrationForms.map(form => (
                      <tr key={form.id}>
                        <td className="font-mono text-sm font-bold">#{form.form_number}</td>
                        <td className="font-medium">{form.customer_name}</td>
                        <td dir="ltr" className="text-sm">{form.customer_phone || '-'}</td>
                        <td className="font-bold text-primary">{form.total?.toFixed(2)} {t('sar')}</td>
                        <td>
                          <Badge variant="outline" className={
                            form.status === 'converted' ? 'bg-green-100 text-green-700 border-green-300' :
                            form.status === 'cancelled' ? 'bg-red-100 text-red-700 border-red-300' :
                            'bg-amber-100 text-amber-700 border-amber-300'
                          }>
                            {form.status === 'converted' ? (language === 'ar' ? 'تم تحويلها' : 'Converted') :
                             form.status === 'cancelled' ? (language === 'ar' ? 'ملغاة' : 'Cancelled') :
                             (language === 'ar' ? 'قيد الانتظار' : 'Pending')}
                          </Badge>
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {new Date(form.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button 
                              className="action-button text-gray-600" 
                              onClick={() => handleViewRegForm(form)}
                              title={language === 'ar' ? 'عرض' : 'View'}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button text-teal-600" 
                              onClick={() => handleSaveRegFormPdf(form)}
                              title={language === 'ar' ? 'حفظ PDF' : 'Save PDF'}
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                            {form.status === 'pending' && (
                              <>
                                <button 
                                  className="action-button text-orange-600" 
                                  onClick={() => handleEditRegForm(form)}
                                  title={language === 'ar' ? 'تعديل' : 'Edit'}
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button 
                                  className="action-button text-blue-600" 
                                  onClick={() => handleConvertFormToInvoice(form.id)}
                                  title={language === 'ar' ? 'تحويل إلى فاتورة' : 'Convert to Invoice'}
                                >
                                  <ArrowRightCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button 
                              className="action-button text-red-600" 
                              onClick={() => handleDeleteRegForm(form.id)}
                              title={language === 'ar' ? 'حذف' : 'Delete'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div></CardContent></Card>
          </TabsContent>

          {/* Credit Notes Tab */}
          <TabsContent value="credit-notes">
            <Card><CardContent className="p-0"><div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>{language === 'ar' ? 'رقم الإشعار' : 'Credit Note #'}</th>
                  <th>{language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}</th>
                  <th>{language === 'ar' ? 'العميل' : 'Customer'}</th>
                  <th>{language === 'ar' ? 'المبلغ المرتجع' : 'Refund Amount'}</th>
                  <th>{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th>{language === 'ar' ? 'المحرر' : 'Created By'}</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {creditNotes.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">
                      {language === 'ar' ? 'لا توجد إشعارات دائن' : 'No credit notes'}
                    </td></tr>
                  ) : (
                    creditNotes.map(cn => (
                      <tr key={cn.id}>
                        <td className="font-mono text-sm font-bold text-red-600">#{cn.credit_note_number}</td>
                        <td>
                          <Badge variant="outline" className="bg-gray-100">
                            {cn.original_invoice_number}
                          </Badge>
                        </td>
                        <td className="font-medium">{cn.customer_name_ar}</td>
                        <td className="font-bold text-red-600">- {cn.refund_amount?.toFixed(2)} {t('sar')}</td>
                        <td className="text-sm text-muted-foreground">
                          {new Date(cn.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}
                        </td>
                        <td className="text-sm">{cn.created_by || '-'}</td>
                        <td>
                          <div className="action-buttons">
                            <button 
                              className="action-button text-gray-600" 
                              onClick={() => handleViewCreditNote(cn)}
                              title={language === 'ar' ? 'عرض' : 'View'}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button 
                              className="action-button text-green-600" 
                              onClick={() => handlePrintCreditNote(cn)}
                              title={language === 'ar' ? 'طباعة' : 'Print'}
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            {isAdmin && (
                              <button 
                                className="action-button text-red-600" 
                                onClick={() => handleDeleteCreditNote(cn.id)}
                                title={language === 'ar' ? 'حذف' : 'Delete'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div></CardContent></Card>
          </TabsContent>
        </Tabs>

        {/* Create Invoice Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{isEditMode ? (language === 'ar' ? 'تعديل الفاتورة' : 'Edit Invoice') : t('create_invoice')}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>{language === 'ar' ? 'اختر العضو' : 'Select member'}</Label>
                <Select value={selectedMember?.id || 'none'} onValueChange={handleMemberSelect}>
                  <SelectTrigger><SelectValue placeholder={t('member_name')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{language === 'ar' ? '-- بدون عضو --' : '-- No member --'}</SelectItem>
                    <SelectItem value="new" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                    {members.map(m => <SelectItem key={m.id} value={m.id}>{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
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

              {/* Item Type Selector */}
              <div className="flex gap-2 p-2 bg-muted rounded-lg">
                <Button
                  type="button"
                  variant={itemType === 'activity' ? 'default' : 'outline'}
                  onClick={() => setItemType('activity')}
                  className="flex-1"
                  data-testid="item-type-activity"
                >
                  <Receipt className="w-4 h-4 me-2" />
                  {language === 'ar' ? 'الأنشطة' : 'Activities'}
                </Button>
                <Button
                  type="button"
                  variant={itemType === 'product' ? 'default' : 'outline'}
                  onClick={() => setItemType('product')}
                  className="flex-1"
                  data-testid="item-type-product"
                >
                  <Package className="w-4 h-4 me-2" />
                  {language === 'ar' ? 'المنتجات' : 'Products'}
                </Button>
              </div>

              {/* Activity Selector */}
              {itemType === 'activity' && (
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'إضافة نشاط' : 'Add activity'}</Label>
                  <Select value="" onValueChange={addActivityToInvoice}>
                    <SelectTrigger data-testid="activity-selector">
                      <SelectValue placeholder={language === 'ar' ? '+ اختر نشاط لإضافته' : '+ Select activity to add'} />
                    </SelectTrigger>
                    <SelectContent>
                      {activities.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          <div className="flex items-center justify-between w-full gap-4">
                            <span>{language === 'ar' ? a.name_ar : a.name}</span>
                            <span className="font-bold text-orange-600">{a.monthly_fee} {t('sar')}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {invoiceItems.filter(item => !item.is_product).length > 0 && (
                    <p className="text-xs text-green-600">
                      {language === 'ar' 
                        ? `✓ تم إضافة ${invoiceItems.filter(item => !item.is_product).length} نشاط - يمكنك إضافة المزيد أو تكرار نفس النشاط`
                        : `✓ ${invoiceItems.filter(item => !item.is_product).length} activities added - you can add more or repeat same activity`}
                    </p>
                  )}
                </div>
              )}

              {/* Product Selector */}
              {itemType === 'product' && (
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'إضافة منتج من المتجر' : 'Add product from store'}</Label>
                  <Select value="" onValueChange={(id) => addProductToInvoice(id, 1)}>
                    <SelectTrigger data-testid="product-selector">
                      <SelectValue placeholder={language === 'ar' ? '+ اختر منتج لإضافته' : '+ Select product to add'} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.filter(p => p.quantity > 0).map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-green-600" />
                            <span>{p.name_ar}</span>
                            <span className="text-muted-foreground">({p.quantity} {language === 'ar' ? 'متوفر' : 'available'})</span>
                            <span className="font-bold">{p.price} {t('sar')}</span>
                          </div>
                        </SelectItem>
                      ))}
                      {products.filter(p => p.quantity > 0).length === 0 && (
                        <SelectItem value="none" disabled>
                          {language === 'ar' ? 'لا توجد منتجات متوفرة' : 'No products available'}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {invoiceItems.filter(item => item.is_product).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {language === 'ar' 
                        ? `✓ تم إضافة ${invoiceItems.filter(item => item.is_product).length} منتج - يمكنك إضافة المزيد`
                        : `✓ ${invoiceItems.filter(item => item.is_product).length} products added - you can add more`}
                    </p>
                  )}
                </div>
              )}

              {invoiceItems.length > 0 && (
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'عناصر الفاتورة' : 'Invoice Items'}</Label>
                  <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                    {invoiceItems.map((item, idx) => (
                      <div key={idx} className={`p-3 bg-background rounded-lg border space-y-2 ${item.is_product ? 'border-green-300 bg-green-50/50' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {item.is_product ? (
                              <Package className="w-4 h-4 text-green-600" />
                            ) : (
                              <Receipt className="w-4 h-4 text-blue-600" />
                            )}
                            <p className="font-medium">{item.activity_name}</p>
                            {item.is_product && (
                              <Badge variant="outline" className="bg-green-100 text-green-700 text-xs">
                                {language === 'ar' ? 'منتج' : 'Product'}
                              </Badge>
                            )}
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        
                        {/* Product Item Fields */}
                        {item.is_product ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
                              <Input 
                                type="number" 
                                value={item.quantity || 1} 
                                onChange={(e) => {
                                  const qty = parseInt(e.target.value) || 1;
                                  const product = products.find(p => p.id === item.product_id);
                                  if (product && qty <= product.quantity) {
                                    const updated = [...invoiceItems];
                                    updated[idx].quantity = qty;
                                    updated[idx].fee = product.price * qty;
                                    setInvoiceItems(updated);
                                  }
                                }}
                                min="1"
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'المبلغ' : 'Amount'}</Label>
                              <Input 
                                type="number" 
                                value={item.fee} 
                                className="h-8 text-sm bg-muted" 
                                disabled 
                              />
                            </div>
                          </div>
                        ) : (
                          /* Activity Item Fields */
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                              <Input 
                                type="date" 
                                value={item.start_date} 
                                onChange={(e) => updateItemDate(idx, 'start_date', e.target.value)} 
                                className="h-14 text-lg" 
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                              <Input 
                                type="date" 
                                value={item.end_date} 
                                onChange={(e) => updateItemDate(idx, 'end_date', e.target.value)} 
                                className="h-14 text-lg" 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs flex items-center gap-1">
                                {language === 'ar' ? 'المبلغ' : 'Fee'}
                                {!feeEditUnlocked && <Lock className="w-3 h-3 text-amber-500" />}
                              </Label>
                              <Input 
                                type="number" 
                                value={item.fee} 
                                onChange={(e) => updateItemFee(idx, e.target.value)} 
                                className={`h-8 text-sm ${!feeEditUnlocked ? 'bg-amber-50 border-amber-200' : ''}`}
                                onClick={() => !feeEditUnlocked && unlockFeeEdit()}
                              />
                            </div>
                            <div className="space-y-1 col-span-3">
                              <Label className="text-xs">{language === 'ar' ? 'جدول المواعيد' : 'Schedule'}</Label>
                              <Input 
                                value={item.schedule || ''} 
                                onChange={(e) => updateItemSchedule(idx, e.target.value)} 
                                className="h-8 text-sm" 
                                placeholder={language === 'ar' ? 'مثال: السبت والاثنين والأربعاء 4-5 مساءً' : 'e.g. Sat, Mon, Wed 4-5 PM'}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('payment_method')}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t('cash')}</SelectItem>
                    <SelectItem value="card">{t('card')}</SelectItem>
                    <SelectItem value="transfer">{t('transfer')}</SelectItem>
                    <SelectItem value="tabby">{language === 'ar' ? 'تابي' : 'Tabby'}</SelectItem>
                    <SelectItem value="tamara">{language === 'ar' ? 'تمارا' : 'Tamara'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Coupon Code Section */}
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
                        <p className="text-sm text-green-600">
                          {appliedCoupon.value} {t('sar')} {language === 'ar' ? 'خصم' : 'off'}
                        </p>
                      </div>
                    </div>
                    <span className="text-lg font-bold text-green-700">-{couponDiscount} {t('sar')}</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input 
                      value={couponCode} 
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())} 
                      placeholder={language === 'ar' ? 'أدخل كود الخصم...' : 'Enter coupon code...'}
                      className="flex-1"
                      data-testid="coupon-input"
                    />
                    <Button 
                      type="button"
                      onClick={validateCoupon} 
                      disabled={!couponCode.trim() || validatingCoupon || invoiceItems.length === 0}
                      variant="outline"
                      className="border-purple-400 text-purple-700 hover:bg-purple-100"
                      data-testid="apply-coupon-btn"
                    >
                      {validatingCoupon ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Percent className="w-4 h-4 me-1" />
                          {language === 'ar' ? 'تطبيق' : 'Apply'}
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </Card>

              <div className="space-y-2"><Label>{t('notes')}</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

              {invoiceItems.length > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex justify-between text-sm mb-2"><span>{t('subtotal')}</span><span>{subtotal.toFixed(2)} {t('sar')}</span></div>
                  <div className="flex justify-between text-sm mb-2 text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}</span><span>{vatAmount.toFixed(2)} {t('sar')}</span></div>
                  {couponDiscount > 0 && (
                    <div className="flex justify-between text-sm mb-2 text-purple-600">
                      <span className="flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        {language === 'ar' ? 'خصم الكوبون' : 'Coupon Discount'} ({appliedCoupon?.code})
                      </span>
                      <span>- {couponDiscount.toFixed(2)} {t('sar')}</span>
                    </div>
                  )}
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

        {/* Add New Member Dialog */}
        <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('add_member')}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{language === 'ar' ? 'اسم العضو *' : 'Name *'}</Label><Input value={newMemberData.name_ar} onChange={(e) => setNewMemberData({...newMemberData, name_ar: e.target.value})} required /></div>
                <div className="space-y-2"><Label>{t('phone')} *</Label><Input value={newMemberData.phone} onChange={(e) => setNewMemberData({...newMemberData, phone: e.target.value})} type="tel" dir="ltr" required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{language === 'ar' ? 'ولي الأمر' : 'Guardian'}</Label><Input value={newMemberData.guardian_name_ar} onChange={(e) => setNewMemberData({...newMemberData, guardian_name_ar: e.target.value})} /></div>
                <div className="space-y-2"><Label>{t('age')}</Label><Input value={newMemberData.age} onChange={(e) => setNewMemberData({...newMemberData, age: e.target.value})} type="number" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddMemberDialogOpen(false)}>{t('cancel')}</Button>
              <Button onClick={handleCreateMember} disabled={saving}>{saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Invoice Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-primary" />{t('invoice_number')}: #{selectedInvoice?.id.slice(0, 8)}</DialogTitle></DialogHeader>
            {selectedInvoice && (
              <div ref={printRef} className="p-4">
                <div className="flex justify-between items-start border-b-2 border-primary pb-4 mb-4">
                  <div>
                    <div className="text-lg font-bold text-blue-900">{COMPANY_INFO.name_ar}</div>
                    <div className="text-xs text-muted-foreground">{language === 'ar' ? 'الرقم الضريبي' : 'Tax No'}: {COMPANY_INFO.tax_number}<br/>{language === 'ar' ? 'السجل التجاري' : 'CR'}: {COMPANY_INFO.commercial_reg}</div>
                    {/* Branch Name */}
                    <div className="mt-2 text-sm font-semibold text-orange-600 bg-orange-50 px-2 py-1 rounded inline-block">
                      🏢 {language === 'ar' ? 'الفرع:' : 'Branch:'} {getBranchName(selectedInvoice.branch_id)}
                    </div>
                  </div>
                  <div className="text-sm text-end">
                    <p><strong>{t('invoice_number')}:</strong> #{selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8)}</p>
                    <p><strong>{t('invoice_date')}:</strong> {new Date(selectedInvoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</p>
                    <div className="mt-2">{getStatusBadge(selectedInvoice.status)}</div>
                  </div>
                </div>

                <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-2 text-blue-900">{language === 'ar' ? 'بيانات العميل' : 'Customer'}</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p><strong>{language === 'ar' ? 'الاسم' : 'Name'}:</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name}</p>
                    <p><strong>{t('phone')}:</strong> <span dir="ltr">{selectedInvoice.customer_phone || '-'}</span></p>
                    {selectedInvoice.customer_address && <p className="col-span-2"><strong>{language === 'ar' ? 'العنوان' : 'Address'}:</strong> {selectedInvoice.customer_address}</p>}
                  </div>
                </div>

                <table className="w-full border-collapse mb-4">
                  <thead><tr className="bg-muted"><th className="border p-2 text-start">{t('activity_name')}</th><th className="border p-2 text-start">{language === 'ar' ? 'الفترة' : 'Period'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المواعيد' : 'Schedule'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th></tr></thead>
                  <tbody>{selectedInvoice.items.map((item, idx) => <tr key={idx}><td className="border p-2">{item.activity_name}</td><td className="border p-2 text-sm">{item.period}</td><td className="border p-2 text-sm text-blue-700 schedule-cell font-medium">{item.schedule || '-'}</td><td className="border p-2">{item.fee} {t('sar')}</td></tr>)}</tbody>
                </table>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b"><span>{t('subtotal')}:</span><span>{selectedInvoice.subtotal} {t('sar')}</span></div>
                  {selectedInvoice.discount > 0 && <div className="flex justify-between py-1 border-b text-muted-foreground"><span>{t('discount')}:</span><span>- {selectedInvoice.discount} {t('sar')}</span></div>}
                  <div className="flex justify-between py-1 border-b text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}:</span><span>{selectedInvoice.vat_amount || 0} {t('sar')}</span></div>
                  <div className="flex justify-between py-2 text-xl font-bold text-primary border-t-2 border-blue-900"><span>{t('total')}:</span><span>{selectedInvoice.total} {t('sar')}</span></div>
                </div>

                {/* Payment Info */}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>{language === 'ar' ? 'طريقة الدفع:' : 'Payment Method:'}</strong> {
                      selectedInvoice.payment_method === 'cash' ? (language === 'ar' ? 'نقداً' : 'Cash') : 
                      selectedInvoice.payment_method === 'card' ? (language === 'ar' ? 'بطاقة' : 'Card') : 
                      selectedInvoice.payment_method === 'transfer' ? (language === 'ar' ? 'تحويل بنكي' : 'Transfer') : 
                      selectedInvoice.payment_method === 'tabby' ? (language === 'ar' ? 'تابي' : 'Tabby') : 
                      selectedInvoice.payment_method === 'tamara' ? (language === 'ar' ? 'تمارا' : 'Tamara') : 
                      selectedInvoice.payment_method
                    }</div>
                    <div><strong>{language === 'ar' ? 'الحالة:' : 'Status:'}</strong> {selectedInvoice.status === 'paid' ? (language === 'ar' ? '✅ مدفوعة' : '✅ Paid') : selectedInvoice.status === 'pending' ? (language === 'ar' ? '⏳ غير مدفوعة' : '⏳ Pending') : (language === 'ar' ? '❌ ملغاة' : '❌ Cancelled')}</div>
                    {selectedInvoice.supervisor_name && (
                      <div className="col-span-2 mt-2 pt-2 border-t border-blue-200"><strong>{language === 'ar' ? '👤 مشرف الفاتورة:' : '👤 Invoice Supervisor:'}</strong> {selectedInvoice.supervisor_name}</div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                {selectedInvoice.notes && (
                  <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-sm"><strong>{language === 'ar' ? 'ملاحظات:' : 'Notes:'}</strong> {selectedInvoice.notes}</p>
                  </div>
                )}

                {selectedInvoice?.status === 'paid' && qrCode && <div className="qr-code text-center mt-4 pt-4 border-t"><p className="text-xs text-muted-foreground mb-2">{language === 'ar' ? 'رمز QR للفاتورة الإلكترونية' : 'E-Invoice QR Code'}</p><img src={qrCode} alt="QR Code" className="w-20 h-20 mx-auto" /></div>}

                {/* Invoice Terms */}
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs font-bold text-amber-800 mb-2">{language === 'ar' ? '⚠️ شروط وأحكام:' : '⚠️ Terms & Conditions:'}</p>
                  <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                    {(language === 'ar' ? INVOICE_TERMS.ar : INVOICE_TERMS.en).map((term, idx) => (
                      <li key={idx}>{term}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
                  <p>{COMPANY_INFO.name_ar} | {COMPANY_INFO.name_en}</p>
                  <p className="mt-1 font-semibold text-orange-600">🏢 {getBranchName(selectedInvoice.branch_id)}</p>
                  <div className="flex justify-center gap-6 mt-2"><span>{language === 'ar' ? 'الرقم الضريبي' : 'Tax Number'}: {COMPANY_INFO.tax_number}</span><span>{language === 'ar' ? 'السجل التجاري' : 'Commercial Reg'}: {COMPANY_INFO.commercial_reg}</span></div>
                </div>
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>{t('close')}</Button>
              <Button variant="outline" onClick={handleShareWhatsApp} className="bg-green-50 border-green-400 text-green-700 hover:bg-green-100">
                <MessageSquare className="w-4 h-4 me-2" />
                {language === 'ar' ? 'مشاركة واتساب' : 'Share WhatsApp'}
              </Button>
              <Button variant="outline" onClick={handleSaveAsPdfOnly} disabled={savingPdf} className="bg-blue-50 border-blue-400 text-blue-700 hover:bg-blue-100">
                {savingPdf ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <FileText className="w-4 h-4 me-2" />}
                {language === 'ar' ? 'حفظ PDF' : 'Save PDF'}
              </Button>
              <Button variant="outline" onClick={handleSaveAsPdf} disabled={savingPdf} className="bg-red-50 border-red-400 text-red-700 hover:bg-red-100">
                {savingPdf ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <FileText className="w-4 h-4 me-2" />}
                {language === 'ar' ? 'PDF + واتساب' : 'PDF + WhatsApp'}
              </Button>
              <Button variant="outline" onClick={handlePrintRegistrationForm} className="bg-gray-800 border-gray-700 text-white hover:bg-gray-900">
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'استمارة تسجيل' : 'Registration Form'}
              </Button>
              <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 me-2" />{t('print')}</Button>
              {selectedInvoice?.status === 'pending' && <Button variant="outline" className="text-blue-600 border-blue-300" onClick={() => openEditDialog(selectedInvoice)}><Edit className="w-4 h-4 me-2" />{language === 'ar' ? 'تعديل' : 'Edit'}</Button>}
              {selectedInvoice?.status === 'cancelled' && <Button variant="outline" onClick={() => handleRestoreInvoice(selectedInvoice.id)}><RotateCcw className="w-4 h-4 me-2" />{language === 'ar' ? 'استرجاع الفاتورة' : 'Restore'}</Button>}
              {selectedInvoice?.status === 'paid' && <Button variant="outline" className="text-purple-600 border-purple-300" onClick={() => { setIsViewDialogOpen(false); openRefundDialog(selectedInvoice); }}><RefreshCcw className="w-4 h-4 me-2" />{language === 'ar' ? 'استرجاع مبلغ' : 'Refund'}</Button>}
              {selectedInvoice?.status === 'pending' && <Button onClick={() => handleMarkPaid(selectedInvoice.id)}><CheckCircle className="w-4 h-4 me-2" />{language === 'ar' ? 'تم الدفع' : 'Mark Paid'}</Button>}
              {isAdmin && <Button variant="destructive" onClick={() => handleDeleteInvoice(selectedInvoice?.id, selectedInvoice?.status)}><Trash2 className="w-4 h-4 me-2" />{language === 'ar' ? 'حذف' : 'Delete'}</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Refund Dialog */}
        <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCcw className="w-5 h-5 text-purple-600" />
                {language === 'ar' ? 'استرجاع مبلغ' : 'Refund Invoice'}
              </DialogTitle>
            </DialogHeader>
            {selectedInvoice && (
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm"><strong>{language === 'ar' ? 'رقم الفاتورة:' : 'Invoice #:'}</strong> #{selectedInvoice.invoice_number || selectedInvoice.id.slice(0, 8)}</p>
                  <p className="text-sm"><strong>{language === 'ar' ? 'العميل:' : 'Customer:'}</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name}</p>
                  <p className="text-sm"><strong>{language === 'ar' ? 'المبلغ الكلي:' : 'Total Amount:'}</strong> {selectedInvoice.total} {t('sar')}</p>
                </div>

                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'نوع الاسترجاع' : 'Refund Type'}</Label>
                  <Select value={refundType} onValueChange={(val) => {
                    setRefundType(val);
                    if (val === 'full') setRefundAmount(selectedInvoice.total);
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">{language === 'ar' ? 'استرجاع كامل' : 'Full Refund'}</SelectItem>
                      <SelectItem value="partial">{language === 'ar' ? 'استرجاع جزئي' : 'Partial Refund'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {refundType === 'partial' && (
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'مبلغ الاسترجاع (ر.س)' : 'Refund Amount (SAR)'}</Label>
                    <Input 
                      type="number" 
                      value={refundAmount} 
                      onChange={(e) => setRefundAmount(e.target.value)}
                      max={selectedInvoice.total}
                      min="0"
                      step="0.01"
                    />
                    <p className="text-xs text-muted-foreground">
                      {language === 'ar' ? `الحد الأقصى: ${selectedInvoice.total} ر.س` : `Max: ${selectedInvoice.total} SAR`}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'سبب الاسترجاع (اختياري)' : 'Refund Reason (optional)'}</Label>
                  <Textarea 
                    value={refundReason} 
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder={language === 'ar' ? 'أدخل سبب الاسترجاع...' : 'Enter refund reason...'}
                  />
                </div>

                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-sm font-semibold text-purple-800">
                    {language === 'ar' ? 'مبلغ الاسترجاع:' : 'Refund Amount:'} {refundType === 'full' ? selectedInvoice.total : refundAmount} {t('sar')}
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRefundDialogOpen(false)}>{t('cancel')}</Button>
              <Button onClick={handleRefund} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                <RefreshCcw className="w-4 h-4 me-2" />
                {language === 'ar' ? 'تأكيد الاسترجاع' : 'Confirm Refund'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Registration Form Dialog */}
        <Dialog open={isRegistrationFormDialogOpen} onOpenChange={setIsRegistrationFormDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {language === 'ar' ? 'إنشاء استمارة تسجيل' : 'Create Registration Form'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Customer Info with Member Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'اسم المشترك *' : 'Customer Name *'}</Label>
                  <div className="flex gap-2">
                    <Select onValueChange={(val) => {
                      if (val === 'new') {
                        setAddMemberSource('registration');
                        setIsAddMemberDialogOpen(true);
                      } else {
                        const member = members.find(m => m.id === val);
                        if (member) {
                          setRegFormData({
                            ...regFormData,
                            customer_name: member.name_ar || member.name,
                            customer_phone: member.phone || ''
                          });
                        }
                      }
                    }}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={regFormData.customer_name || (language === 'ar' ? 'اختر عضو...' : 'Select member...')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new" className="text-primary font-semibold">
                          <span className="flex items-center gap-2">
                            <Plus className="w-4 h-4" />
                            {language === 'ar' ? '+ إضافة عضو جديد' : '+ Add New Member'}
                          </span>
                        </SelectItem>
                        {members.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name_ar || m.name} - {m.phone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t('phone')} *</Label>
                  <Input 
                    value={regFormData.customer_phone} 
                    onChange={(e) => setRegFormData({...regFormData, customer_phone: e.target.value})}
                    type="tel" 
                    dir="ltr"
                    placeholder="05xxxxxxxx"
                  />
                </div>
              </div>

              {/* Item Type Selection */}
              <div className="flex gap-2">
                <Button 
                  variant={regFormItemType === 'activity' ? 'default' : 'outline'} 
                  size="sm"
                  onClick={() => setRegFormItemType('activity')}
                >
                  {language === 'ar' ? 'نشاط' : 'Activity'}
                </Button>
                <Button 
                  variant={regFormItemType === 'product' ? 'default' : 'outline'} 
                  size="sm"
                  onClick={() => setRegFormItemType('product')}
                >
                  {language === 'ar' ? 'منتج' : 'Product'}
                </Button>
              </div>

              {/* Activities Selection */}
              {regFormItemType === 'activity' && (
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'إضافة نشاط' : 'Add Activity'}</Label>
                  <Select onValueChange={(val) => {
                    const activity = activities.find(a => a.id === val);
                    if (activity) addActivityToRegForm(activity);
                  }}>
                    <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر نشاط...' : 'Select activity...'} /></SelectTrigger>
                    <SelectContent>
                      {activities.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {language === 'ar' ? a.name_ar : a.name} - {a.fee} {t('sar')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Products Selection */}
              {regFormItemType === 'product' && (
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'إضافة منتج من المخزن' : 'Add Product'}</Label>
                  <Select onValueChange={(val) => {
                    const product = products.find(p => p.id === val);
                    if (product) addProductToRegForm(product);
                  }}>
                    <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر منتج...' : 'Select product...'} /></SelectTrigger>
                    <SelectContent>
                      {products.filter(p => p.quantity > 0).map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} - {p.price} {t('sar')} ({language === 'ar' ? `متوفر: ${p.quantity}` : `Stock: ${p.quantity}`})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Selected Items */}
              {regFormItems.length > 0 && (
                <div className="border rounded-lg p-3 space-y-3">
                  <Label>{language === 'ar' ? 'العناصر المختارة' : 'Selected Items'}</Label>
                  {regFormItems.map((item, idx) => (
                    <div key={idx} className="bg-muted/50 p-3 rounded-lg space-y-2">
                      {/* Row 1: Name and Delete */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.activity_name}</span>
                          {item.is_product && <Badge variant="outline" className="text-xs">{language === 'ar' ? 'منتج' : 'Product'}</Badge>}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => removeActivityFromRegForm(idx)}>
                          <X className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                      
                      {/* Row 2: Dates and Price */}
                      <div className="grid grid-cols-3 gap-2">
                        {item.is_product ? (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
                              <Input 
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => {
                                  const updated = [...regFormItems];
                                  updated[idx].quantity = parseInt(e.target.value) || 1;
                                  setRegFormItems(updated);
                                }}
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'السعر' : 'Price'}</Label>
                              <Input 
                                type="number"
                                value={item.fee}
                                onChange={(e) => {
                                  const updated = [...regFormItems];
                                  updated[idx].fee = parseFloat(e.target.value) || 0;
                                  setRegFormItems(updated);
                                }}
                                className="text-sm"
                              />
                            </div>
                            <div className="flex items-end">
                              <span className="text-sm font-semibold text-primary pb-2">
                                {((item.fee || 0) * (item.quantity || 1)).toFixed(2)} {t('sar')}
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                              <Input 
                                type="date"
                                value={item.start_date || ''}
                                onChange={(e) => {
                                  const updated = [...regFormItems];
                                  updated[idx].start_date = e.target.value;
                                  // Update period
                                  if (updated[idx].end_date) {
                                    updated[idx].period = `${e.target.value} - ${updated[idx].end_date}`;
                                  }
                                  setRegFormItems(updated);
                                }}
                                className="h-14 text-lg"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                              <Input 
                                type="date"
                                value={item.end_date || ''}
                                onChange={(e) => {
                                  const updated = [...regFormItems];
                                  updated[idx].end_date = e.target.value;
                                  // Update period
                                  if (updated[idx].start_date) {
                                    updated[idx].period = `${updated[idx].start_date} - ${e.target.value}`;
                                  }
                                  setRegFormItems(updated);
                                }}
                                className="h-14 text-lg"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'السعر' : 'Price'}</Label>
                              <Input 
                                type="number"
                                value={item.fee}
                                onChange={(e) => {
                                  const updated = [...regFormItems];
                                  updated[idx].fee = parseFloat(e.target.value) || 0;
                                  setRegFormItems(updated);
                                }}
                                className="text-sm"
                              />
                            </div>
                          </>
                        )}
                      </div>
                      
                      {/* Row 3: Schedule (separate line for activities) */}
                      {!item.is_product && (
                        <div className="space-y-1">
                          <Label className="text-xs">{language === 'ar' ? 'المواعيد' : 'Schedule'}</Label>
                          <Input 
                            placeholder={language === 'ar' ? 'مثال: السبت والاثنين 4-5 مساءً' : 'e.g., Sat & Mon 4-5 PM'}
                            value={item.schedule}
                            onChange={(e) => {
                              const updated = [...regFormItems];
                              updated[idx].schedule = e.target.value;
                              setRegFormItems(updated);
                            }}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Payment Method */}
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
                <Select value={regFormPaymentMethod} onValueChange={setRegFormPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                    <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                    <SelectItem value="transfer">{language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer'}</SelectItem>
                    <SelectItem value="tabby">{language === 'ar' ? 'تابي' : 'Tabby'}</SelectItem>
                    <SelectItem value="tamara">{language === 'ar' ? 'تمارا' : 'Tamara'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Coupon Code */}
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'كود الخصم' : 'Discount Code'}</Label>
                <div className="flex gap-2">
                  <Input 
                    value={regFormCouponCode}
                    onChange={(e) => setRegFormCouponCode(e.target.value)}
                    placeholder={language === 'ar' ? 'أدخل كود الخصم' : 'Enter coupon code'}
                    disabled={regFormAppliedCoupon}
                  />
                  {!regFormAppliedCoupon ? (
                    <Button variant="outline" onClick={validateRegFormCoupon} disabled={!regFormCouponCode.trim()}>
                      {language === 'ar' ? 'تطبيق' : 'Apply'}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => {
                      setRegFormAppliedCoupon(null);
                      setRegFormCouponCode('');
                      setRegFormCouponDiscount(0);
                    }}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {regFormAppliedCoupon && (
                  <p className="text-sm text-green-600">
                    ✅ {language === 'ar' ? `تم تطبيق الكوبون: ${regFormAppliedCoupon.code}` : `Coupon applied: ${regFormAppliedCoupon.code}`}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                <Textarea 
                  value={regFormNotes}
                  onChange={(e) => setRegFormNotes(e.target.value)}
                  placeholder={language === 'ar' ? 'أدخل ملاحظات...' : 'Enter notes...'}
                  rows={2}
                />
              </div>

              {/* Totals */}
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
                    <p className="text-xs text-muted-foreground text-center">{language === 'ar' ? '* الأسعار لا تشمل ضريبة القيمة المضافة' : '* Prices exclude VAT'}</p>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={closeRegistrationFormDialog}>{t('cancel')}</Button>
              <Button 
                variant="outline"
                onClick={handleSaveRegistrationFormOnly} 
                disabled={!regFormData.customer_name || regFormItems.length === 0}
                className="bg-teal-50 border-teal-400 text-teal-700 hover:bg-teal-100"
              >
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'حفظ الاستمارة' : 'Save Form'}
              </Button>
              <Button 
                onClick={handlePrintNewRegistrationForm} 
                disabled={!regFormData.customer_name || regFormItems.length === 0}
                className="bg-gray-800 hover:bg-gray-900"
              >
                <Printer className="w-4 h-4 me-2" />
                {language === 'ar' ? 'حفظ وطباعة' : 'Save & Print'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Registration Form Dialog */}
        <Dialog open={isViewRegFormDialogOpen} onOpenChange={setIsViewRegFormDialogOpen}>
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
                {/* Customer Info */}
                <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg">
                  <h4 className="font-semibold text-teal-800 mb-2">{language === 'ar' ? '👤 بيانات المشترك' : '👤 Customer Info'}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>{language === 'ar' ? 'الاسم:' : 'Name:'}</strong> {selectedRegForm.customer_name}</div>
                    <div><strong>{language === 'ar' ? 'الجوال:' : 'Phone:'}</strong> <span dir="ltr">{selectedRegForm.customer_phone || '-'}</span></div>
                    <div><strong>{language === 'ar' ? 'التاريخ:' : 'Date:'}</strong> {new Date(selectedRegForm.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</div>
                    <div><strong>{language === 'ar' ? 'الحالة:' : 'Status:'}</strong> 
                      <Badge variant="outline" className={`ms-2 ${
                        selectedRegForm.status === 'converted' ? 'bg-green-100 text-green-700' :
                        selectedRegForm.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {selectedRegForm.status === 'converted' ? (language === 'ar' ? 'تم تحويلها' : 'Converted') :
                         selectedRegForm.status === 'cancelled' ? (language === 'ar' ? 'ملغاة' : 'Cancelled') :
                         (language === 'ar' ? 'قيد الانتظار' : 'Pending')}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Items */}
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

                {/* Totals */}
                <div className="p-4 bg-gray-50 border rounded-lg space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{language === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span>{selectedRegForm.subtotal?.toFixed(2)} {t('sar')}</span>
                  </div>
                  {selectedRegForm.discount > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>{language === 'ar' ? 'الخصم:' : 'Discount:'}</span>
                      <span>- {selectedRegForm.discount?.toFixed(2)} {t('sar')}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg text-primary pt-2 border-t">
                    <span>{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                    <span>{selectedRegForm.total?.toFixed(2)} {t('sar')}</span>
                  </div>
                </div>

                {/* Payment & Notes */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <strong>{language === 'ar' ? '💳 طريقة الدفع:' : '💳 Payment:'}</strong> {
                      selectedRegForm.payment_method === 'cash' ? (language === 'ar' ? 'نقداً' : 'Cash') :
                      selectedRegForm.payment_method === 'card' ? (language === 'ar' ? 'بطاقة' : 'Card') :
                      selectedRegForm.payment_method === 'transfer' ? (language === 'ar' ? 'تحويل' : 'Transfer') :
                      selectedRegForm.payment_method
                    }
                  </div>
                  {selectedRegForm.notes && (
                    <div className="p-3 bg-gray-100 border rounded-lg">
                      <strong>{language === 'ar' ? '📝 ملاحظات:' : '📝 Notes:'}</strong> {selectedRegForm.notes}
                    </div>
                  )}
                </div>
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={() => setIsViewRegFormDialogOpen(false)}>{t('close')}</Button>
              <Button variant="outline" onClick={() => handleSaveRegFormPdf(selectedRegForm)} className="text-teal-600 border-teal-300">
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'حفظ PDF' : 'Save PDF'}
              </Button>
              {selectedRegForm?.status === 'pending' && (
                <>
                  <Button variant="outline" onClick={() => { setIsViewRegFormDialogOpen(false); handleEditRegForm(selectedRegForm); }} className="text-orange-600 border-orange-300">
                    <Edit className="w-4 h-4 me-2" />
                    {language === 'ar' ? 'تعديل' : 'Edit'}
                  </Button>
                  <Button onClick={() => { setIsViewRegFormDialogOpen(false); handleConvertFormToInvoice(selectedRegForm.id); }} className="bg-blue-600 hover:bg-blue-700">
                    <ArrowRightCircle className="w-4 h-4 me-2" />
                    {language === 'ar' ? 'تحويل إلى فاتورة' : 'Convert to Invoice'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Registration Form Dialog */}
        <Dialog open={isEditRegFormDialogOpen} onOpenChange={(open) => { if (!open) closeEditRegFormDialog(); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5 text-orange-600" />
                {language === 'ar' ? 'تعديل استمارة التسجيل' : 'Edit Registration Form'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Customer Data */}
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

              {/* Add Items */}
              <div className="flex gap-2 p-2 bg-muted rounded-lg">
                <Button
                  type="button"
                  variant={regFormItemType === 'activity' ? 'default' : 'outline'}
                  onClick={() => setRegFormItemType('activity')}
                  className="flex-1"
                  size="sm"
                >
                  {language === 'ar' ? 'نشاط' : 'Activity'}
                </Button>
                <Button
                  type="button"
                  variant={regFormItemType === 'product' ? 'default' : 'outline'}
                  onClick={() => setRegFormItemType('product')}
                  className="flex-1"
                  size="sm"
                >
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
                    {regFormItemType === 'activity' ? 
                      activities.map(a => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name} - {a.monthly_fee} {t('sar')}</SelectItem>) :
                      products.map(p => <SelectItem key={p.id} value={p.id}>{p.name_ar || p.name} - {p.price} {t('sar')}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>

              {/* Items List */}
              {regFormItems.length > 0 && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-lg p-2">
                  {regFormItems.map((item, idx) => (
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

              {/* Payment Method */}
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

              {/* Notes */}
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                <Textarea 
                  value={regFormNotes}
                  onChange={(e) => setRegFormNotes(e.target.value)}
                  placeholder={language === 'ar' ? 'أدخل ملاحظات...' : 'Enter notes...'}
                  rows={2}
                />
              </div>

              {/* Totals */}
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
              <Button 
                onClick={handleSaveEditedRegForm} 
                disabled={!regFormData.customer_name || regFormItems.length === 0}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* View Credit Note Dialog */}
        <Dialog open={isViewCreditNoteDialogOpen} onOpenChange={setIsViewCreditNoteDialogOpen}>
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
                {/* Credit Note Info */}
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h4 className="font-semibold text-red-800 mb-2">{language === 'ar' ? '📋 بيانات إشعار الدائن' : '📋 Credit Note Info'}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>{language === 'ar' ? 'رقم الإشعار:' : 'Credit Note #:'}</strong> <span className="text-red-600 font-bold">{selectedCreditNote.credit_note_number}</span></div>
                    <div><strong>{language === 'ar' ? 'التاريخ:' : 'Date:'}</strong> {new Date(selectedCreditNote.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</div>
                    <div><strong>{language === 'ar' ? 'الفاتورة الأصلية:' : 'Original Invoice:'}</strong> <Badge variant="outline">{selectedCreditNote.original_invoice_number}</Badge></div>
                    <div><strong>{language === 'ar' ? 'المحرر:' : 'Created By:'}</strong> {selectedCreditNote.created_by || '-'}</div>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="p-4 bg-gray-50 border rounded-lg">
                  <h4 className="font-semibold mb-2">{language === 'ar' ? '👤 بيانات العميل' : '👤 Customer Info'}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>{language === 'ar' ? 'الاسم:' : 'Name:'}</strong> {selectedCreditNote.customer_name_ar}</div>
                    <div><strong>{language === 'ar' ? 'الجوال:' : 'Phone:'}</strong> <span dir="ltr">{selectedCreditNote.customer_phone || '-'}</span></div>
                  </div>
                </div>

                {/* Items */}
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

                {/* Totals */}
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{language === 'ar' ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span>- {selectedCreditNote.subtotal?.toFixed(2)} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>{language === 'ar' ? 'ضريبة القيمة المضافة (15%):' : 'VAT (15%):'}</span>
                    <span>- {selectedCreditNote.vat_amount?.toFixed(2)} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg text-red-600 pt-2 border-t border-red-200">
                    <span>{language === 'ar' ? '💰 إجمالي المرتجع:' : '💰 Total Refund:'}</span>
                    <span>- {selectedCreditNote.refund_amount?.toFixed(2)} {t('sar')}</span>
                  </div>
                </div>

                {/* Reason & Notes */}
                {selectedCreditNote.reason && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <strong>{language === 'ar' ? '📌 سبب المرتجع:' : '📌 Refund Reason:'}</strong> {selectedCreditNote.reason}
                  </div>
                )}
                {selectedCreditNote.notes && (
                  <div className="p-3 bg-gray-100 border rounded-lg">
                    <strong>{language === 'ar' ? '📝 ملاحظات:' : '📝 Notes:'}</strong> {selectedCreditNote.notes}
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsViewCreditNoteDialogOpen(false)}>{t('close')}</Button>
              <Button onClick={() => handlePrintCreditNote(selectedCreditNote)} className="bg-red-600 hover:bg-red-700">
                <Printer className="w-4 h-4 me-2" />
                {language === 'ar' ? 'طباعة' : 'Print'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default InvoicesPage;
