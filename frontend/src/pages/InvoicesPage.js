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
import { invoicesAPI, membersAPI, activitiesAPI, exportAPI, productsAPI, discountsAPI, branchesAPI, registrationFormsAPI, creditNotesAPI, levelsAPI } from '../services/api';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import { 
  Plus, Search, Eye, Printer, Loader2, Receipt, CheckCircle, XCircle, Clock,
  Filter, MessageSquare, X, UserPlus, Users, Trash2, RotateCcw, FileSpreadsheet, Image, Share2, RefreshCcw, Edit, FileText, Package, Percent, Tag, Lock, ClipboardList, ArrowRightCircle, CreditCard, QrCode, Check
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { COMPANY_INFO, INVOICE_TERMS, getStatusInfo, getPaymentMethodLabel, formatSchedule } from './invoices/constants';
import StickerPrintDialog from './invoices/StickerPrintDialog';
import { printMemberCard } from './invoices/printUtils';

export const InvoicesPage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [invoices, setInvoices] = useState([]);
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  const [branches, setBranches] = useState([]);
  const [levels, setLevels] = useState([]);
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
  
  // Member card print states
  const [showCardPrintDialog, setShowCardPrintDialog] = useState(false);
  const [cardPrintMember, setCardPrintMember] = useState(null);
  
  // Registration Form card print states
  const [showRegFormCardPrintDialog, setShowRegFormCardPrintDialog] = useState(false);
  const [regFormCardData, setRegFormCardData] = useState(null);
  
  const [checkedInvoices, setCheckedInvoices] = useState({});
  const [checkedRegForms, setCheckedRegForms] = useState({});

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
  
  // QR Card Modal state
  const [isQRCardDialogOpen, setIsQRCardDialogOpen] = useState(false);
  const [qrCardMember, setQrCardMember] = useState(null);
  const [qrCardSubscription, setQrCardSubscription] = useState(null); // For showing subscription details after invoice creation
  
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
  const [regFormAdditionalMembers, setRegFormAdditionalMembers] = useState([]);
  const [regFormAdditionalMemberNewForm, setRegFormAdditionalMemberNewForm] = useState({ show: false, index: -1, data: { name_ar: '' } });
  
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

  const [additionalMembers, setAdditionalMembers] = useState([]);
  const [additionalMemberNewForm, setAdditionalMemberNewForm] = useState({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
  
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
      const [invoicesRes, membersRes, activitiesRes, productsRes, branchesRes, regFormsRes, creditNotesRes, levelsRes] = await Promise.all([
        invoicesAPI.getAll(branchParams), membersAPI.getAll(branchParams), activitiesAPI.getAll(), productsAPI.getAll(branchParams),
        branchesAPI.getAll(), registrationFormsAPI.getAll(branchParams), creditNotesAPI.getAll(branchParams), levelsAPI.getAll(branchParams)
      ]);
      setInvoices(invoicesRes.data || []);
      setMembers(membersRes.data || []);
      setActivities(activitiesRes.data || []);
      setProducts(productsRes.data || []);
      setBranches(branchesRes.data || []);
      setRegistrationForms(regFormsRes.data || []);
      setCreditNotes(creditNotesRes.data || []);
      setLevels(levelsRes.data || []);
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
      level_id: '', // المستوى
      level_name: '',
      instance: existingCount + 1 // Track which instance this is
    }]);
    
    toast.success(language === 'ar' ? `تم إضافة ${activity.name_ar}` : `Added ${activity.name}`);
  };

  // State for level capacity warning
  const [levelCapacityWarnings, setLevelCapacityWarnings] = useState({});
  
  // State for cascading level selector (invoice)
  const [levelSelectorState, setLevelSelectorState] = useState({});
  // { itemIndex: { step: 'activity' | 'time' | 'level', selectedActivity: '', selectedTime: '' } }

  // Main activities for level selector
  const MAIN_ACTIVITIES_FOR_LEVELS = [
    { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', color: 'bg-blue-500' },
    { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', color: 'bg-green-500' },
    { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', color: 'bg-red-500' },
  ];

  // Parse activity name to get main activity
  const parseActivityForLevel = (activityName) => {
    if (!activityName) return 'other';
    const name = activityName.toLowerCase();
    if (name.includes('سباح') || name.includes('swim')) return 'swimming';
    if (name.includes('كر') || name.includes('foot') || name.includes('قدم')) return 'football';
    if (name.includes('كارات') || name.includes('karate')) return 'karate';
    return 'other';
  };

  // Group levels by main activity and time slot
  const groupedLevelsForSelector = React.useMemo(() => {
    const grouped = {};
    levels.forEach(level => {
      const mainActivity = parseActivityForLevel(level.activity_name);
      if (!grouped[mainActivity]) grouped[mainActivity] = {};
      
      // Extract time slot from activity_name
      let timeSlot = level.activity_name;
      if (level.activity_name.includes(' - ')) {
        timeSlot = level.activity_name.split(' - ')[1] || level.activity_name;
      }
      
      if (!grouped[mainActivity][timeSlot]) grouped[mainActivity][timeSlot] = [];
      grouped[mainActivity][timeSlot].push(level);
    });
    return grouped;
  }, [levels]);

  // Initialize level selector for an item
  const initLevelSelector = (index) => {
    setLevelSelectorState(prev => ({
      ...prev,
      [index]: { step: 'activity', selectedActivity: '', selectedTime: '' }
    }));
  };

  // Select activity in level selector
  const selectLevelActivity = (index, activityId) => {
    setLevelSelectorState(prev => ({
      ...prev,
      [index]: { step: 'time', selectedActivity: activityId, selectedTime: '' }
    }));
  };

  // Select time in level selector
  const selectLevelTime = (index, timeSlot) => {
    setLevelSelectorState(prev => ({
      ...prev,
      [index]: { ...prev[index], step: 'level', selectedTime: timeSlot }
    }));
  };

  // Go back in level selector
  const goBackLevelSelector = (index) => {
    const current = levelSelectorState[index];
    if (!current) return;
    
    if (current.step === 'level') {
      setLevelSelectorState(prev => ({
        ...prev,
        [index]: { ...prev[index], step: 'time', selectedTime: '' }
      }));
    } else if (current.step === 'time') {
      setLevelSelectorState(prev => ({
        ...prev,
        [index]: { step: 'activity', selectedActivity: '', selectedTime: '' }
      }));
    }
  };

  // Reset level selector
  const resetLevelSelector = (index) => {
    setLevelSelectorState(prev => {
      const newState = { ...prev };
      delete newState[index];
      return newState;
    });
  };

  const updateItemLevel = async (index, levelId) => {
    const updated = [...invoiceItems];
    const level = levels.find(l => l.id === levelId);
    updated[index].level_id = levelId;
    updated[index].level_name = level ? `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number} - ${level.activity_name}` : '';
    
    // Reset selector state after selection
    resetLevelSelector(index);
    
    // Check level capacity
    if (levelId) {
      try {
        const response = await levelsAPI.getMemberCount(levelId);
        const { is_full, member_count, max_capacity } = response.data;
        
        if (is_full) {
          // Show warning with accept/reject options
          setLevelCapacityWarnings(prev => ({
            ...prev,
            [index]: {
              isFull: true,
              isAccepted: false, // Not accepted yet
              memberCount: member_count,
              maxCapacity: max_capacity,
              message: language === 'ar' 
                ? `العدد في هذا المستوى مكتمل (${member_count}/${max_capacity} مشتركين)`
                : `This level is full (${member_count}/${max_capacity} members)`
            }
          }));
        } else {
          // Clear warning for this index
          setLevelCapacityWarnings(prev => {
            const newWarnings = { ...prev };
            delete newWarnings[index];
            return newWarnings;
          });
        }
      } catch (error) {
        console.error('Error checking level capacity:', error);
      }
    } else {
      // Clear warning when no level selected
      setLevelCapacityWarnings(prev => {
        const newWarnings = { ...prev };
        delete newWarnings[index];
        return newWarnings;
      });
    }
    
    setInvoiceItems(updated);
  };

  // Accept full level warning
  const handleAcceptFullLevel = (index) => {
    setLevelCapacityWarnings(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        isAccepted: true
      }
    }));
    toast.success(language === 'ar' ? 'تم قبول التسجيل في هذا المستوى' : 'Registration accepted for this level');
  };

  // Reject full level - clear selection
  const handleRejectFullLevel = (index) => {
    const updated = [...invoiceItems];
    updated[index].level_id = '';
    updated[index].level_name = '';
    setInvoiceItems(updated);
    setLevelCapacityWarnings(prev => {
      const newWarnings = { ...prev };
      delete newWarnings[index];
      return newWarnings;
    });
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
    const primarySubtotal = invoiceItems.reduce((sum, item) => sum + item.fee, 0);
    const additionalSubtotal = additionalMembers.reduce((sum, am) => sum + am.items.reduce((s, item) => s + item.fee, 0), 0);
    const subtotal = primarySubtotal + additionalSubtotal;
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
    
    // Check if any level is full and NOT accepted
    const hasUnacceptedFullLevel = Object.values(levelCapacityWarnings).some(w => w.isFull && !w.isAccepted);
    if (hasUnacceptedFullLevel) {
      toast.error(
        language === 'ar' 
          ? 'يوجد مستوى مكتمل العدد، يرجى الموافقة أو اختيار مستوى آخر.'
          : 'A selected level is full, please accept or choose another level.'
      );
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
        const createPayload = {
          member_id: selectedMember?.id || null,
          items: invoiceItems,
          discount: totalDiscount,
          discount_code: appliedCoupon?.code || null,
          notes, payment_method: paymentMethod,
          customer_name_ar: customerNameAr, customer_phone: customerPhone, customer_address: customerAddress,
          branch_id: selectedBranchId
        };
        if (additionalMembers.length > 0) {
          createPayload.additional_members = additionalMembers.map(am => ({
            member_id: am.member.id,
            member_name: am.member.name_ar || am.member.name,
            member_code: am.member.member_code || '',
            items: am.items
          }));
        }
        const response = await invoicesAPI.create(createPayload);
        toast.success(t('success'));
        
        if (selectedMember) {
          const subscriptionItems = (invoiceItems || []).map(item => ({
            activity_name: item.activity_name,
            start_date: item.start_date,
            end_date: item.end_date,
            schedule: item.schedule
          }));
          
          setQrCardMember({
            id: selectedMember.id,
            name_ar: customerNameAr || selectedMember.name_ar || selectedMember.name,
            member_code: selectedMember.member_code,
            phone: customerPhone || selectedMember.phone
          });
          setQrCardSubscription(subscriptionItems);
          setIsQRCardDialogOpen(true);
        }
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
    setInvoiceItems((invoice.items || []).map(item => ({
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
  const [sharingWhatsApp, setSharingWhatsApp] = useState(false);

  const handleShareWhatsApp = async () => {
    if (!selectedInvoice || !printRef.current) return;
    
    setSharingWhatsApp(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0,8);
      const fileName = `فاتورة_${invoiceNum}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      
      const message = `📄 فاتورة رقم #${invoiceNum} - الإجمالي: ${selectedInvoice.total} ر.س\nشركة اداء الابطال العالمية للرياضة`;
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          text: message,
          files: [file],
        });
        toast.success(language === 'ar' ? 'تمت المشاركة بنجاح' : 'Shared successfully');
      } else {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = fileName;
        link.click();
        
        const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
        const whatsappMsg = encodeURIComponent(message);
        if (phone) {
          window.open(`https://wa.me/${phone}?text=${whatsappMsg}`, '_blank');
        } else {
          window.open(`https://wa.me/?text=${whatsappMsg}`, '_blank');
        }
        toast.success(language === 'ar' ? 'تم تحميل صورة الفاتورة! أرفقها في الواتساب' : 'Invoice image downloaded! Attach it in WhatsApp');
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        const phone = selectedInvoice.customer_phone?.replace(/^0/, '966') || '';
        const invoiceNum = selectedInvoice.invoice_number || selectedInvoice.id.slice(0,8);
        const items = selectedInvoice.items?.map(item => `• ${item.activity_name}: ${item.fee} ر.س`).join('\n') || '';
        const message = `السلام عليكم،\n\n📄 *فاتورة رقم #${invoiceNum}*\n\n${items}\n\n✅ *الإجمالي: ${selectedInvoice.total} ر.س*\n\nشكراً لكم،\nشركة اداء الابطال العالمية للرياضة`;
        if (phone) {
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
        } else {
          navigator.clipboard?.writeText(message);
          toast.info(language === 'ar' ? 'تم نسخ الرسالة' : 'Message copied');
        }
      }
    } finally {
      setSharingWhatsApp(false);
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

  // Open QR Card Modal for member
  const handleOpenQRCard = (invoice) => {
    const memberData = {
      id: invoice.member_id,
      name_ar: invoice.customer_name_ar || invoice.member_name,
      member_code: invoice.member_code,
      phone: invoice.customer_phone
    };
    setQrCardMember(memberData);
    setIsQRCardDialogOpen(true);
  };

  // Print QR Card (6cm x 6cm exact size)
  const handlePrintQRCard = async () => {
    if (!qrCardMember) return;
    
    // QR data is just the member code number
    const qrData = qrCardMember.member_code.toString();
    
    // Generate QR code as data URL first
    let qrImageUrl = '';
    try {
      const QRCode = await import('qrcode');
      qrImageUrl = await QRCode.toDataURL(qrData, { 
        width: 200, 
        margin: 1,
        errorCorrectionLevel: 'H'
      });
    } catch (err) {
      console.error('QR generation error:', err);
      toast.error('خطأ في إنشاء QR Code');
      return;
    }
    
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${qrCardMember.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
            
            @page { 
              size: A4;
              margin: 0mm;
            }
            
            * { margin: 0; padding: 0; box-sizing: border-box; }
            
            html, body {
              margin: 0;
              padding: 0;
            }
            
            body { 
              font-family: 'Tajawal', Arial, sans-serif; 
              background: #f3f4f6;
              direction: rtl;
            }
            
            .screen-only {
              padding: 20px;
              text-align: center;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            
            @media print {
              .screen-only { display: none !important; }
              .print-area {
                display: block !important;
                position: absolute;
                top: 0;
                right: 0;
                margin: 2mm;
              }
            }
            
            @media screen {
              .print-area { display: none; }
            }
            
            .preview-title {
              font-size: 18px;
              font-weight: bold;
              color: #1f2937;
              margin-bottom: 10px;
            }
            
            .size-badge {
              display: inline-block;
              padding: 10px 20px;
              background: linear-gradient(135deg, #FEF3C7, #FDE68A);
              border: 2px dashed #F59E0B;
              border-radius: 10px;
              font-size: 16px;
              font-weight: bold;
              color: #92400E;
              margin-bottom: 20px;
            }
            
            .card-wrapper {
              display: inline-block;
              background: white;
              padding: 15px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.15);
              border: 2px solid #e5e7eb;
            }
            
            .card {
              width: 6cm;
              height: 6cm;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
              padding: 3mm;
            }
            
            .print-card {
              width: 6cm;
              height: 6cm;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: white;
              padding: 3mm;
              border: 1px solid #ddd;
            }
            
            .logo { 
              font-size: 9pt; 
              font-weight: bold; 
              color: #F97316; 
              margin-bottom: 2mm; 
            }
            
            .qr-img { 
              width: 35mm; 
              height: 35mm;
            }
            
            .name { 
              font-size: 9pt; 
              font-weight: bold; 
              margin-top: 2mm; 
              text-align: center; 
              color: #1f2937;
            }
            
            .code { 
              font-size: 11pt; 
              font-weight: bold; 
              color: #F97316;
              margin-top: 1mm;
            }
            
            .print-btn {
              margin-top: 20px;
              padding: 12px 30px;
              background: linear-gradient(135deg, #3B82F6, #2563EB);
              color: white;
              border: none;
              border-radius: 10px;
              cursor: pointer;
              font-family: 'Tajawal', Arial, sans-serif;
              font-size: 16px;
              font-weight: bold;
              box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
            }
            
            .print-btn:hover {
              transform: translateY(-2px);
              box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
            }
            
            .note {
              margin-top: 15px;
              font-size: 13px;
              color: #6b7280;
            }
          </style>
        </head>
        <body>
          <!-- Screen Preview -->
          <div class="screen-only">
            <div class="preview-title">📋 معاينة بطاقة العضوية</div>
            <div class="size-badge">📐 مقاس البطاقة: 6 سم × 6 سم</div>
            
            <div class="card-wrapper">
              <div class="card">
                <div class="logo">🏆 شركة اداء الابطال العالمية للرياضة</div>
                <img src="${qrImageUrl}" class="qr-img" alt="QR Code" />
                <div class="name">${qrCardMember.name_ar || ''}</div>
                <div class="code">#${qrCardMember.member_code || ''}</div>
              </div>
            </div>
            
            <button class="print-btn" onclick="window.print()">🖨️ طباعة البطاقة</button>
            <p class="note">البطاقة ستُطبع في أعلى الصفحة</p>
          </div>
          
          <!-- Print Only - Top of page -->
          <div class="print-area">
            <div class="print-card">
              <div class="logo">🏆 شركة اداء الابطال العالمية للرياضة</div>
              <img src="${qrImageUrl}" class="qr-img" alt="QR Code" />
              <div class="name">${qrCardMember.name_ar || ''}</div>
              <div class="code">#${qrCardMember.member_code || ''}</div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Print member card from invoice
  const handleOpenCardPrint = (invoice) => {
    const today = new Date().toISOString().split('T')[0];
    
    // Get activities with dates from invoice
    const activitiesWithDates = invoice.items?.filter(item => !item.is_product).map(item => {
      let startDate = item.start_date || '';
      let endDate = item.end_date || '';
      
      // If no start/end date, try to extract from period field
      if ((!startDate || !endDate) && item.period) {
        const periodParts = item.period.split(' - ');
        if (periodParts.length === 2) {
          startDate = startDate || periodParts[0].trim();
          endDate = endDate || periodParts[1].trim();
        }
      }
      
      const isActive = endDate ? endDate >= today : true;
      return {
        activity_name: item.activity_name,
        start_date: startDate,
        end_date: endDate,
        schedule: item.schedule || '',
        status: isActive ? 'active' : 'expired'
      };
    }) || [];
    
    // Find member data
    const member = members.find(m => m.id === invoice.member_id);
    if (member) {
      setCardPrintMember({
        ...member,
        activities: activitiesWithDates
      });
      setShowCardPrintDialog(true);
    } else if (invoice.customer_name_ar || invoice.customer_phone) {
      // Use invoice customer data
      setCardPrintMember({
        name_ar: invoice.customer_name_ar,
        phone: invoice.customer_phone,
        member_code: invoice.invoice_number,
        activities: activitiesWithDates
      });
      setShowCardPrintDialog(true);
    }
  };

  const handleStickerPrint = () => {
    setShowCardPrintDialog(false);
    if (!cardPrintMember) return;
    
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    
    // QR Data for member card
    // QR data is just the member code number
    const qrData = cardPrintMember.member_code.toString();
    
    // Get first activity dates for display under QR
    const firstActivity = cardPrintMember?.activities?.[0];
    const startDate = firstActivity?.start_date || '';
    const endDate = firstActivity?.end_date || '';
    
    // Get schedule info
    const schedule = firstActivity?.schedule || '';
    
    const activitiesHtml = cardPrintMember?.activities?.map(act => {
      return `
        <div class="activity-item ${act.status}">
          <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
          ${act.schedule ? `<div style="font-size:5.5pt;color:#2563EB;margin-top:0.3mm;">📅 ${act.schedule}</div>` : ''}
          
        </div>
      `;
    }).join('') || '';
    
    // Print BOTH card and logo together
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${cardPrintMember?.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4; margin: 0mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
            .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 10mm; gap: 5mm; } }
            @media screen { .print-area { display: none; } }
            .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
            .card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
            .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
            .header-text h2 { font-size: 7pt; font-weight: 700; margin: 0; line-height: 1.3; }
            .header-text p { font-size: 5.5pt; opacity: 0.9; margin: 0; }
            .header-logo { width: 10mm; height: 10mm; border-radius: 50%; background: white; padding: 0.5mm; display: flex; align-items: center; justify-content: center; }
            .header-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
            .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
            .info-section { flex: 1; text-align: right; overflow: hidden; }
            .qr-container { display: flex; flex-direction: column; align-items: center; }
            .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
            .qr-section img { width: 100%; height: 100%; }
            .qr-dates { text-align: center; font-size: 8pt; color: #1f2937; margin-top: 1mm; line-height: 1.4; font-weight: 700; }
            .qr-dates span { display: block; }
            .schedule-info { text-align: center; font-size: 6pt; color: #F97316; margin-top: 1mm; font-weight: 600; background: #FFF7ED; padding: 1mm; border-radius: 2mm; }
            .member-name { font-size: 10pt; font-weight: 700; color: #1f2937; margin-bottom: 1mm; }
            .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.8mm; font-size: 7pt; }
            .info-label { color: #6b7280; font-size: 6pt; }
            .member-code { color: #F97316; font-weight: 700; font-size: 10pt; }
            .activities { margin-top: 1mm; padding-top: 1mm; border-top: 1px dashed #e5e7eb; }
            .activities-label { font-size: 6pt; color: #6b7280; margin-bottom: 0.5mm; }
            .activity-item { padding: 1mm 1.5mm; margin-bottom: 0.5mm; border-radius: 1.5mm; font-size: 6pt; }
            .activity-item.active { background: #D1FAE5; border-right: 2px solid #10B981; }
            .activity-item.expired { background: #FEE2E2; border-right: 2px solid #EF4444; }
            .activity-name { font-weight: 600; color: #1f2937; font-size: 7pt; }
            .activity-status { font-size: 6pt; font-weight: 700; }
            .activity-item.active .activity-status { color: #059669; }
            .activity-item.expired .activity-status { color: #DC2626; }
            .card-footer { text-align: right; padding: 1.5mm 2mm; background: #f9fafb; font-size: 5pt; color: #374151; border-top: 1px dashed #e5e7eb; line-height: 1.4; }
            .card-footer .terms-title { font-weight: 700; color: #1f2937; font-size: 6pt; margin-bottom: 0.5mm; }
            .logo-card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
            .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
            .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
            .logo-card .terms { text-align: right; font-size: 5.5pt; color: #374151; margin-top: 2mm; line-height: 1.6; padding: 0 2mm; }
            .logo-card .terms .terms-title { font-weight: 700; color: #1f2937; font-size: 6.5pt; margin-bottom: 1mm; text-align: center; }
            .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
            .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
            .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
            <div class="sticker-preview">
              <!-- Member Card - Position 1 -->
              <div class="card">
                <div class="card-header">
                  <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                  <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
                </div>
                <div class="card-body">
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                    <div class="qr-dates">
                      <span>من: ${startDate || '----'}</span>
                      <span>إلى: ${endDate || '----'}</span>
                    </div>
                    ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
                  </div>
                  <div class="info-section">
                    <div class="info-label">الاسم</div>
                    <div class="member-name">${cardPrintMember?.name_ar || ''}</div>
                    <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${cardPrintMember?.member_code || ''}</span></div>
                    <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${cardPrintMember?.phone || '-'}</span></div>
                    ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                  </div>
                </div>
                <div class="card-footer">
                  <div class="terms-title">شروط وأحكام:</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                </div>
              </div>
              <!-- Logo Card - Position 2 -->
              <div class="logo-card">
                <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
                <div class="contact-info">📞 0566238384</div>
                <div class="terms">
                  <div class="terms-title">شروط وأحكام</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                  <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
                </div>
              </div>
            </div>
            <div class="position-labels">
              <div class="position-label">📍 خانة 1: كرت العضوية</div>
              <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
            </div>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 9سم × 6سم</p>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
          </div>
          <div class="print-area">
            <!-- Member Card - Position 1 -->
            <div class="card">
              <div class="card-header">
                <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
              </div>
              <div class="card-body">
                <div class="qr-container">
                  <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                  <div class="qr-dates">
                    <span>من: ${startDate || '----'}</span>
                    <span>إلى: ${endDate || '----'}</span>
                  </div>
                  ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
                </div>
                <div class="info-section">
                  <div class="info-label">الاسم</div>
                  <div class="member-name">${cardPrintMember?.name_ar || ''}</div>
                  <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${cardPrintMember?.member_code || ''}</span></div>
                  <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${cardPrintMember?.phone || '-'}</span></div>
                  ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                </div>
              </div>
            </div>
            <!-- Logo Card - Position 2 -->
            <div class="logo-card">
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              <div class="contact-info">📞 0566238384</div>
              <div class="terms">
                <div class="terms-title">شروط وأحكام</div>
                <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Print card from registration form
  const handlePrintRegFormCard = (form) => {
    // Calculate activity status based on dates
    const today = new Date().toISOString().split('T')[0];
    
    // Find member by phone or create data from form
    const member = members.find(m => m.phone === form.customer_phone);
    const activities = form.items?.filter(item => !item.is_product).map(item => {
      const endDate = item.end_date || '';
      const startDate = item.start_date || '';
      const isActive = endDate ? endDate >= today : true;
      
      return {
        activity_name: item.activity_name,
        start_date: startDate,
        end_date: endDate,
        schedule: item.schedule || '',
        status: isActive ? 'active' : 'expired',
        level_name: item.level_name || ''
      };
    }) || [];
    
    if (member) {
      setRegFormCardData({
        ...member,
        form_number: form.form_number,
        member_code: form.member_code || member.member_code,
        activities: activities
      });
    } else {
      // Use form data with member_code from form
      setRegFormCardData({
        name_ar: form.customer_name,
        phone: form.customer_phone,
        member_code: form.member_code || form.form_number,
        activities: activities
      });
    }
    setShowRegFormCardPrintDialog(true);
  };

  const handleRegFormStickerPrint = () => {
    setShowRegFormCardPrintDialog(false);
    if (!regFormCardData) return;
    
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    
    // QR data is just the member code number
    const qrData = (regFormCardData.member_code || regFormCardData.form_number).toString();
    
    // Get first activity dates for display under QR
    const firstActivity = regFormCardData?.activities?.[0];
    const startDate = firstActivity?.start_date || '';
    const endDate = firstActivity?.end_date || '';
    
    // Get schedule info
    const schedule = firstActivity?.schedule || '';
    
    const activitiesHtml = regFormCardData?.activities?.map(act => {
      return `
        <div class="activity-item ${act.status}">
          <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
          ${act.schedule ? `<div style="font-size:5.5pt;color:#2563EB;margin-top:0.3mm;">📅 ${act.schedule}</div>` : ''}
          
        </div>
      `;
    }).join('') || '';
    
    // Print BOTH card and logo together
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${regFormCardData?.member_code || regFormCardData?.form_number}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4; margin: 0mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
            .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 10mm; gap: 5mm; } }
            @media screen { .print-area { display: none; } }
            .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
            .card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; }
            .card-header { background: linear-gradient(135deg, #F97316, #F59E0B); padding: 1.5mm 2mm; display: flex; justify-content: space-between; align-items: center; color: white; }
            .header-text h2 { font-size: 7pt; font-weight: 700; margin: 0; line-height: 1.3; }
            .header-text p { font-size: 5.5pt; opacity: 0.9; margin: 0; }
            .header-logo { width: 10mm; height: 10mm; border-radius: 50%; background: white; padding: 0.5mm; display: flex; align-items: center; justify-content: center; }
            .header-logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; }
            .card-body { padding: 2mm; display: flex; gap: 2mm; flex: 1; }
            .info-section { flex: 1; text-align: right; overflow: hidden; }
            .qr-container { display: flex; flex-direction: column; align-items: center; }
            .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
            .qr-section img { width: 100%; height: 100%; }
            .qr-dates { text-align: center; font-size: 8pt; color: #1f2937; margin-top: 1mm; line-height: 1.4; font-weight: 700; }
            .qr-dates span { display: block; }
            .schedule-info { text-align: center; font-size: 6pt; color: #F97316; margin-top: 1mm; font-weight: 600; background: #FFF7ED; padding: 1mm; border-radius: 2mm; }
            .member-name { font-size: 10pt; font-weight: 700; color: #1f2937; margin-bottom: 1mm; }
            .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.8mm; font-size: 7pt; }
            .info-label { color: #6b7280; font-size: 6pt; }
            .member-code { color: #F97316; font-weight: 700; font-size: 10pt; }
            .activities { margin-top: 1mm; padding-top: 1mm; border-top: 1px dashed #e5e7eb; }
            .activities-label { font-size: 6pt; color: #6b7280; margin-bottom: 0.5mm; }
            .activity-item { padding: 1mm 1.5mm; margin-bottom: 0.5mm; border-radius: 1.5mm; font-size: 6pt; }
            .activity-item.active { background: #D1FAE5; border-right: 2px solid #10B981; }
            .activity-item.expired { background: #FEE2E2; border-right: 2px solid #EF4444; }
            .activity-name { font-weight: 600; color: #1f2937; font-size: 7pt; }
            .activity-status { font-size: 6pt; font-weight: 700; }
            .activity-item.active .activity-status { color: #059669; }
            .activity-item.expired .activity-status { color: #DC2626; }
            .card-footer { text-align: right; padding: 1.5mm 2mm; background: #f9fafb; font-size: 5pt; color: #374151; border-top: 1px dashed #e5e7eb; line-height: 1.4; }
            .card-footer .terms-title { font-weight: 700; color: #1f2937; font-size: 6pt; margin-bottom: 0.5mm; }
            .logo-card { width: 90mm; height: 60mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3mm; }
            .logo-card img { max-width: 100%; max-height: 55%; object-fit: contain; }
            .logo-card .contact-info { font-size: 7pt; color: #374151; text-align: center; margin-top: 2mm; font-weight: 600; line-height: 1.6; }
            .logo-card .terms { text-align: right; font-size: 5.5pt; color: #374151; margin-top: 2mm; line-height: 1.6; padding: 0 2mm; }
            .logo-card .terms .terms-title { font-weight: 700; color: #1f2937; font-size: 6.5pt; margin-bottom: 1mm; text-align: center; }
            .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #9333EA, #7C3AED); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
            .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
            .position-label { padding: 8px 16px; background: #F3E8FF; border-radius: 8px; color: #7C3AED; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
            <div class="sticker-preview">
              <!-- Member Card - Position 1 -->
              <div class="card">
                <div class="card-header">
                  <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                  <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
                </div>
                <div class="card-body">
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                    <div class="qr-dates">
                      <span>من: ${startDate || '----'}</span>
                      <span>إلى: ${endDate || '----'}</span>
                    </div>
                    ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
                  </div>
                  <div class="info-section">
                    <div class="info-label">الاسم</div>
                    <div class="member-name">${regFormCardData?.name_ar || ''}</div>
                    <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${regFormCardData?.member_code || regFormCardData?.form_number || ''}</span></div>
                    <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${regFormCardData?.phone || '-'}</span></div>
                    ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                  </div>
                </div>
                <div class="card-footer">
                  <div class="terms-title">شروط وأحكام:</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                </div>
              </div>
              <!-- Logo Card - Position 2 -->
              <div class="logo-card">
                <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
                <div class="contact-info">📞 0566238384</div>
                <div class="terms">
                  <div class="terms-title">شروط وأحكام</div>
                  <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                  <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                  <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
                </div>
              </div>
            </div>
            <div class="position-labels">
              <div class="position-label">📍 خانة 1: كرت العضوية</div>
              <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
            </div>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 9سم × 6سم</p>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
          </div>
          <div class="print-area">
            <!-- Member Card - Position 1 -->
            <div class="card">
              <div class="card-header">
                <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
              </div>
              <div class="card-body">
                <div class="qr-container">
                  <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                  <div class="qr-dates">
                    <span>من: ${startDate || '----'}</span>
                    <span>إلى: ${endDate || '----'}</span>
                  </div>
                  ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
                </div>
                <div class="info-section">
                  <div class="info-label">الاسم</div>
                  <div class="member-name">${regFormCardData?.name_ar || ''}</div>
                  <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${regFormCardData?.member_code || regFormCardData?.form_number || ''}</span></div>
                  <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${regFormCardData?.phone || '-'}</span></div>
                  ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                </div>
              </div>
            </div>
            <!-- Logo Card - Position 2 -->
            <div class="logo-card">
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              <div class="contact-info">📞 0566238384</div>
              <div class="terms">
                <div class="terms-title">شروط وأحكام</div>
                <div>• الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</div>
                <div>• المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</div>
                <div>• في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Send QR Card Image via WhatsApp
  const handleSendQRCardWhatsApp = async () => {
    if (!qrCardMember) return;
    
    const phone = qrCardMember.phone?.replace(/^0/, '966') || '';
    if (!phone) { 
      toast.error(language === 'ar' ? 'لا يوجد رقم جوال' : 'No phone number'); 
      return; 
    }
    
    // QR data is just the member code number
    const qrData = qrCardMember.member_code.toString();
    
    try {
      // Create canvas with QR code and member info
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 500;
      const ctx = canvas.getContext('2d');
      
      // Background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 400, 500);
      
      // Header
      ctx.fillStyle = '#F97316';
      ctx.font = 'bold 18px Tajawal, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🏆 شركة اداء الابطال العالمية للرياضة', 200, 35);
      
      // Generate QR code
      const QRCode = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(qrData, { width: 280, margin: 2 });
      
      // Draw QR code
      const qrImg = new Image();
      qrImg.onload = () => {
        ctx.drawImage(qrImg, 60, 60, 280, 280);
        
        // Member name
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 22px Tajawal, sans-serif';
        ctx.fillText(qrCardMember.name_ar || '', 200, 380);
        
        // Member code
        ctx.fillStyle = '#F97316';
        ctx.font = 'bold 28px Tajawal, sans-serif';
        ctx.fillText('#' + qrCardMember.member_code, 200, 420);
        
        // Footer
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px Tajawal, sans-serif';
        ctx.fillText('امسح الكود عند الدخول لتسجيل الحضور', 200, 470);
        
        // Convert to blob and download/share
        canvas.toBlob((blob) => {
          // Create download link
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `qr-${qrCardMember.member_code}.png`;
          link.click();
          URL.revokeObjectURL(url);
          
          // Open WhatsApp with message
          const message = `🏆 *شركة اداء الابطال العالمية للرياضة*
━━━━━━━━━━━━━━
🎫 *بطاقة العضوية*

👤 *الاسم:* ${qrCardMember.name_ar}
🔢 *رقم العضوية:* #${qrCardMember.member_code}

📎 تم إرفاق صورة QR Code
امسح الكود عند الدخول للأكاديمية ✅`;
          
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
          toast.success(language === 'ar' ? 'تم تحميل الصورة - أرسلها في الواتساب' : 'Image downloaded - send it on WhatsApp');
        }, 'image/png');
      };
      qrImg.src = qrDataUrl;
      
    } catch (err) {
      console.error('Error generating QR:', err);
      toast.error(language === 'ar' ? 'خطأ في إنشاء الصورة' : 'Error creating image');
    }
    
    setIsQRCardDialogOpen(false);
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
👤 *العميل:* ${invoice.customer_name_ar || invoice.member_name}${invoice.member_code ? ` (#${invoice.member_code})` : ''}
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
    if (!selectedInvoice) return;
    const inv = selectedInvoice;
    const branchName = getBranchName(inv.branch_id);
    const dateStr = new Date(inv.created_at).toLocaleDateString('ar-SA');
    const itemsRows = (inv.items || []).map((item, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>${item.activity_name || ''}</td>
        <td>${item.period || '-'}</td>
        <td class="schedule-cell">${item.schedule || '-'}</td>
        <td style="text-align:left">${(item.fee || 0).toFixed(2)} ر.س</td>
      </tr>
    `).join('');
    const qrImg = qrCode ? `<div class="qr-section"><img src="${qrCode}" /><p>رمز QR للفاتورة الإلكترونية</p></div>` : '';
    const notesBlock = inv.notes ? `<div class="notes-box"><strong>ملاحظات:</strong> ${inv.notes}</div>` : '';
    const printWindow = window.open('', '', 'width=800,height=900');
    printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة #${inv.invoice_number || inv.id.slice(0,8)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      @page{size:A4;margin:12mm}
      body{font-family:'Tajawal',Arial,sans-serif;direction:rtl;color:#1f2937;font-size:12px;line-height:1.5}
      .invoice-page{max-width:760px;margin:0 auto;padding:20px}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1E3A8A;padding-bottom:12px;margin-bottom:15px}
      .header-right h1{font-size:20px;color:#1E3A8A;margin-bottom:2px}
      .header-right .sub{font-size:10px;color:#6b7280}
      .header-right .branch{display:inline-block;margin-top:6px;background:#FFF7ED;border:1px solid #FDBA74;color:#C2410C;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700}
      .header-left{text-align:left;font-size:11px}
      .header-left .inv-num{font-size:14px;font-weight:700;color:#1E3A8A}
      .header-left .status{display:inline-block;padding:3px 12px;border-radius:12px;font-size:10px;font-weight:700;margin-top:4px}
      .status-paid{background:#DEF7EC;color:#03543F}
      .status-pending{background:#FEF3C7;color:#92400E}
      .status-cancelled{background:#FDE8E8;color:#9B1C1C}
      .customer-box{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:15px}
      .customer-box h3{font-size:13px;color:#1E3A8A;margin-bottom:6px}
      .customer-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px}
      .customer-grid strong{color:#374151}
      .member-code{color:#F97316;font-weight:800}
      table{width:100%;border-collapse:collapse;margin:12px 0}
      thead th{background:#1E3A8A;color:#fff;padding:8px 10px;font-size:11px;font-weight:600;text-align:right}
      tbody td{padding:7px 10px;border-bottom:1px solid #E5E7EB;font-size:11px}
      tbody tr:nth-child(even){background:#F9FAFB}
      .schedule-cell{color:#1D4ED8;font-weight:600;font-size:10px}
      .totals-section{margin-top:10px;border-top:2px solid #E5E7EB;padding-top:10px}
      .total-row{display:flex;justify-content:space-between;padding:4px 12px;font-size:12px}
      .total-row.discount{color:#DC2626}
      .total-row.vat{color:#059669}
      .total-row.grand{font-size:16px;font-weight:800;color:#F97316;border-top:2px solid #1E3A8A;margin-top:6px;padding-top:8px}
      .payment-box{margin-top:12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px;font-size:11px}
      .payment-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .notes-box{margin-top:10px;background:#F3F4F6;border:1px solid #D1D5DB;border-radius:6px;padding:8px;font-size:10px}
      .terms-box{margin-top:12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;padding:10px}
      .terms-box h4{font-size:10px;color:#92400E;margin-bottom:5px}
      .terms-box ul{font-size:9px;color:#A16207;padding-right:16px;margin:0}
      .terms-box li{margin-bottom:2px}
      .qr-section{text-align:center;margin-top:12px}
      .qr-section img{width:90px;height:90px}
      .qr-section p{font-size:8px;color:#9CA3AF;margin-top:3px}
      .footer{margin-top:15px;border-top:2px solid #1E3A8A;padding-top:10px;text-align:center}
      .footer p{font-size:9px;color:#6B7280;margin-bottom:2px}
      .footer .company{font-size:11px;font-weight:700;color:#1E3A8A}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>
    <div class="invoice-page">
      <div class="header">
        <div class="header-right">
          <h1>🏆 ${COMPANY_INFO.name_ar}</h1>
          <div class="sub">${COMPANY_INFO.name_en}</div>
          <div class="sub">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div>
          <div class="branch">🏢 ${branchName}</div>
        </div>
        <div class="header-left">
          <div class="inv-num">فاتورة #${inv.invoice_number || inv.id.slice(0,8)}</div>
          <div>📅 ${dateStr}</div>
          <span class="status ${inv.status === 'paid' ? 'status-paid' : inv.status === 'cancelled' ? 'status-cancelled' : 'status-pending'}">
            ${inv.status === 'paid' ? '✅ مدفوعة' : inv.status === 'cancelled' ? '❌ ملغاة' : '⏳ غير مدفوعة'}
          </span>
        </div>
      </div>

      <div class="customer-box">
        <h3>👤 بيانات العميل</h3>
        <div class="customer-grid">
          <div><strong>الاسم:</strong> ${inv.customer_name_ar || inv.member_name || '-'}${inv.member_code ? ` <span class="member-code">(#${inv.member_code})</span>` : ''}</div>
          <div><strong>الجوال:</strong> <span dir="ltr">${inv.customer_phone || '-'}</span></div>
          ${inv.customer_address ? `<div style="grid-column:span 2"><strong>العنوان:</strong> ${inv.customer_address}</div>` : ''}
        </div>
      </div>

      <table>
        <thead><tr><th style="width:40px;text-align:center">#</th><th>النشاط</th><th>الفترة</th><th>المواعيد</th><th style="text-align:left">المبلغ</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>

      <div class="totals-section">
        <div class="total-row"><span>المجموع الفرعي:</span><span>${(inv.subtotal || 0).toFixed(2)} ر.س</span></div>
        ${inv.discount > 0 ? `<div class="total-row discount"><span>الخصم:</span><span>- ${(inv.discount || 0).toFixed(2)} ر.س</span></div>` : ''}
        <div class="total-row vat"><span>ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%):</span><span>${(inv.vat_amount || 0).toFixed(2)} ر.س</span></div>
        <div class="total-row grand"><span>الإجمالي:</span><span>${(inv.total || 0).toFixed(2)} ر.س</span></div>
      </div>

      <div class="payment-box">
        <div class="payment-grid">
          <div><strong>طريقة الدفع:</strong> ${getPaymentMethodLabel(inv.payment_method, 'ar')}</div>
          <div><strong>الحالة:</strong> ${inv.status === 'paid' ? '✅ مدفوعة' : '⏳ غير مدفوعة'}</div>
          ${inv.supervisor_name ? `<div style="grid-column:span 2"><strong>👤 مشرف الفاتورة:</strong> ${inv.supervisor_name}</div>` : ''}
        </div>
      </div>

      ${notesBlock}

      <div class="terms-box">
        <h4>⚠️ شروط وأحكام:</h4>
        <ul>
          ${INVOICE_TERMS.ar.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>

      ${qrImg}

      <div style="margin-top:12px;padding:10px;border:2px solid #9333EA;border-radius:8px">
        <p style="font-size:11px;font-weight:700;color:#6b21a8;margin-bottom:6px">🏆 برنامج نقاط الولاء</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:10px;color:#7e22ce">
          <span>✅ كل حضور: 10 نقاط</span>
          <span>🔥 سلسلة 5 أيام: 50 نقطة</span>
          <span>📺 مشاهدة فيديو: 3 نقاط</span>
          <span>👥 إحالة صديق: 200 نقطة</span>
          <span>🔄 تجديد شهري: 100 نقطة</span>
          <span>🎂 عيد ميلاد: 100 نقطة</span>
        </div>
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid #9333EA">
          <p style="font-size:10px;font-weight:700;color:#6b21a8;margin-bottom:4px">المستويات والمزايا:</p>
          <div style="display:flex;justify-content:space-between;font-size:9px;color:#7e22ce">
            <span>🥉 برونزي: 0+</span>
            <span>🥈 فضي: 500+ (خصم 3%)</span>
            <span>🥇 ذهبي: 1500+ (خصم 5%)</span>
            <span>💎 ماسي: 3000+ (خصم 10%)</span>
          </div>
        </div>
      </div>

      <div class="footer">
        <p class="company">${COMPANY_INFO.name_ar} | ${COMPANY_INFO.name_en}</p>
        <p>🏢 ${branchName}</p>
        <p>الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</p>
      </div>
    </div>
    </body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
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
              <span>${selectedInvoice.customer_name_ar || selectedInvoice.member_name || ''}${selectedInvoice.member_code ? ` <strong style="color:#F97316">(#${selectedInvoice.member_code})</strong>` : ''}</span>
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
    // Check if any level is full and NOT accepted
    const hasUnacceptedFullLevel = Object.values(regFormLevelWarnings).some(w => w.isFull && !w.isAccepted);
    if (hasUnacceptedFullLevel) {
      toast.error(
        language === 'ar' 
          ? 'يوجد مستوى مكتمل العدد، يرجى الموافقة أو اختيار مستوى آخر.'
          : 'A selected level is full, please accept or choose another level.'
      );
      return;
    }
    
    const branchName = branches.find(b => b.id === selectedBranchId)?.name_ar || '';
    
    // Calculate totals WITHOUT VAT
    const formSubtotal = regFormItems.reduce((sum, item) => sum + ((item.fee || 0) * (item.quantity || 1)), 0);
    const totalDiscountAmount = regFormDiscount + regFormCouponDiscount;
    const formTotal = formSubtotal - totalDiscountAmount; // NO VAT for registration form
    
    // Build items table rows
    const itemsRows = (regFormItems || []).map((item, idx) => `
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
          .header-banner { background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white; padding: 12px; text-align: center; margin: -20px -20px 15px -20px; }
          .header-banner .company-name { font-size: 16px; font-weight: bold; margin-bottom: 3px; }
          .header-banner .branch-name { font-size: 11px; margin-top: 5px; background: rgba(255,255,255,0.2); display: inline-block; padding: 3px 12px; border-radius: 15px; }
          .header-banner .company-info { font-size: 9px; opacity: 0.9; margin-top: 5px; }
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
        vat_amount: 0,
        total: formTotal,
        payment_method: regFormPaymentMethod,
        notes: regFormNotes,
        branch_id: selectedBranchId !== 'all' ? selectedBranchId : null
      };
      if (regFormAdditionalMembers.length > 0) {
        formData.additional_members = regFormAdditionalMembers.filter(am => am.member && am.items.length > 0).map(am => ({
          member_id: am.member.id,
          member_name: am.member.name_ar || am.member.name,
          member_code: am.member.member_code || '',
          items: am.items
        }));
      }
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
    // Check if any level is full and NOT accepted
    const hasUnacceptedFullLevel = Object.values(regFormLevelWarnings).some(w => w.isFull && !w.isAccepted);
    if (hasUnacceptedFullLevel) {
      toast.error(
        language === 'ar' 
          ? 'يوجد مستوى مكتمل العدد، يرجى الموافقة أو اختيار مستوى آخر.'
          : 'A selected level is full, please accept or choose another level.'
      );
      return;
    }
    
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
      if (regFormAdditionalMembers.length > 0) {
        formData.additional_members = regFormAdditionalMembers.filter(am => am.member && am.items.length > 0).map(am => ({
          member_id: am.member.id,
          member_name: am.member.name_ar || am.member.name,
          member_code: am.member.member_code || '',
          items: am.items
        }));
      }
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
        <div style="background:linear-gradient(135deg,#1e3a8a 0%,#1e40af 100%);color:white;padding:12px;text-align:center;margin:-20px -20px 15px -20px">
          <div style="font-size:16px;font-weight:bold;margin-bottom:3px">${COMPANY_INFO.name_ar}</div>
          ${branchName ? `<div style="font-size:11px;margin-top:5px;background:rgba(255,255,255,0.2);display:inline-block;padding:3px 12px;border-radius:15px">🏢 فرع: ${branchName}</div>` : ''}
          <div style="font-size:9px;opacity:0.9;margin-top:5px">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div>
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

  // Print registration form directly
  const handlePrintViewedRegForm = (form) => {
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
    
    const printContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>استمارة تسجيل - ${form.form_number}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; padding: 20px; max-width: 800px; margin: 0 auto; }
          @media print {
            body { padding: 10px; }
            @page { size: A4; margin: 10mm; }
          }
          .header { background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white; padding: 12px; text-align: center; margin-bottom: 15px; border-radius: 8px; }
          .company-name { font-size: 16px; font-weight: bold; margin-bottom: 3px; }
          .branch-name { font-size: 11px; margin-top: 5px; background: rgba(255,255,255,0.2); display: inline-block; padding: 3px 12px; border-radius: 15px; }
          .tax-info { font-size: 9px; opacity: 0.9; margin-top: 5px; }
          .form-title { font-size: 20px; font-weight: bold; text-align: center; margin: 20px 0; padding: 12px; background: #f8fafc; border: 2px solid #1e3a8a; border-radius: 8px; color: #1e3a8a; }
          .section { margin-bottom: 15px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
          .section-title { font-size: 14px; font-weight: bold; margin-bottom: 10px; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 5px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .info-item { display: flex; gap: 8px; padding: 5px 0; }
          .info-label { font-weight: bold; min-width: 90px; color: #374151; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          thead tr { background: #1e3a8a; color: white; }
          th, td { padding: 10px; text-align: right; }
          .totals { margin-top: 15px; border: 2px solid #1e3a8a; padding: 15px; border-radius: 8px; background: #eff6ff; }
          .total-row { display: flex; justify-content: space-between; padding: 8px 0; }
          .total-main { font-size: 18px; font-weight: bold; padding-top: 12px; color: #1e3a8a; border-top: 1px solid #bfdbfe; }
          .payment-box { margin-top: 15px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fefce8; }
          .notes-box { margin-top: 15px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f0fdf4; }
          .terms { margin-top: 20px; padding: 15px; border: 2px solid #f59e0b; border-radius: 8px; background: #fffbeb; }
          .terms-title { font-weight: bold; margin-bottom: 10px; color: #92400e; }
          .terms-list { padding-right: 20px; font-size: 11px; color: #78350f; }
          .terms-list li { margin-bottom: 5px; }
          .signatures { margin-top: 25px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
          .signature-box { border: 2px solid #d1d5db; padding: 15px; text-align: center; border-radius: 8px; background: white; }
          .signature-label { margin-bottom: 40px; font-weight: bold; color: #374151; }
          .signature-line { border-top: 1px solid #000; margin-top: 40px; padding-top: 8px; font-size: 10px; }
          .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #6b7280; border-top: 2px solid #e2e8f0; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">${COMPANY_INFO.name_ar}</div>
          ${branchName ? `<div class="branch-name">🏢 فرع: ${branchName}</div>` : ''}
          <div class="tax-info">الرقم الضريبي: ${COMPANY_INFO.tax_number} | السجل التجاري: ${COMPANY_INFO.commercial_reg}</div>
        </div>
        
        <div class="form-title">📋 استمارة تسجيل - ${form.form_number}</div>
        
        <div class="section">
          <div class="section-title">👤 بيانات المشترك</div>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">الاسم:</span><span>${form.customer_name || '-'}</span></div>
            <div class="info-item"><span class="info-label">رقم الجوال:</span><span dir="ltr">${form.customer_phone || '-'}</span></div>
            <div class="info-item"><span class="info-label">التاريخ:</span><span>${new Date(form.created_at).toLocaleDateString('ar-SA')}</span></div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">📝 الأنشطة والمنتجات</div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>البند</th>
                <th>الفترة/الكمية</th>
                <th>المواعيد</th>
                <th>الرسوم</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
        </div>
        
        <div class="totals">
          ${form.discount > 0 ? `<div class="total-row" style="color:#dc2626;font-weight:500;border-bottom:1px solid #bfdbfe"><span>الخصم:</span><span>- ${form.discount?.toFixed(2)} ر.س</span></div>` : ''}
          <div class="total-row total-main"><span>💰 الإجمالي:</span><span>${form.total?.toFixed(2)} ر.س</span></div>
        </div>
        
        <div class="payment-box">
          <span style="font-weight:bold">💳 طريقة الدفع:</span> ${paymentText}
        </div>
        
        ${form.notes ? `<div class="notes-box"><strong>📌 ملاحظات:</strong> ${form.notes}</div>` : ''}
        
        <div class="terms">
          <div class="terms-title">⚠️ شروط وأحكام:</div>
          <ul class="terms-list">
            <li>الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك</li>
            <li>المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك</li>
          </ul>
        </div>
        
        <div class="signatures">
          <div class="signature-box">
            <div class="signature-label">✍️ توقيع المشترك / ولي الأمر</div>
            <div class="signature-line">التاريخ: _______________</div>
          </div>
          <div class="signature-box">
            <div class="signature-label">✍️ توقيع الموظف</div>
            <div class="signature-line">التاريخ: _______________</div>
          </div>
        </div>
        
        <div class="footer">${COMPANY_INFO.name_ar} - جميع الحقوق محفوظة © ${new Date().getFullYear()}</div>
      </body>
      </html>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
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
      fee: activity.monthly_fee || activity.fee || 0,
      start_date: today,
      end_date: endDate,
      period: `${today} - ${endDate}`,
      schedule: '',
      level_id: '',
      level_name: '',
      is_product: false,
      quantity: 1
    }]);
  };

  // Update registration form item level
  // State for registration form level capacity warning
  const [regFormLevelWarnings, setRegFormLevelWarnings] = useState({});
  
  // State for cascading level selector (registration form)
  const [regFormLevelSelectorState, setRegFormLevelSelectorState] = useState({});

  // Initialize level selector for reg form item
  const initRegFormLevelSelector = (index) => {
    setRegFormLevelSelectorState(prev => ({
      ...prev,
      [index]: { step: 'activity', selectedActivity: '', selectedTime: '' }
    }));
  };

  // Select activity in reg form level selector
  const selectRegFormLevelActivity = (index, activityId) => {
    setRegFormLevelSelectorState(prev => ({
      ...prev,
      [index]: { step: 'time', selectedActivity: activityId, selectedTime: '' }
    }));
  };

  // Select time in reg form level selector
  const selectRegFormLevelTime = (index, timeSlot) => {
    setRegFormLevelSelectorState(prev => ({
      ...prev,
      [index]: { ...prev[index], step: 'level', selectedTime: timeSlot }
    }));
  };

  // Go back in reg form level selector
  const goBackRegFormLevelSelector = (index) => {
    const current = regFormLevelSelectorState[index];
    if (!current) return;
    
    if (current.step === 'level') {
      setRegFormLevelSelectorState(prev => ({
        ...prev,
        [index]: { ...prev[index], step: 'time', selectedTime: '' }
      }));
    } else if (current.step === 'time') {
      setRegFormLevelSelectorState(prev => ({
        ...prev,
        [index]: { step: 'activity', selectedActivity: '', selectedTime: '' }
      }));
    }
  };

  // Reset reg form level selector
  const resetRegFormLevelSelector = (index) => {
    setRegFormLevelSelectorState(prev => {
      const newState = { ...prev };
      delete newState[index];
      return newState;
    });
  };

  const updateRegFormItemLevel = async (index, levelId) => {
    const updated = [...regFormItems];
    const level = levels.find(l => l.id === levelId);
    updated[index].level_id = levelId;
    updated[index].level_name = level ? `${language === 'ar' ? 'المستوى' : 'Level'} ${level.level_number} - ${level.activity_name}` : '';
    
    // Reset selector state after selection
    resetRegFormLevelSelector(index);
    
    // Check level capacity
    if (levelId) {
      try {
        const response = await levelsAPI.getMemberCount(levelId);
        const { is_full, member_count, max_capacity } = response.data;
        
        if (is_full) {
          // Show warning with accept/reject options
          setRegFormLevelWarnings(prev => ({
            ...prev,
            [index]: {
              isFull: true,
              isAccepted: false,
              memberCount: member_count,
              maxCapacity: max_capacity,
              message: language === 'ar' 
                ? `العدد في هذا المستوى مكتمل (${member_count}/${max_capacity} مشتركين)`
                : `This level is full (${member_count}/${max_capacity} members)`
            }
          }));
        } else {
          setRegFormLevelWarnings(prev => {
            const newWarnings = { ...prev };
            delete newWarnings[index];
            return newWarnings;
          });
        }
      } catch (error) {
        console.error('Error checking level capacity:', error);
      }
    } else {
      setRegFormLevelWarnings(prev => {
        const newWarnings = { ...prev };
        delete newWarnings[index];
        return newWarnings;
      });
    }
    
    setRegFormItems(updated);
  };

  // Accept full level warning for registration form
  const handleAcceptRegFormFullLevel = (index) => {
    setRegFormLevelWarnings(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        isAccepted: true
      }
    }));
    toast.success(language === 'ar' ? 'تم قبول التسجيل في هذا المستوى' : 'Registration accepted for this level');
  };

  // Reject full level for registration form
  const handleRejectRegFormFullLevel = (index) => {
    const updated = [...regFormItems];
    updated[index].level_id = '';
    updated[index].level_name = '';
    setRegFormItems(updated);
    setRegFormLevelWarnings(prev => {
      const newWarnings = { ...prev };
      delete newWarnings[index];
      return newWarnings;
    });
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
    setRegFormAdditionalMembers([]);
    setRegFormAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '' } });
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
    setCouponCode(''); setAppliedCoupon(null); setCouponDiscount(0);
    setItemType('activity');
    setFeeEditUnlocked(false);
    setAdditionalMembers([]);
    setAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
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
      {/* Member Card Print Position Dialog */}
      <Dialog open={showCardPrintDialog} onOpenChange={setShowCardPrintDialog}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-center text-gray-600 mb-2 font-bold">{cardPrintMember?.name_ar}</p>
            <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
            
            <div className="bg-gray-100 p-4 rounded-lg">
              <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                {/* Preview Card 1 - Member Card */}
                <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                  <span className="text-3xl">📇</span>
                  <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                  <span className="text-xs text-orange-500">خانة 1</span>
                </div>
                
                {/* Preview Card 2 - Academy Logo */}
                <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                  <img 
                    src="/images/academy-logo.png" 
                    alt="شعار الأكاديمية" 
                    className="w-14 h-14 object-contain"
                  />
                  <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                  <span className="text-xs text-orange-500">خانة 2</span>
                </div>
              </div>
              <p className="text-center text-xs text-gray-500 mt-3">
                📐 حجم كل كرت: 9سم × 6سم
              </p>
            </div>
            
            <div className="mt-4 flex justify-center">
              <Button
                onClick={handleStickerPrint}
                className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg"
              >
                <Printer className="w-5 h-5 ml-2" />
                طباعة الملصقات
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Registration Form Card Print Dialog */}
      <Dialog open={showRegFormCardPrintDialog} onOpenChange={setShowRegFormCardPrintDialog}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات - استمارة التسجيل</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-center text-gray-600 mb-2 font-bold">{regFormCardData?.name_ar}</p>
            <p className="text-center text-sm text-orange-600 mb-2 font-bold">#{regFormCardData?.member_code}</p>
            <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
            
            <div className="bg-gray-100 p-4 rounded-lg">
              <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                {/* Preview Card 1 - Member Card */}
                <div className="aspect-[9/6] w-[140px] bg-white border-2 border-purple-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                  <span className="text-3xl">📇</span>
                  <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                  <span className="text-xs text-purple-500">خانة 1</span>
                </div>
                
                {/* Preview Card 2 - Academy Logo */}
                <div className="aspect-[9/6] w-[140px] bg-white border-2 border-purple-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                  <img 
                    src="/images/academy-logo.png" 
                    alt="شعار الأكاديمية" 
                    className="w-14 h-14 object-contain"
                  />
                  <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                  <span className="text-xs text-purple-500">خانة 2</span>
                </div>
              </div>
              <p className="text-center text-xs text-gray-500 mt-3">
                📐 حجم كل كرت: 9سم × 6سم
              </p>
            </div>
            
            <div className="mt-4 flex justify-center">
              <Button
                onClick={handleRegFormStickerPrint}
                className="bg-purple-500 hover:bg-purple-600 text-white px-8 py-3 text-lg"
              >
                <Printer className="w-5 h-5 ml-2" />
                طباعة الملصقات
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                <FileSpreadsheet className="w-4 h-4 me-2" />{language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
              </Button>
              <Button variant="outline" onClick={() => {
                const token = localStorage.getItem('token');
                const url = exportAPI.invoicesPdf() + `&token=${token}`;
                window.open(url, '_blank');
              }}>
                <FileSpreadsheet className="w-4 h-4 me-2" />{language === 'ar' ? 'تصدير PDF' : 'Export PDF'}
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
                      {(activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{language === 'ar' ? a.name_ar : a.name}</SelectItem>)}
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
                    (filteredInvoices || []).map(invoice => (
                      <tr key={invoice.id}>
                        <td className="font-mono text-sm font-bold">#{invoice.invoice_number || invoice.id.slice(0, 8)}</td>
                        <td className="font-medium">
                          {invoice.customer_name_ar || invoice.member_name}
                          {invoice.member_code && <span className="text-primary font-bold text-sm ms-1">(#{invoice.member_code})</span>}
                        </td>
                        <td dir="ltr" className="text-sm">{invoice.customer_phone || '-'}</td>
                        <td className="font-bold text-primary">{invoice.total} {t('sar')}</td>
                        <td>{getStatusBadge(invoice.status)}</td>
                        <td className="text-sm text-muted-foreground">{new Date(invoice.created_at).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US')}</td>
                        <td>
                          <div className="action-buttons">
                            <button className="action-button" onClick={() => handleViewInvoice(invoice)} title={language === 'ar' ? 'عرض' : 'View'}><Eye className="w-4 h-4" /></button>
                            {invoice.member_code && (
                              <button className="action-button text-purple-600" onClick={() => handleOpenQRCard(invoice)} title={language === 'ar' ? 'بطاقة QR' : 'QR Card'}><QrCode className="w-4 h-4" /></button>
                            )}
                            <button className="action-button text-orange-600" onClick={() => handleOpenCardPrint(invoice)} title={language === 'ar' ? 'طباعة كرت العضوية' : 'Print Member Card'}><CreditCard className="w-4 h-4" /></button>
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
                            <button 
                              className={`action-button ${checkedInvoices[invoice.id] ? 'text-blue-600' : 'text-gray-400'}`}
                              onClick={() => setCheckedInvoices(prev => ({ ...prev, [invoice.id]: !prev[invoice.id] }))}
                              title={language === 'ar' ? 'تم' : 'Done'}
                            >
                              {checkedInvoices[invoice.id] ? <Check className="w-5 h-5 stroke-[3]" /> : <Check className="w-4 h-4" />}
                            </button>
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
                  <th>{language === 'ar' ? 'رقم العضوية' : 'Member ID'}</th>
                  <th>{language === 'ar' ? 'العميل' : 'Customer'}</th>
                  <th>{t('phone')}</th>
                  <th>{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                  <th>{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th>{t('invoice_date')}</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {registrationForms.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">
                      {language === 'ar' ? 'لا توجد استمارات تسجيل' : 'No registration forms'}
                    </td></tr>
                  ) : (
                    (registrationForms || []).map(form => (
                      <tr key={form.id}>
                        <td className="font-mono text-sm font-bold">#{form.form_number}</td>
                        <td className="font-mono text-sm font-bold text-orange-600">{form.member_code ? `#${form.member_code}` : '-'}</td>
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
                            <button 
                              className="action-button text-purple-600" 
                              onClick={() => handlePrintRegFormCard(form)}
                              title={language === 'ar' ? 'طباعة كارت العضوية' : 'Print Member Card'}
                            >
                              <QrCode className="w-4 h-4" />
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
                            <button 
                              className={`action-button ${checkedRegForms[form.id] ? 'text-blue-600' : 'text-gray-400'}`}
                              onClick={() => setCheckedRegForms(prev => ({ ...prev, [form.id]: !prev[form.id] }))}
                              title={language === 'ar' ? 'تم' : 'Done'}
                            >
                              {checkedRegForms[form.id] ? <Check className="w-5 h-5 stroke-[3]" /> : <Check className="w-4 h-4" />}
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
                    (creditNotes || []).map(cn => (
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
                    {(members || []).filter(m => m.id).map(m => <SelectItem key={m.id} value={m.id}>{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
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

              {/* Member's Current Activities */}
              {selectedMember && selectedMember.activities && selectedMember.activities.length > 0 && itemType === 'activity' && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-semibold text-blue-800 mb-3">
                    📋 {language === 'ar' ? `أنشطة ${selectedMember.name_ar || selectedMember.name} الحالية` : `${selectedMember.name_ar || selectedMember.name}'s Current Activities`}
                  </h4>
                  <div className="space-y-2">
                    {(selectedMember.activities || []).map((act, idx) => {
                      const isAlreadyAdded = invoiceItems.some(item => 
                        item.activity_id === act.activity_id && 
                        item.start_date === act.start_date && 
                        item.end_date === act.end_date
                      );
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
                              <Button 
                                type="button" 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  const activity = activities.find(a => a.id === act.activity_id);
                                  setInvoiceItems([...invoiceItems, {
                                    activity_id: act.activity_id,
                                    activity_name: act.activity_name,
                                    start_date: act.start_date,
                                    end_date: act.end_date,
                                    fee: act.fee || (activity ? activity.monthly_fee : 0),
                                    is_product: false
                                  }]);
                                  toast.success(language === 'ar' ? 'تم إضافة النشاط للفاتورة' : 'Activity added to invoice');
                                }}
                                className="text-blue-600 border-blue-300 hover:bg-blue-50"
                              >
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

              {/* Activity Selector */}
              {itemType === 'activity' && (
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'إضافة نشاط جديد' : 'Add new activity'}</Label>
                  <Select value="" onValueChange={addActivityToInvoice}>
                    <SelectTrigger data-testid="activity-selector">
                      <SelectValue placeholder={language === 'ar' ? '+ اختر نشاط لإضافته' : '+ Select activity to add'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(activities || []).filter(a => a.id).map(a => (
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
                      {products.filter(p => p.id && p.quantity > 0).map(p => (
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
                    {(invoiceItems || []).map((item, idx) => (
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
                            <div className="space-y-1 col-span-4">
                              <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                              <div className="flex flex-wrap gap-1">
                                {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => {
                                      const currentDays = item.training_days || [];
                                      const newDays = currentDays.includes(day)
                                        ? currentDays.filter(d => d !== day)
                                        : [...currentDays, day];
                                      const updated = [...invoiceItems];
                                      updated[idx].training_days = newDays;
                                      // Format schedule: "الأحد، الإثنين، الثلاثاء و الأربعاء - 04:00 م"
                                      const formatSchedule = (days, time) => {
                                        if (days.length === 0) return time || '';
                                        const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                        const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                        let daysStr;
                                        if (sortedDays.length === 1) {
                                          daysStr = sortedDays[0];
                                        } else {
                                          const lastDay = sortedDays.pop();
                                          daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                        }
                                        return time ? `${daysStr} - ${time}` : daysStr;
                                      };
                                      updated[idx].schedule = formatSchedule(newDays, item.training_time);
                                      setInvoiceItems(updated);
                                    }}
                                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                                      (item.training_days || []).includes(day)
                                        ? 'bg-blue-500 text-white border-blue-500'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-1 col-span-2">
                              <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                              <Input 
                                type="number"
                                min="1"
                                max="12"
                                value={item.training_time_hour || ''} 
                                onChange={(e) => {
                                  const hour = e.target.value;
                                  const updated = [...invoiceItems];
                                  updated[idx].training_time_hour = hour;
                                  // Auto convert to time format (e.g., 4 → 4:00 م)
                                  const timeStr = hour ? `${hour}:00 م` : '';
                                  updated[idx].training_time = timeStr;
                                  // Format schedule: "الأحد، الإثنين، الثلاثاء و الأربعاء - 04:00 م"
                                  const formatSchedule = (days, time) => {
                                    if (!days || days.length === 0) return time || '';
                                    const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                    const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                    let daysStr;
                                    if (sortedDays.length === 1) {
                                      daysStr = sortedDays[0];
                                    } else {
                                      const lastDay = sortedDays.pop();
                                      daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                    }
                                    return time ? `${daysStr} - ${time}` : daysStr;
                                  };
                                  updated[idx].schedule = formatSchedule(updated[idx].training_days, timeStr);
                                  setInvoiceItems(updated);
                                }} 
                                className="h-8 text-sm" 
                                placeholder={language === 'ar' ? 'مثال: 4' : 'e.g. 4'}
                              />
                              {item.training_time && (
                                <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>
                              )}
                            </div>
                            <div className="space-y-1 col-span-3">
                              <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                              
                              {/* Cascading Level Selector */}
                              {!levelSelectorState[idx] ? (
                                // Show current selection or trigger button
                                <div>
                                  {item.level_id ? (
                                    <div className={`flex items-center justify-between p-2 border rounded-lg ${levelCapacityWarnings[idx]?.isFull && !levelCapacityWarnings[idx]?.isAccepted ? 'border-orange-500 border-2 bg-orange-50' : levelCapacityWarnings[idx]?.isAccepted ? 'border-green-500 border-2 bg-green-50' : 'bg-gray-50'}`}>
                                      <span className="text-sm">{item.level_name}</span>
                                      <div className="flex gap-1">
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => initLevelSelector(idx)}>
                                          {language === 'ar' ? 'تغيير' : 'Change'}
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={() => updateItemLevel(idx, '')}>
                                          ✕
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <Button 
                                      type="button" 
                                      variant="outline" 
                                      className="w-full h-8 text-sm justify-start gap-2"
                                      onClick={() => initLevelSelector(idx)}
                                    >
                                      <span>🎯</span>
                                      {language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                // Cascading selector UI
                                <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                                  {/* Header with back button */}
                                  <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
                                    <div className="flex items-center gap-2">
                                      {levelSelectorState[idx].step !== 'activity' && (
                                        <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => goBackLevelSelector(idx)}>
                                          {language === 'ar' ? '→' : '←'}
                                        </Button>
                                      )}
                                      <span className="text-xs font-medium text-gray-600">
                                        {levelSelectorState[idx].step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                        {levelSelectorState[idx].step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                        {levelSelectorState[idx].step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                      </span>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => resetLevelSelector(idx)}>
                                      ✕
                                    </Button>
                                  </div>
                                  
                                  {/* Step 1: Activities */}
                                  {levelSelectorState[idx].step === 'activity' && (
                                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                      {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                        const activityLevels = groupedLevelsForSelector[activity.id] || {};
                                        const timeCount = Object.keys(activityLevels).length;
                                        if (timeCount === 0) return null;
                                        return (
                                          <button
                                            key={activity.id}
                                            type="button"
                                            className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10 hover:bg-opacity-20`}
                                            onClick={() => selectLevelActivity(idx, activity.id)}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-xl">{activity.icon}</span>
                                              <span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-gray-500">
                                              <span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span>
                                              <span>{language === 'ar' ? '←' : '→'}</span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                      {/* Other activities */}
                                      {groupedLevelsForSelector['other'] && Object.keys(groupedLevelsForSelector['other']).length > 0 && (
                                        <button
                                          type="button"
                                          className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors bg-gray-100"
                                          onClick={() => selectLevelActivity(idx, 'other')}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-xl">📋</span>
                                            <span className="font-medium">{language === 'ar' ? 'أخرى' : 'Other'}</span>
                                          </div>
                                          <span>{language === 'ar' ? '←' : '→'}</span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Step 2: Time Slots */}
                                  {levelSelectorState[idx].step === 'time' && (
                                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                      {Object.entries(groupedLevelsForSelector[levelSelectorState[idx].selectedActivity] || {}).map(([timeSlot, timeLevels]) => {
                                        const totalMembers = timeLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
                                        const totalCapacity = timeLevels.reduce((sum, l) => sum + (levelSelectorState[idx].selectedActivity === 'swimming' ? 6 : (l.capacity || 10)), 0);
                                        return (
                                          <button
                                            key={timeSlot}
                                            type="button"
                                            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border"
                                            onClick={() => selectLevelTime(idx, timeSlot)}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-lg">🕐</span>
                                              <span className="font-medium text-sm">{timeSlot}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-gray-500">
                                                {timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}
                                              </span>
                                              <span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  
                                  {/* Step 3: Levels */}
                                  {levelSelectorState[idx].step === 'level' && (
                                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                      {(groupedLevelsForSelector[levelSelectorState[idx].selectedActivity]?.[levelSelectorState[idx].selectedTime] || [])
                                        .sort((a, b) => a.level_number - b.level_number)
                                        .map(level => {
                                          const memberCount = (level.members || []).length;
                                          const maxCapacity = levelSelectorState[idx].selectedActivity === 'swimming' ? 6 : (level.capacity || 10);
                                          const isFull = memberCount >= maxCapacity;
                                          const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                          return (
                                            <button
                                              key={level.id}
                                              type="button"
                                              className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`}
                                              onClick={() => updateItemLevel(idx, level.id)}
                                            >
                                              <div className="flex items-center justify-between mb-1">
                                                <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>
                                                  {language === 'ar' ? 'المستوى' : 'Level'} {level.level_number}
                                                </span>
                                                <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>
                                                  {memberCount}/{maxCapacity} {isFull && '⚠️'}
                                                </span>
                                              </div>
                                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                                <div 
                                                  className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`}
                                                  style={{ width: `${Math.min(fillPercent, 100)}%` }}
                                                />
                                              </div>
                                            </button>
                                          );
                                        })}
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {levelCapacityWarnings[idx]?.isFull && !levelCapacityWarnings[idx]?.isAccepted && (
                                <div className="mt-2 p-2 bg-orange-50 border border-orange-300 rounded-lg">
                                  <p className="text-xs text-orange-700 font-medium mb-2">
                                    ⚠️ {levelCapacityWarnings[idx].message}
                                  </p>
                                  <div className="flex gap-2">
                                    <Button 
                                      type="button"
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 text-white text-xs h-7"
                                      onClick={() => handleAcceptFullLevel(idx)}
                                    >
                                      ✓ {language === 'ar' ? 'موافق' : 'Accept'}
                                    </Button>
                                    <Button 
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="border-red-500 text-red-600 hover:bg-red-50 text-xs h-7"
                                      onClick={() => handleRejectFullLevel(idx)}
                                    >
                                      ✗ {language === 'ar' ? 'رفض' : 'Reject'}
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {levelCapacityWarnings[idx]?.isAccepted && (
                                <p className="text-xs text-green-600 font-medium mt-1">
                                  ✓ {language === 'ar' ? 'تم قبول التسجيل رغم اكتمال العدد' : 'Registration accepted despite full capacity'}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional Members Section */}
              {!isEditMode && (
                <Card className="p-4 border-blue-200 bg-blue-50/30">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-blue-800 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      {language === 'ar' ? 'أعضاء إضافيين (إخوة)' : 'Additional Members (Siblings)'}
                    </h4>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-blue-400 text-blue-700 hover:bg-blue-100"
                      onClick={() => setAdditionalMembers([...additionalMembers, { member: null, items: [] }])}
                    >
                      <UserPlus className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'إضافة عضو آخر' : 'Add Another Member'}
                    </Button>
                  </div>
                  {additionalMembers.length > 0 && (
                    <div className="space-y-4">
                      {additionalMembers.map((am, amIdx) => (
                        <div key={amIdx} className="p-3 bg-white rounded-lg border border-blue-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-blue-700">
                              {language === 'ar' ? `العضو ${amIdx + 2}` : `Member ${amIdx + 2}`}
                              {am.member && ` - ${am.member.name_ar || am.member.name}`}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-red-500 h-7 w-7 p-0"
                              onClick={() => setAdditionalMembers(additionalMembers.filter((_, i) => i !== amIdx))}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                          <Select
                            value={am.member?.id || 'none'}
                            onValueChange={(val) => {
                              if (val === 'none') return;
                              if (val === 'new_member') {
                                setAdditionalMemberNewForm({ show: true, index: amIdx, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
                                return;
                              }
                              const member = members.find(m => m.id === val);
                              const updated = [...additionalMembers];
                              updated[amIdx] = { ...updated[amIdx], member };
                              setAdditionalMembers(updated);
                            }}
                          >
                            <SelectTrigger className="mb-2">
                              <SelectValue placeholder={language === 'ar' ? 'اختر العضو...' : 'Select member...'} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{language === 'ar' ? '-- اختر --' : '-- Select --'}</SelectItem>
                              <SelectItem value="new_member" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                              {(members || []).filter(m => m.id && m.id !== selectedMember?.id && !additionalMembers.some((a, i) => i !== amIdx && a.member?.id === m.id))
                                .map(m => <SelectItem key={m.id} value={m.id}>{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {additionalMemberNewForm.show && additionalMemberNewForm.index === amIdx && (
                            <div className="p-3 mb-2 bg-green-50 border border-green-300 rounded-lg space-y-2">
                              <h5 className="text-sm font-bold text-green-800">{language === 'ar' ? 'إضافة عضو جديد' : 'Add New Member'}</h5>
                              <Input placeholder={language === 'ar' ? 'اسم العميل *' : 'Customer name *'} value={additionalMemberNewForm.data.name_ar} onChange={(e) => setAdditionalMemberNewForm(prev => ({ ...prev, data: { ...prev.data, name_ar: e.target.value } }))} />
                              <div className="flex gap-2 justify-end">
                                <Button type="button" size="sm" variant="outline" onClick={() => setAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } })}>
                                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                                </Button>
                                <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700" disabled={!additionalMemberNewForm.data.name_ar} onClick={async () => {
                                  try {
                                    const res = await membersAPI.create({
                                      name_ar: additionalMemberNewForm.data.name_ar,
                                      name: additionalMemberNewForm.data.name_ar,
                                      phone: '',
                                      status: 'active'
                                    });
                                    const newMember = res.data;
                                    setMembers(prev => [...prev, newMember]);
                                    const updated = [...additionalMembers];
                                    updated[amIdx] = { ...updated[amIdx], member: newMember };
                                    setAdditionalMembers(updated);
                                    setAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '', name: '', age: '', guardian_name_ar: '', guardian_name: '', phone: '' } });
                                    toast.success(language === 'ar' ? 'تم إضافة العضو بنجاح' : 'Member added successfully');
                                  } catch (error) {
                                    toast.error(language === 'ar' ? 'خطأ في إضافة العضو' : 'Error adding member');
                                  }
                                }}>
                                  <UserPlus className="w-4 h-4 me-1" />
                                  {language === 'ar' ? 'حفظ' : 'Save'}
                                </Button>
                              </div>
                            </div>
                          )}
                          {am.member && (
                            <>
                              <Select
                                value=""
                                onValueChange={(actId) => {
                                  const activity = activities.find(a => a.id === actId);
                                  if (!activity) return;
                                  const today = new Date().toISOString().split('T')[0];
                                  const endDate = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0];
                                  const newItem = {
                                    activity_id: activity.id,
                                    activity_name: activity.name_ar || activity.name,
                                    fee: activity.monthly_fee || 0,
                                    period: `${today} - ${endDate}`,
                                    schedule: activity.schedule || '',
                                    start_date: today,
                                    end_date: endDate,
                                    is_product: false
                                  };
                                  const updated = [...additionalMembers];
                                  updated[amIdx] = { ...updated[amIdx], items: [...updated[amIdx].items, newItem] };
                                  setAdditionalMembers(updated);
                                }}
                              >
                                <SelectTrigger className="mb-2">
                                  <SelectValue placeholder={language === 'ar' ? '+ اختر نشاط...' : '+ Select activity...'} />
                                </SelectTrigger>
                                <SelectContent>
                                  {(activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name} - {a.monthly_fee} {language === 'ar' ? 'ر.س' : 'SAR'}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              {am.items.length > 0 && (
                                <div className="space-y-2">
                                  {am.items.map((item, itemIdx) => (
                                    <div key={itemIdx} className="p-2 bg-blue-50 rounded text-sm space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium">{item.activity_name}</span>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            type="number"
                                            value={item.fee}
                                            onChange={(e) => {
                                              const updated = [...additionalMembers];
                                              updated[amIdx].items[itemIdx].fee = parseFloat(e.target.value) || 0;
                                              setAdditionalMembers(updated);
                                            }}
                                            className="w-20 h-7 text-sm text-center"
                                          />
                                          <span className="text-xs text-muted-foreground">{language === 'ar' ? 'ر.س' : 'SAR'}</span>
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0 text-red-500"
                                            onClick={() => {
                                              const updated = [...additionalMembers];
                                              updated[amIdx].items = updated[amIdx].items.filter((_, i) => i !== itemIdx);
                                              setAdditionalMembers(updated);
                                            }}
                                          >
                                            <X className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      </div>
                                      {!item.is_product && (
                                        <div className="space-y-2">
                                          <div className="space-y-1">
                                            <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                                            <div className="flex flex-wrap gap-1">
                                              {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                                                <button
                                                  key={day}
                                                  type="button"
                                                  onClick={() => {
                                                    const currentDays = item.training_days || [];
                                                    const newDays = currentDays.includes(day)
                                                      ? currentDays.filter(d => d !== day)
                                                      : [...currentDays, day];
                                                    const updated = [...additionalMembers];
                                                    updated[amIdx].items[itemIdx].training_days = newDays;
                                                    const formatSchedule = (days, time) => {
                                                      if (days.length === 0) return time || '';
                                                      const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                                      const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                                      let daysStr;
                                                      if (sortedDays.length === 1) {
                                                        daysStr = sortedDays[0];
                                                      } else {
                                                        const lastDay = sortedDays.pop();
                                                        daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                                      }
                                                      return time ? `${daysStr} - ${time}` : daysStr;
                                                    };
                                                    updated[amIdx].items[itemIdx].schedule = formatSchedule(newDays, item.training_time);
                                                    setAdditionalMembers(updated);
                                                  }}
                                                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                                                    (item.training_days || []).includes(day)
                                                      ? 'bg-blue-500 text-white border-blue-500'
                                                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                                  }`}
                                                >
                                                  {day}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                          <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                              <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                                              <Input
                                                type="number"
                                                min="1"
                                                max="12"
                                                placeholder={language === 'ar' ? 'مثال: 4' : 'e.g., 4'}
                                                value={item.training_time_hour || ''}
                                                onChange={(e) => {
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
                                                    if (sortedDays.length === 1) {
                                                      daysStr = sortedDays[0];
                                                    } else {
                                                      const lastDay = sortedDays.pop();
                                                      daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                                    }
                                                    return time ? `${daysStr} - ${time}` : daysStr;
                                                  };
                                                  updated[amIdx].items[itemIdx].schedule = formatSchedule(updated[amIdx].items[itemIdx].training_days, timeStr);
                                                  setAdditionalMembers(updated);
                                                }}
                                                className="h-7 text-sm"
                                              />
                                              {item.training_time && (
                                                <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>
                                              )}
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                                              <Select
                                                value={item.level_id || 'none'}
                                                onValueChange={(val) => {
                                                  const updated = [...additionalMembers];
                                                  if (val === 'none') {
                                                    updated[amIdx].items[itemIdx].level_id = '';
                                                    updated[amIdx].items[itemIdx].level_name = '';
                                                  } else {
                                                    const level = levels.find(l => l.id === val);
                                                    const levelLabel = level ? `${level.activity_name || ''} - ${language === 'ar' ? 'مستوى' : 'Level'} ${level.level_number}` : '';
                                                    updated[amIdx].items[itemIdx].level_id = val;
                                                    updated[amIdx].items[itemIdx].level_name = levelLabel;
                                                  }
                                                  setAdditionalMembers(updated);
                                                }}
                                              >
                                                <SelectTrigger className="h-7 text-sm">
                                                  <SelectValue placeholder={language === 'ar' ? 'اختياري' : 'Optional'} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="none">{language === 'ar' ? '-- بدون --' : '-- None --'}</SelectItem>
                                                  {(levels || []).filter(l => l.id && (l.activity_name === item.activity_name || !l.activity_name)).map(l => (
                                                    <SelectItem key={l.id} value={l.id}>{l.activity_name} - {language === 'ar' ? 'مستوى' : 'Level'} {l.level_number}</SelectItem>
                                                  ))}
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

              {(invoiceItems.length > 0 || additionalMembers.some(am => am.items.length > 0)) && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  {additionalMembers.some(am => am.items.length > 0) && (
                    <div className="mb-2 pb-2 border-b border-primary/10">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{language === 'ar' ? 'العضو الأساسي' : 'Primary member'}</span>
                        <span>{invoiceItems.reduce((s, i) => s + i.fee, 0).toFixed(2)} {t('sar')}</span>
                      </div>
                      {additionalMembers.filter(am => am.member && am.items.length > 0).map((am, i) => (
                        <div key={i} className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>{am.member.name_ar || am.member.name}</span>
                          <span>{am.items.reduce((s, item) => s + item.fee, 0).toFixed(2)} {t('sar')}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
                    <p><strong>{language === 'ar' ? 'الاسم' : 'Name'}:</strong> {selectedInvoice.customer_name_ar || selectedInvoice.member_name} {selectedInvoice.member_code && <span className="text-primary font-bold">(#{selectedInvoice.member_code})</span>}</p>
                    <p><strong>{t('phone')}:</strong> <span dir="ltr">{selectedInvoice.customer_phone || '-'}</span></p>
                    {selectedInvoice.customer_address && <p className="col-span-2"><strong>{language === 'ar' ? 'العنوان' : 'Address'}:</strong> {selectedInvoice.customer_address}</p>}
                  </div>
                </div>

                <table className="w-full border-collapse mb-4">
                  <thead><tr className="bg-muted">
                    {selectedInvoice.additional_members?.length > 0 && <th className="border p-2 text-start">{language === 'ar' ? 'العضو' : 'Member'}</th>}
                    <th className="border p-2 text-start">{t('activity_name')}</th><th className="border p-2 text-start">{language === 'ar' ? 'الفترة' : 'Period'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المواعيد' : 'Schedule'}</th><th className="border p-2 text-start">{language === 'ar' ? 'المبلغ' : 'Amount'}</th></tr></thead>
                  <tbody>{(selectedInvoice.items || []).map((item, idx) => <tr key={idx}>
                    {selectedInvoice.additional_members?.length > 0 && <td className="border p-2 text-xs text-blue-700 font-medium">{item.member_name || selectedInvoice.customer_name_ar || '-'}</td>}
                    <td className="border p-2">{item.activity_name}</td><td className="border p-2 text-sm">{item.period}</td><td className="border p-2 text-sm text-blue-700 schedule-cell font-medium">{item.schedule || '-'}</td><td className="border p-2">{item.fee} {t('sar')}</td></tr>)}</tbody>
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

                <div className="mt-4 p-3 border-2 border-purple-400 rounded-lg" style={{WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact'}}>
                  <p className="text-xs font-bold text-purple-800 mb-2" style={{color: '#6b21a8'}}>🏆 {language === 'ar' ? 'برنامج نقاط الولاء' : 'Loyalty Points Program'}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{color: '#7e22ce'}}>
                    <span>✅ {language === 'ar' ? 'كل حضور: 10 نقاط' : 'Each attendance: 10 pts'}</span>
                    <span>🔥 {language === 'ar' ? 'سلسلة 5 أيام: 50 نقطة' : '5-day streak: 50 pts'}</span>
                    <span>📺 {language === 'ar' ? 'مشاهدة فيديو: 3 نقاط' : 'Watch video: 3 pts'}</span>
                    <span>👥 {language === 'ar' ? 'إحالة صديق: 200 نقطة' : 'Referral: 200 pts'}</span>
                    <span>🔄 {language === 'ar' ? 'تجديد شهري: 100 نقطة' : 'Monthly renewal: 100 pts'}</span>
                    <span>🎂 {language === 'ar' ? 'عيد ميلاد: 100 نقطة' : 'Birthday: 100 pts'}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-purple-400">
                    <p className="text-xs font-bold mb-1" style={{color: '#6b21a8'}}>{language === 'ar' ? 'المستويات والمزايا:' : 'Levels & Benefits:'}</p>
                    <div className="flex justify-between text-xs" style={{color: '#7e22ce'}}>
                      <span>🥉 {language === 'ar' ? 'برونزي: 0+' : 'Bronze: 0+'}</span>
                      <span>🥈 {language === 'ar' ? 'فضي: 500+ (خصم 3%)' : 'Silver: 500+ (3% off)'}</span>
                      <span>🥇 {language === 'ar' ? 'ذهبي: 1500+ (خصم 5%)' : 'Gold: 1500+ (5% off)'}</span>
                      <span>💎 {language === 'ar' ? 'ماسي: 3000+ (خصم 10%)' : 'Diamond: 3000+ (10% off)'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
                  <p>{COMPANY_INFO.name_ar} | {COMPANY_INFO.name_en}</p>
                  <p className="mt-1 font-semibold text-orange-600">🏢 {getBranchName(selectedInvoice.branch_id)}</p>
                  <div className="flex justify-center gap-6 mt-2"><span>{language === 'ar' ? 'الرقم الضريبي' : 'Tax Number'}: {COMPANY_INFO.tax_number}</span><span>{language === 'ar' ? 'السجل التجاري' : 'Commercial Reg'}: {COMPANY_INFO.commercial_reg}</span></div>
                </div>
              </div>
            )}
            <DialogFooter className="flex flex-col gap-3 sm:flex-col">
              <div className="flex flex-wrap gap-2 justify-center border-b pb-3">
                <Button variant="outline" onClick={handlePrint} size="sm"><Printer className="w-4 h-4 me-1" />{t('print')}</Button>
                <Button variant="outline" onClick={handleShareWhatsApp} disabled={sharingWhatsApp} size="sm" className="bg-green-50 border-green-400 text-green-700 hover:bg-green-100">
                  {sharingWhatsApp ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <MessageSquare className="w-4 h-4 me-1" />}
                  {language === 'ar' ? 'واتساب' : 'WhatsApp'}
                </Button>
                <Button variant="outline" onClick={handleSaveAsPdfOnly} disabled={savingPdf} size="sm" className="bg-blue-50 border-blue-400 text-blue-700 hover:bg-blue-100">
                  {savingPdf ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <FileText className="w-4 h-4 me-1" />}
                  PDF
                </Button>
                <Button variant="outline" onClick={handleSaveAsPdf} disabled={savingPdf} size="sm" className="bg-emerald-50 border-emerald-400 text-emerald-700 hover:bg-emerald-100">
                  {savingPdf ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <MessageSquare className="w-4 h-4 me-1" />}
                  PDF + {language === 'ar' ? 'واتساب' : 'WA'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button variant="outline" onClick={handlePrintRegistrationForm} size="sm" className="bg-gray-800 border-gray-700 text-white hover:bg-gray-900">
                  <FileText className="w-4 h-4 me-1" />
                  {language === 'ar' ? 'استمارة تسجيل' : 'Registration Form'}
                </Button>
                {selectedInvoice?.status === 'pending' && <Button variant="outline" size="sm" className="text-blue-600 border-blue-300" onClick={() => openEditDialog(selectedInvoice)}><Edit className="w-4 h-4 me-1" />{language === 'ar' ? 'تعديل' : 'Edit'}</Button>}
                {selectedInvoice?.status === 'pending' && <Button size="sm" onClick={() => handleMarkPaid(selectedInvoice.id)}><CheckCircle className="w-4 h-4 me-1" />{language === 'ar' ? 'تم الدفع' : 'Mark Paid'}</Button>}
                {selectedInvoice?.status === 'cancelled' && <Button variant="outline" size="sm" onClick={() => handleRestoreInvoice(selectedInvoice.id)}><RotateCcw className="w-4 h-4 me-1" />{language === 'ar' ? 'استرجاع' : 'Restore'}</Button>}
                {selectedInvoice?.status === 'paid' && <Button variant="outline" size="sm" className="text-purple-600 border-purple-300" onClick={() => { setIsViewDialogOpen(false); openRefundDialog(selectedInvoice); }}><RefreshCcw className="w-4 h-4 me-1" />{language === 'ar' ? 'استرجاع مبلغ' : 'Refund'}</Button>}
                {isAdmin && <Button variant="destructive" size="sm" onClick={() => handleDeleteInvoice(selectedInvoice?.id, selectedInvoice?.status)}><Trash2 className="w-4 h-4 me-1" />{language === 'ar' ? 'حذف' : 'Delete'}</Button>}
                <Button variant="outline" size="sm" onClick={() => setIsViewDialogOpen(false)}>{t('close')}</Button>
              </div>
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
                        {(members || []).map(m => (
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
                      {(activities || []).map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {language === 'ar' ? a.name_ar : a.name} - {a.monthly_fee} {t('sar')}
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
                      {products.filter(p => p.id && p.quantity > 0).map(p => (
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
                  {(regFormItems || []).map((item, idx) => (
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
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                            <div className="flex flex-wrap gap-1">
                              {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => {
                                    const currentDays = item.training_days || [];
                                    const newDays = currentDays.includes(day)
                                      ? currentDays.filter(d => d !== day)
                                      : [...currentDays, day];
                                    const updated = [...regFormItems];
                                    updated[idx].training_days = newDays;
                                    // Format schedule: "الأحد، الإثنين، الثلاثاء و الأربعاء - 04:00 م"
                                    const formatSchedule = (days, time) => {
                                      if (days.length === 0) return time || '';
                                      const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                      const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                      let daysStr;
                                      if (sortedDays.length === 1) {
                                        daysStr = sortedDays[0];
                                      } else {
                                        const lastDay = sortedDays.pop();
                                        daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                      }
                                      return time ? `${daysStr} - ${time}` : daysStr;
                                    };
                                    updated[idx].schedule = formatSchedule(newDays, item.training_time);
                                    setRegFormItems(updated);
                                  }}
                                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                                    (item.training_days || []).includes(day)
                                      ? 'bg-blue-500 text-white border-blue-500'
                                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                  }`}
                                >
                                  {day}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                              <Input 
                                type="number"
                                min="1"
                                max="12"
                                placeholder={language === 'ar' ? 'مثال: 4' : 'e.g., 4'}
                                value={item.training_time_hour || ''}
                                onChange={(e) => {
                                  const hour = e.target.value;
                                  const updated = [...regFormItems];
                                  updated[idx].training_time_hour = hour;
                                  // Auto convert to time format (e.g., 4 → 4:00 م)
                                  const timeStr = hour ? `${hour}:00 م` : '';
                                  updated[idx].training_time = timeStr;
                                  // Format schedule: "الأحد، الإثنين، الثلاثاء و الأربعاء - 04:00 م"
                                  const formatSchedule = (days, time) => {
                                    if (!days || days.length === 0) return time || '';
                                    const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                    const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                    let daysStr;
                                    if (sortedDays.length === 1) {
                                      daysStr = sortedDays[0];
                                    } else {
                                      const lastDay = sortedDays.pop();
                                      daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                    }
                                    return time ? `${daysStr} - ${time}` : daysStr;
                                  };
                                  updated[idx].schedule = formatSchedule(updated[idx].training_days, timeStr);
                                  setRegFormItems(updated);
                                }}
                                className="text-sm"
                              />
                              {item.training_time && (
                                <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                              
                              {/* Cascading Level Selector for Registration Form */}
                              {!regFormLevelSelectorState[idx] ? (
                                // Show current selection or trigger button
                                <div>
                                  {item.level_id ? (
                                    <div className={`flex items-center justify-between p-2 border rounded-lg ${regFormLevelWarnings[idx]?.isFull && !regFormLevelWarnings[idx]?.isAccepted ? 'border-orange-500 border-2 bg-orange-50' : regFormLevelWarnings[idx]?.isAccepted ? 'border-green-500 border-2 bg-green-50' : 'bg-gray-50'}`}>
                                      <span className="text-sm">{item.level_name}</span>
                                      <div className="flex gap-1">
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => initRegFormLevelSelector(idx)}>
                                          {language === 'ar' ? 'تغيير' : 'Change'}
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-red-500" onClick={() => updateRegFormItemLevel(idx, '')}>
                                          ✕
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <Button 
                                      type="button" 
                                      variant="outline" 
                                      className="w-full h-8 text-sm justify-start gap-2"
                                      onClick={() => initRegFormLevelSelector(idx)}
                                    >
                                      <span>🎯</span>
                                      {language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                // Cascading selector UI
                                <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                                  {/* Header with back button */}
                                  <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
                                    <div className="flex items-center gap-2">
                                      {regFormLevelSelectorState[idx].step !== 'activity' && (
                                        <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => goBackRegFormLevelSelector(idx)}>
                                          {language === 'ar' ? '→' : '←'}
                                        </Button>
                                      )}
                                      <span className="text-xs font-medium text-gray-600">
                                        {regFormLevelSelectorState[idx].step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
                                        {regFormLevelSelectorState[idx].step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
                                        {regFormLevelSelectorState[idx].step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
                                      </span>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => resetRegFormLevelSelector(idx)}>
                                      ✕
                                    </Button>
                                  </div>
                                  
                                  {/* Step 1: Activities */}
                                  {regFormLevelSelectorState[idx].step === 'activity' && (
                                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                      {MAIN_ACTIVITIES_FOR_LEVELS.map(activity => {
                                        const activityLevels = groupedLevelsForSelector[activity.id] || {};
                                        const timeCount = Object.keys(activityLevels).length;
                                        if (timeCount === 0) return null;
                                        return (
                                          <button
                                            key={activity.id}
                                            type="button"
                                            className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10 hover:bg-opacity-20`}
                                            onClick={() => selectRegFormLevelActivity(idx, activity.id)}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-xl">{activity.icon}</span>
                                              <span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-gray-500">
                                              <span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span>
                                              <span>{language === 'ar' ? '←' : '→'}</span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                      {groupedLevelsForSelector['other'] && Object.keys(groupedLevelsForSelector['other']).length > 0 && (
                                        <button
                                          type="button"
                                          className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors bg-gray-100"
                                          onClick={() => selectRegFormLevelActivity(idx, 'other')}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-xl">📋</span>
                                            <span className="font-medium">{language === 'ar' ? 'أخرى' : 'Other'}</span>
                                          </div>
                                          <span>{language === 'ar' ? '←' : '→'}</span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Step 2: Time Slots */}
                                  {regFormLevelSelectorState[idx].step === 'time' && (
                                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                      {Object.entries(groupedLevelsForSelector[regFormLevelSelectorState[idx].selectedActivity] || {}).map(([timeSlot, timeLevels]) => {
                                        const totalMembers = timeLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
                                        const totalCapacity = timeLevels.reduce((sum, l) => sum + (regFormLevelSelectorState[idx].selectedActivity === 'swimming' ? 6 : (l.capacity || 10)), 0);
                                        return (
                                          <button
                                            key={timeSlot}
                                            type="button"
                                            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border"
                                            onClick={() => selectRegFormLevelTime(idx, timeSlot)}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-lg">🕐</span>
                                              <span className="font-medium text-sm">{timeSlot}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-gray-500">
                                                {timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}
                                              </span>
                                              <span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  
                                  {/* Step 3: Levels */}
                                  {regFormLevelSelectorState[idx].step === 'level' && (
                                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                                      {(groupedLevelsForSelector[regFormLevelSelectorState[idx].selectedActivity]?.[regFormLevelSelectorState[idx].selectedTime] || [])
                                        .sort((a, b) => a.level_number - b.level_number)
                                        .map(level => {
                                          const memberCount = (level.members || []).length;
                                          const maxCapacity = regFormLevelSelectorState[idx].selectedActivity === 'swimming' ? 6 : (level.capacity || 10);
                                          const isFull = memberCount >= maxCapacity;
                                          const fillPercent = Math.round((memberCount / maxCapacity) * 100);
                                          return (
                                            <button
                                              key={level.id}
                                              type="button"
                                              className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`}
                                              onClick={() => updateRegFormItemLevel(idx, level.id)}
                                            >
                                              <div className="flex items-center justify-between mb-1">
                                                <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>
                                                  {language === 'ar' ? 'المستوى' : 'Level'} {level.level_number}
                                                </span>
                                                <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>
                                                  {memberCount}/{maxCapacity} {isFull && '⚠️'}
                                                </span>
                                              </div>
                                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                                <div 
                                                  className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`}
                                                  style={{ width: `${Math.min(fillPercent, 100)}%` }}
                                                />
                                              </div>
                                            </button>
                                          );
                                        })}
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {regFormLevelWarnings[idx]?.isFull && !regFormLevelWarnings[idx]?.isAccepted && (
                                <div className="mt-2 p-2 bg-orange-50 border border-orange-300 rounded-lg">
                                  <p className="text-xs text-orange-700 font-medium mb-2">
                                    ⚠️ {regFormLevelWarnings[idx].message}
                                  </p>
                                  <div className="flex gap-2">
                                    <Button 
                                      type="button"
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 text-white text-xs h-7"
                                      onClick={() => handleAcceptRegFormFullLevel(idx)}
                                    >
                                      ✓ {language === 'ar' ? 'موافق' : 'Accept'}
                                    </Button>
                                    <Button 
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="border-red-500 text-red-600 hover:bg-red-50 text-xs h-7"
                                      onClick={() => handleRejectRegFormFullLevel(idx)}
                                    >
                                      ✗ {language === 'ar' ? 'رفض' : 'Reject'}
                                    </Button>
                                  </div>
                                </div>
                              )}
                              {regFormLevelWarnings[idx]?.isAccepted && (
                                <p className="text-xs text-green-600 font-medium mt-1">
                                  ✓ {language === 'ar' ? 'تم قبول التسجيل رغم اكتمال العدد' : 'Registration accepted despite full capacity'}
                                </p>
                              )}
                            </div>
                          </div>
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

              {/* Additional Members (Siblings) for Registration Form */}
              <Card className="p-3 border-blue-200 bg-blue-50/30">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-blue-700 flex items-center gap-2">
                    <UserPlus className="w-4 h-4" />
                    {language === 'ar' ? 'أعضاء إضافيين (إخوة)' : 'Additional Members (Siblings)'}
                  </h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-blue-400 text-blue-700 hover:bg-blue-100"
                    onClick={() => setRegFormAdditionalMembers([...regFormAdditionalMembers, { member: null, items: [] }])}
                  >
                    <UserPlus className="w-4 h-4 me-1" />
                    {language === 'ar' ? 'إضافة عضو آخر' : 'Add Another Member'}
                  </Button>
                </div>
                {regFormAdditionalMembers.length > 0 && (
                  <div className="space-y-4">
                    {regFormAdditionalMembers.map((am, amIdx) => (
                      <div key={amIdx} className="p-3 bg-white rounded-lg border border-blue-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-blue-700">
                            {language === 'ar' ? `العضو ${amIdx + 2}` : `Member ${amIdx + 2}`}
                            {am.member && ` - ${am.member.name_ar || am.member.name}`}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-red-500 h-7 w-7 p-0"
                            onClick={() => setRegFormAdditionalMembers(regFormAdditionalMembers.filter((_, i) => i !== amIdx))}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <Select
                          value={am.member?.id || 'none'}
                          onValueChange={(val) => {
                            if (val === 'none') return;
                            if (val === 'new_member') {
                              setRegFormAdditionalMemberNewForm({ show: true, index: amIdx, data: { name_ar: '' } });
                              return;
                            }
                            const member = members.find(m => m.id === val);
                            const updated = [...regFormAdditionalMembers];
                            updated[amIdx] = { ...updated[amIdx], member };
                            setRegFormAdditionalMembers(updated);
                          }}
                        >
                          <SelectTrigger className="mb-2">
                            <SelectValue placeholder={language === 'ar' ? 'اختر العضو...' : 'Select member...'} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{language === 'ar' ? '-- اختر --' : '-- Select --'}</SelectItem>
                            <SelectItem value="new_member" className="text-primary font-medium"><UserPlus className="w-4 h-4 inline me-2" />{language === 'ar' ? 'إضافة عضو جديد' : 'Add new member'}</SelectItem>
                            {(members || []).filter(m => m.id && !regFormAdditionalMembers.some((a, i) => i !== amIdx && a.member?.id === m.id))
                              .map(m => <SelectItem key={m.id} value={m.id}>{language === 'ar' ? m.name_ar : m.name} - {m.phone}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {regFormAdditionalMemberNewForm.show && regFormAdditionalMemberNewForm.index === amIdx && (
                          <div className="p-3 mb-2 bg-green-50 border border-green-300 rounded-lg space-y-2">
                            <h5 className="text-sm font-bold text-green-800">{language === 'ar' ? 'إضافة عضو جديد' : 'Add New Member'}</h5>
                            <Input placeholder={language === 'ar' ? 'اسم العميل *' : 'Customer name *'} value={regFormAdditionalMemberNewForm.data.name_ar} onChange={(e) => setRegFormAdditionalMemberNewForm(prev => ({ ...prev, data: { ...prev.data, name_ar: e.target.value } }))} />
                            <div className="flex gap-2 justify-end">
                              <Button type="button" size="sm" variant="outline" onClick={() => setRegFormAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '' } })}>
                                {language === 'ar' ? 'إلغاء' : 'Cancel'}
                              </Button>
                              <Button type="button" size="sm" className="bg-green-600 hover:bg-green-700" disabled={!regFormAdditionalMemberNewForm.data.name_ar} onClick={async () => {
                                try {
                                  const res = await membersAPI.create({
                                    name_ar: regFormAdditionalMemberNewForm.data.name_ar,
                                    name: regFormAdditionalMemberNewForm.data.name_ar,
                                    phone: '',
                                    status: 'active'
                                  });
                                  const newMember = res.data;
                                  setMembers(prev => [...prev, newMember]);
                                  const updated = [...regFormAdditionalMembers];
                                  updated[amIdx] = { ...updated[amIdx], member: newMember };
                                  setRegFormAdditionalMembers(updated);
                                  setRegFormAdditionalMemberNewForm({ show: false, index: -1, data: { name_ar: '' } });
                                  toast.success(language === 'ar' ? 'تم إضافة العضو بنجاح' : 'Member added successfully');
                                } catch (error) {
                                  toast.error(language === 'ar' ? 'خطأ في إضافة العضو' : 'Error adding member');
                                }
                              }}>
                                <UserPlus className="w-4 h-4 me-1" />
                                {language === 'ar' ? 'حفظ' : 'Save'}
                              </Button>
                            </div>
                          </div>
                        )}
                        {am.member && (
                          <>
                            <Select
                              value=""
                              onValueChange={(actId) => {
                                const activity = activities.find(a => a.id === actId);
                                if (!activity) return;
                                const today = new Date().toISOString().split('T')[0];
                                const endDate = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0];
                                const newItem = {
                                  activity_id: activity.id,
                                  activity_name: activity.name_ar || activity.name,
                                  fee: activity.monthly_fee || 0,
                                  period: `${today} - ${endDate}`,
                                  schedule: activity.schedule || '',
                                  start_date: today,
                                  end_date: endDate,
                                  is_product: false,
                                  training_days: [],
                                  training_time: '',
                                  training_time_hour: '',
                                  level_id: '',
                                  level_name: ''
                                };
                                const updated = [...regFormAdditionalMembers];
                                updated[amIdx] = { ...updated[amIdx], items: [...updated[amIdx].items, newItem] };
                                setRegFormAdditionalMembers(updated);
                              }}
                            >
                              <SelectTrigger className="mb-2">
                                <SelectValue placeholder={language === 'ar' ? '+ اختر نشاط...' : '+ Select activity...'} />
                              </SelectTrigger>
                              <SelectContent>
                                {(activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name} - {a.monthly_fee} {language === 'ar' ? 'ر.س' : 'SAR'}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {am.items.length > 0 && (
                              <div className="space-y-2">
                                {am.items.map((item, itemIdx) => (
                                  <div key={itemIdx} className="p-2 bg-blue-50 rounded text-sm space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">{item.activity_name}</span>
                                      <div className="flex items-center gap-2">
                                        <Input
                                          type="number"
                                          value={item.fee}
                                          onChange={(e) => {
                                            const updated = [...regFormAdditionalMembers];
                                            updated[amIdx].items[itemIdx].fee = parseFloat(e.target.value) || 0;
                                            setRegFormAdditionalMembers(updated);
                                          }}
                                          className="w-20 h-7 text-sm text-center"
                                        />
                                        <span className="text-xs text-muted-foreground">{language === 'ar' ? 'ر.س' : 'SAR'}</span>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 w-6 p-0 text-red-500"
                                          onClick={() => {
                                            const updated = [...regFormAdditionalMembers];
                                            updated[amIdx].items = updated[amIdx].items.filter((_, i) => i !== itemIdx);
                                            setRegFormAdditionalMembers(updated);
                                          }}
                                        >
                                          <X className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                    {!item.is_product && (
                                      <div className="space-y-2">
                                        <div className="space-y-1">
                                          <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
                                          <div className="flex flex-wrap gap-1">
                                            {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                                              <button
                                                key={day}
                                                type="button"
                                                onClick={() => {
                                                  const currentDays = item.training_days || [];
                                                  const newDays = currentDays.includes(day)
                                                    ? currentDays.filter(d => d !== day)
                                                    : [...currentDays, day];
                                                  const updated = [...regFormAdditionalMembers];
                                                  updated[amIdx].items[itemIdx].training_days = newDays;
                                                  const formatSchedule = (days, time) => {
                                                    if (days.length === 0) return time || '';
                                                    const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                                    const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                                    let daysStr;
                                                    if (sortedDays.length === 1) {
                                                      daysStr = sortedDays[0];
                                                    } else {
                                                      const lastDay = sortedDays.pop();
                                                      daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                                    }
                                                    return time ? `${daysStr} - ${time}` : daysStr;
                                                  };
                                                  updated[amIdx].items[itemIdx].schedule = formatSchedule(newDays, item.training_time);
                                                  setRegFormAdditionalMembers(updated);
                                                }}
                                                className={`px-2 py-1 text-xs rounded border transition-colors ${
                                                  (item.training_days || []).includes(day)
                                                    ? 'bg-blue-500 text-white border-blue-500'
                                                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                                }`}
                                              >
                                                {day}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="space-y-1">
                                            <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
                                            <Input
                                              type="number"
                                              min="1"
                                              max="12"
                                              placeholder={language === 'ar' ? 'مثال: 4' : 'e.g., 4'}
                                              value={item.training_time_hour || ''}
                                              onChange={(e) => {
                                                const hour = e.target.value;
                                                const updated = [...regFormAdditionalMembers];
                                                updated[amIdx].items[itemIdx].training_time_hour = hour;
                                                const timeStr = hour ? `${hour}:00 م` : '';
                                                updated[amIdx].items[itemIdx].training_time = timeStr;
                                                const formatSchedule = (days, time) => {
                                                  if (!days || days.length === 0) return time || '';
                                                  const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                                                  const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                                  let daysStr;
                                                  if (sortedDays.length === 1) {
                                                    daysStr = sortedDays[0];
                                                  } else {
                                                    const lastDay = sortedDays.pop();
                                                    daysStr = sortedDays.join('، ') + ' و ' + lastDay;
                                                  }
                                                  return time ? `${daysStr} - ${time}` : daysStr;
                                                };
                                                updated[amIdx].items[itemIdx].schedule = formatSchedule(updated[amIdx].items[itemIdx].training_days, timeStr);
                                                setRegFormAdditionalMembers(updated);
                                              }}
                                              className="h-7 text-sm"
                                            />
                                            {item.training_time && (
                                              <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>
                                            )}
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
                                            <Select
                                              value={item.level_id || 'none'}
                                              onValueChange={(val) => {
                                                const updated = [...regFormAdditionalMembers];
                                                if (val === 'none') {
                                                  updated[amIdx].items[itemIdx].level_id = '';
                                                  updated[amIdx].items[itemIdx].level_name = '';
                                                } else {
                                                  const level = levels.find(l => l.id === val);
                                                  const levelLabel = level ? `${level.activity_name || ''} - ${language === 'ar' ? 'مستوى' : 'Level'} ${level.level_number}` : '';
                                                  updated[amIdx].items[itemIdx].level_id = val;
                                                  updated[amIdx].items[itemIdx].level_name = levelLabel;
                                                }
                                                setRegFormAdditionalMembers(updated);
                                              }}
                                            >
                                              <SelectTrigger className="h-7 text-sm">
                                                <SelectValue placeholder={language === 'ar' ? 'اختياري' : 'Optional'} />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="none">{language === 'ar' ? '-- بدون --' : '-- None --'}</SelectItem>
                                                {(levels || []).filter(l => l.id && (l.activity_name === item.activity_name || !l.activity_name)).map(l => (
                                                  <SelectItem key={l.id} value={l.id}>{l.activity_name} - {language === 'ar' ? 'مستوى' : 'Level'} {l.level_number}</SelectItem>
                                                ))}
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
              <Button variant="outline" onClick={() => handlePrintViewedRegForm(selectedRegForm)} className="text-gray-700 border-gray-400">
                <Printer className="w-4 h-4 me-2" />
                {language === 'ar' ? 'طباعة' : 'Print'}
              </Button>
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
                      (activities || []).filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name} - {a.monthly_fee} {t('sar')}</SelectItem>) :
                      (products || []).filter(p => p.id).map(p => <SelectItem key={p.id} value={p.id}>{p.name_ar || p.name} - {p.price} {t('sar')}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>

              {/* Items List */}
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

        {/* QR Card Modal */}
        <Dialog open={isQRCardDialogOpen} onOpenChange={(open) => { setIsQRCardDialogOpen(open); if (!open) setQrCardSubscription(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-center flex items-center justify-center gap-2">
                <QrCode className="w-5 h-5 text-purple-600" />
                {language === 'ar' ? 'بطاقة العضوية' : 'Member Card'}
              </DialogTitle>
            </DialogHeader>
            
            {qrCardMember && (
              <div className="text-center space-y-4">
                {/* Academy Logo */}
                <div className="text-orange-500 font-bold">🏆 شركة اداء الابطال العالمية للرياضة</div>
                
                {/* QR Code - 6cm x 6cm preview */}
                <div 
                  className="mx-auto bg-white p-4 rounded-xl border-2 border-purple-100 shadow-inner"
                  style={{ width: '170px', height: '170px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <QRCodeSVG
                    value={qrCardMember.member_code.toString()}
                    size={140}
                    level="H"
                    includeMargin={false}
                  />
                </div>
                
                {/* Member Info */}
                <div>
                  <p className="text-lg font-bold text-gray-800">{qrCardMember.name_ar}</p>
                  <p className="text-xl font-bold text-orange-600">#{qrCardMember.member_code}</p>
                </div>
                
                {/* Subscription Details (shown after invoice creation) */}
                {qrCardSubscription && qrCardSubscription.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-right">
                    <p className="text-green-700 font-bold text-sm mb-2 flex items-center justify-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      {language === 'ar' ? 'تفاصيل الاشتراك' : 'Subscription Details'}
                    </p>
                    {(qrCardSubscription || []).map((item, idx) => (
                      <div key={idx} className="text-sm border-t border-green-100 pt-2 mt-2 first:border-0 first:pt-0 first:mt-0">
                        <p className="font-bold text-gray-700">{item.activity_name}</p>
                        <div className="flex justify-between text-gray-600 text-xs mt-1">
                          <span>📅 من: {item.start_date || '-'}</span>
                          <span>📅 إلى: {item.end_date || '-'}</span>
                        </div>
                        {item.schedule && (
                          <p className="text-xs text-gray-500 mt-1">🕐 {item.schedule}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Action Buttons */}
                <div className="flex gap-3 justify-center pt-2">
                  <Button 
                    onClick={handleSendQRCardWhatsApp} 
                    className="gap-2 bg-green-600 hover:bg-green-700"
                  >
                    <MessageSquare className="w-4 h-4" />
                    {language === 'ar' ? 'إرسال واتساب' : 'Send WhatsApp'}
                  </Button>
                  <Button 
                    onClick={handlePrintQRCard} 
                    variant="outline"
                    className="gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    {language === 'ar' ? 'طباعة 6×6 سم' : 'Print 6×6 cm'}
                  </Button>
                </div>
                
                <p className="text-xs text-gray-400">
                  {language === 'ar' ? 'امسح الكود عند الدخول لتسجيل الحضور' : 'Scan code at entrance to check-in'}
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default InvoicesPage;
