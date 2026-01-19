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
import { invoicesAPI, membersAPI, activitiesAPI, exportAPI, productsAPI, discountsAPI } from '../services/api';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import { 
  Plus, Search, Eye, Printer, Loader2, Receipt, CheckCircle, XCircle, Clock,
  Filter, MessageSquare, X, UserPlus, Trash2, RotateCcw, FileSpreadsheet, Image, Share2, RefreshCcw, Edit, FileText, Package, Percent, Tag
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
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [invoices, setInvoices] = useState([]);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterActivity, setFilterActivity] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
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
  }, []);

  const loadData = async () => {
    try {
      const [invoicesRes, membersRes, activitiesRes, productsRes] = await Promise.all([
        invoicesAPI.getAll(), membersAPI.getAll(), activitiesAPI.getAll(), productsAPI.getAll()
      ]);
      setInvoices(invoicesRes.data);
      setMembers(membersRes.data);
      setActivities(activitiesRes.data);
      setProducts(productsRes.data);
    } catch (error) {
      toast.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const handleMemberSelect = (memberId) => {
    if (memberId === 'new') { setIsAddMemberDialogOpen(true); return; }
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
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
    if (subtotal === 0) {
      toast.error(language === 'ar' ? 'أضف عناصر أولاً' : 'Add items first');
      return;
    }
    setValidatingCoupon(true);
    try {
      const res = await discountsAPI.validate(couponCode, subtotal);
      setAppliedCoupon(res.data.discount);
      setCouponDiscount(res.data.discount_amount);
      toast.success(language === 'ar' ? `تم تطبيق الكوبون! خصم ${res.data.discount_amount} ر.س` : `Coupon applied! Discount ${res.data.discount_amount} SAR`);
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
    if (invoiceItems.find(item => item.activity_id === activityId)) {
      toast.error(language === 'ar' ? 'النشاط مضاف مسبقاً' : 'Activity already added');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const endDate = nextMonth.toISOString().split('T')[0];
    
    setInvoiceItems([...invoiceItems, {
      activity_id: activity.id,
      activity_name: language === 'ar' ? activity.name_ar : activity.name,
      fee: activity.monthly_fee,
      period: `${today} - ${endDate}`,
      start_date: today,
      end_date: endDate,
      schedule: '' // جدول المواعيد
    }]);
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

  const updateItemFee = (index, newFee) => {
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
    const afterDiscount = subtotal - (parseFloat(discount) || 0);
    const vatAmount = Math.round(afterDiscount * (COMPANY_INFO.vat_rate / 100) * 100) / 100;
    const total = Math.round((afterDiscount + vatAmount) * 100) / 100;
    return { subtotal, afterDiscount, vatAmount, total };
  };

  const handleCreateMember = async () => {
    if (!newMemberData.name_ar || !newMemberData.phone) {
      toast.error(language === 'ar' ? 'أدخل الاسم ورقم الجوال' : 'Enter name and phone');
      return;
    }
    setSaving(true);
    try {
      const response = await membersAPI.create({ ...newMemberData, age: parseInt(newMemberData.age) || 0, activities: [] });
      const membersRes = await membersAPI.getAll();
      setMembers(membersRes.data);
      setSelectedMember(response.data);
      setCustomerNameAr(response.data.name_ar);
      setCustomerPhone(response.data.phone);
      setIsAddMemberDialogOpen(false);
      setNewMemberData({ name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' });
      toast.success(t('success'));
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
    try {
      if (isEditMode && editingInvoiceId) {
        await invoicesAPI.update(editingInvoiceId, {
          member_id: selectedMember?.id || null,
          items: invoiceItems,
          discount: parseFloat(discount) || 0,
          notes, payment_method: paymentMethod,
          customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress
        });
        toast.success(language === 'ar' ? 'تم تحديث الفاتورة' : 'Invoice updated');
      } else {
        await invoicesAPI.create({
          member_id: selectedMember?.id || null,
          items: invoiceItems,
          discount: parseFloat(discount) || 0,
          notes, payment_method: paymentMethod,
          customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress
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

  // Save invoice as PDF and share via WhatsApp
  const handleSaveAsPdf = async () => {
    if (!printRef.current) return;
    setSavingPdf(true);
    try {
      const element = printRef.current;
      const opt = {
        margin: 10,
        filename: `invoice_${selectedInvoice.id.slice(0,8)}.pdf`,
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
      
      toast.success(language === 'ar' ? 'تم حفظ الفاتورة كـ PDF' : 'Invoice saved as PDF');
      
      // Open WhatsApp with message
      const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
      if (phone) {
        const message = `مرحباً،\n\nمرفق فاتورتكم رقم #${selectedInvoice.id.slice(0,8)} بمبلغ ${selectedInvoice.total} ر.س\n\nشكراً لكم،\nشركة اداء الابطال العالمية للرياضة`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
      }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ PDF' : 'Failed to save PDF');
    } finally {
      setSavingPdf(false);
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try { await invoicesAPI.pay(invoiceId); toast.success(t('success')); loadData(); } catch { toast.error(t('error')); }
  };

  const handleRestoreInvoice = async (invoiceId) => {
    try { await invoicesAPI.restore(invoiceId); toast.success(language === 'ar' ? 'تم استرجاع الفاتورة' : 'Invoice restored'); loadData(); } catch { toast.error(t('error')); }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    if (!isAdmin) {
      toast.error(language === 'ar' ? 'الحذف متاح للمدير فقط' : 'Delete is admin only');
      return;
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
      await invoicesAPI.refund(selectedInvoice.id, { amount, reason: refundReason, refund_type: refundType });
      toast.success(language === 'ar' ? `تم استرجاع ${amount} ر.س بنجاح` : `Refunded ${amount} SAR successfully`);
      setIsRefundDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في عملية الاسترجاع' : 'Refund failed');
    } finally {
      setSaving(false);
    }
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

  const { subtotal, vatAmount, total } = calculateTotals();

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
                <div className="space-y-2"><Label>{t('from')}</Label><Input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>{t('to')}</Label><Input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} /></div>
                <Button onClick={loadData}><Search className="w-4 h-4 me-2" />{t('search')}</Button>
                <Button variant="outline" onClick={() => { setSearchTerm(''); setFilterStatus('all'); setFilterActivity('all'); setFilterStartDate(''); setFilterEndDate(''); loadData(); }}><X className="w-4 h-4 me-2" />{language === 'ar' ? 'مسح' : 'Clear'}</Button>
              </div>
            </Card>
          )}
        </div>

        {/* Invoices Table */}
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
                    <td className="font-mono text-sm">#{invoice.id.slice(0, 8)}</td>
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
                          <button className="action-button text-red-600" onClick={() => handleDeleteInvoice(invoice.id)} title={language === 'ar' ? 'حذف' : 'Delete'}><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div></CardContent></Card>

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
                  <div className="space-y-2 sm:col-span-2"><Label>{language === 'ar' ? 'العنوان' : 'Address'}</Label><Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} /></div>
                </div>
              </Card>

              <div className="space-y-2"><Label>{language === 'ar' ? 'إضافة نشاط' : 'Add activity'}</Label>
                <Select onValueChange={addActivityToInvoice}><SelectTrigger><SelectValue placeholder={language === 'ar' ? 'اختر نشاط' : 'Select activity'} /></SelectTrigger>
                  <SelectContent>{activities.map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name} - {a.monthly_fee} {t('sar')}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {invoiceItems.length > 0 && (
                <div className="space-y-2"><Label>{language === 'ar' ? 'الأنشطة' : 'Items'}</Label>
                  <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                    {invoiceItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-background rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{item.activity_name}</p>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1"><Label className="text-xs">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
                            <Input type="date" value={item.start_date} onChange={(e) => updateItemDate(idx, 'start_date', e.target.value)} className="h-8 text-sm" /></div>
                          <div className="space-y-1"><Label className="text-xs">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
                            <Input type="date" value={item.end_date} onChange={(e) => updateItemDate(idx, 'end_date', e.target.value)} className="h-8 text-sm" /></div>
                          <div className="space-y-1"><Label className="text-xs">{language === 'ar' ? 'المبلغ' : 'Fee'}</Label>
                            <Input type="number" value={item.fee} onChange={(e) => updateItemFee(idx, e.target.value)} className="h-8 text-sm" /></div>
                          <div className="space-y-1 col-span-2"><Label className="text-xs">{language === 'ar' ? 'جدول المواعيد' : 'Schedule'}</Label>
                            <Input 
                              value={item.schedule || ''} 
                              onChange={(e) => updateItemSchedule(idx, e.target.value)} 
                              className="h-8 text-sm" 
                              placeholder={language === 'ar' ? 'مثال: السبت والاثنين والأربعاء 4-5 مساءً' : 'e.g. Sat, Mon, Wed 4-5 PM'}
                            /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>{t('discount')} ({t('sar')})</Label><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} min="0" /></div>
                <div className="space-y-2"><Label>{t('payment_method')}</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t('cash')}</SelectItem>
                      <SelectItem value="card">{t('card')}</SelectItem>
                      <SelectItem value="transfer">{t('transfer')}</SelectItem>
                      <SelectItem value="tabby">{language === 'ar' ? 'تابي' : 'Tabby'}</SelectItem>
                      <SelectItem value="tamara">{language === 'ar' ? 'تمارا' : 'Tamara'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2"><Label>{t('notes')}</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

              {invoiceItems.length > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex justify-between text-sm mb-2"><span>{t('subtotal')}</span><span>{subtotal.toFixed(2)} {t('sar')}</span></div>
                  {discount > 0 && <div className="flex justify-between text-sm mb-2 text-muted-foreground"><span>{t('discount')}</span><span>- {parseFloat(discount).toFixed(2)} {t('sar')}</span></div>}
                  <div className="flex justify-between text-sm mb-2 text-green-600"><span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}</span><span>{vatAmount.toFixed(2)} {t('sar')}</span></div>
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
                  </div>
                  <div className="text-sm text-end">
                    <p><strong>{t('invoice_number')}:</strong> #{selectedInvoice.id.slice(0, 8)}</p>
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
                  <div className="flex justify-center gap-6 mt-2"><span>{language === 'ar' ? 'الرقم الضريبي' : 'Tax Number'}: {COMPANY_INFO.tax_number}</span><span>{language === 'ar' ? 'السجل التجاري' : 'Commercial Reg'}: {COMPANY_INFO.commercial_reg}</span></div>
                </div>
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>{t('close')}</Button>
              <Button variant="outline" onClick={handleSaveAsPdf} disabled={savingPdf} className="bg-red-50 border-red-400 text-red-700 hover:bg-red-100">
                {savingPdf ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <FileText className="w-4 h-4 me-2" />}
                {language === 'ar' ? 'حفظ PDF ومشاركة' : 'Save PDF & Share'}
              </Button>
              <Button variant="outline" onClick={handleSaveAsImage} disabled={savingImage} className="bg-green-50 border-green-500 text-green-700 hover:bg-green-100">
                {savingImage ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Share2 className="w-4 h-4 me-2" />}
                {language === 'ar' ? 'حفظ صورة' : 'Save Image'}
              </Button>
              <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 me-2" />{t('print')}</Button>
              {selectedInvoice?.status === 'pending' && <Button variant="outline" className="text-blue-600 border-blue-300" onClick={() => openEditDialog(selectedInvoice)}><Edit className="w-4 h-4 me-2" />{language === 'ar' ? 'تعديل' : 'Edit'}</Button>}
              {selectedInvoice?.status === 'cancelled' && <Button variant="outline" onClick={() => handleRestoreInvoice(selectedInvoice.id)}><RotateCcw className="w-4 h-4 me-2" />{language === 'ar' ? 'استرجاع الفاتورة' : 'Restore'}</Button>}
              {selectedInvoice?.status === 'paid' && <Button variant="outline" className="text-purple-600 border-purple-300" onClick={() => { setIsViewDialogOpen(false); openRefundDialog(selectedInvoice); }}><RefreshCcw className="w-4 h-4 me-2" />{language === 'ar' ? 'استرجاع مبلغ' : 'Refund'}</Button>}
              {selectedInvoice?.status === 'pending' && <Button onClick={() => handleMarkPaid(selectedInvoice.id)}><CheckCircle className="w-4 h-4 me-2" />{language === 'ar' ? 'تم الدفع' : 'Mark Paid'}</Button>}
              {isAdmin && <Button variant="destructive" onClick={() => handleDeleteInvoice(selectedInvoice?.id)}><Trash2 className="w-4 h-4 me-2" />{language === 'ar' ? 'حذف' : 'Delete'}</Button>}
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
                  <p className="text-sm"><strong>{language === 'ar' ? 'رقم الفاتورة:' : 'Invoice #:'}</strong> #{selectedInvoice.id.slice(0, 8)}</p>
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
      </div>
    </Layout>
  );
};

export default InvoicesPage;
