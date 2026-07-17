import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { productsAPI, discountsAPI, productInvoicesAPI, branchesAPI, membersAPI, activitiesAPI } from '../services/api';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import html2pdf from 'html2pdf.js';
import { 
  Package, Plus, Search, Edit, Trash2, AlertTriangle, 
  ShoppingBag, TrendingUp, TrendingDown, Loader2, BarChart3, X, Percent, Tag,
  Receipt, Printer, FileText, CheckCircle, Eye, Building2, MessageSquare, Users, Dumbbell
} from 'lucide-react';

const CATEGORIES = {
  swimming: { ar: 'أدوات السباحة', en: 'Swimming' },
  sports: { ar: 'أدوات رياضية', en: 'Sports' },
  accessories: { ar: 'إكسسوارات', en: 'Accessories' },
  clothing: { ar: 'ملابس رياضية', en: 'Clothing' },
};

const COMPANY_INFO = {
  name_ar: "شركة اداء الابطال العالمية للرياضة",
  tax_number: "312655637900003",
  commercial_reg: "7043630230",
  vat_rate: 15
};

export const StorePage = () => {
  const { t, language } = useLanguage();
  const { user, selectedBranchId } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isStockDialogOpen, setIsStockDialogOpen] = useState(false);
  const [isDiscountDialogOpen, setIsDiscountDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [stockChange, setStockChange] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activeDetail, setActiveDetail] = useState(null);
  const [activeTab, setActiveTab] = useState('products'); // products, discounts, or invoices
  
  // Product Invoice States
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [isInvoiceViewOpen, setIsInvoiceViewOpen] = useState(false);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [allMembers, setAllMembers] = useState([]);
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [currentInvoice, setCurrentInvoice] = useState(null);
  const [productInvoices, setProductInvoices] = useState([]);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [invoiceStatus, setInvoiceStatus] = useState('draft'); // draft or paid
  const invoiceRef = useRef(null);
  
  const [formData, setFormData] = useState({
    name_ar: '', name: '', category: 'swimming', sku: '',
    price: '', cost: '', quantity: '', min_quantity: '5', description: ''
  });
  
  const [discountForm, setDiscountForm] = useState({
    code: '', name_ar: '', name: '', discount_type: 'percentage',
    value: '', min_purchase: '0', max_uses: '0', is_active: true, branch_id: 'all',
    activity_ids: []
  });
  const [couponActivities, setCouponActivities] = useState([]);

  useEffect(() => { loadData(); }, [selectedBranchId]);

  const loadData = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const [productsRes, discountsRes, invoicesRes, branchesRes, membersRes, activitiesRes] = await Promise.all([
        productsAPI.getAll(branchParams),
        discountsAPI.getAll(branchParams),
        productInvoicesAPI.getAll(branchParams),
        isAdmin ? branchesAPI.getAll() : Promise.resolve({ data: [] }),
        membersAPI.getAll({ exclude_photo: true }),
        activitiesAPI.getAll().catch(() => ({ data: [] }))
      ]);
      setProducts(productsRes.data);
      setDiscounts(discountsRes.data);
      setProductInvoices(invoicesRes.data || []);
      setBranches(branchesRes.data || []);
      setAllMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      setCouponActivities(Array.isArray(activitiesRes.data) ? activitiesRes.data.filter(a => a.is_active !== false) : []);
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const branchParams = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await productsAPI.getAll(branchParams);
      setProducts(res.data);
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل المنتجات' : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingProduct(null);
    setFormData({
      name_ar: '', name: '', category: 'swimming', sku: '',
      price: '', cost: '', quantity: '', min_quantity: '5', description: ''
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (product) => {
    setEditingProduct(product);
    setFormData({
      name_ar: product.name_ar, name: product.name || '', category: product.category,
      sku: product.sku, price: product.price.toString(), cost: product.cost.toString(),
      quantity: product.quantity.toString(), min_quantity: product.min_quantity.toString(),
      description: product.description || ''
    });
    setIsDialogOpen(true);
  };

  const openStockDialog = (product) => {
    setSelectedProduct(product);
    setStockChange(0);
    setIsStockDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name_ar || !formData.price) {
      toast.error(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Please fill required fields');
      return;
    }
    
    setSaving(true);
    try {
      const data = {
        ...formData,
        price: parseFloat(formData.price) || 0,
        cost: parseFloat(formData.cost) || 0,
        quantity: parseInt(formData.quantity) || 0,
        min_quantity: parseInt(formData.min_quantity) || 5
      };
      
      if (editingProduct) {
        await productsAPI.update(editingProduct.id, data);
        toast.success(language === 'ar' ? 'تم تحديث المنتج' : 'Product updated');
      } else {
        await productsAPI.create(data);
        toast.success(language === 'ar' ? 'تم إضافة المنتج' : 'Product added');
      }
      setIsDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleStockUpdate = async () => {
    if (!stockChange) return;
    setSaving(true);
    try {
      await productsAPI.updateStock(selectedProduct.id, stockChange);
      toast.success(language === 'ar' ? 'تم تحديث المخزون' : 'Stock updated');
      setIsStockDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'خطأ في تحديث المخزون' : 'Stock update failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (productId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف المنتج؟' : 'Delete this product?')) return;
    try {
      await productsAPI.delete(productId);
      toast.success(language === 'ar' ? 'تم حذف المنتج' : 'Product deleted');
      loadData();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في الحذف' : 'Delete failed');
    }
  };

  // Discount handlers
  const openDiscountDialog = (discount = null) => {
    if (discount) {
      setEditingDiscount(discount);
      setDiscountForm({
        code: discount.code, name_ar: discount.name_ar, name: discount.name || '',
        discount_type: discount.discount_type, value: discount.value.toString(),
        min_purchase: discount.min_purchase.toString(), max_uses: discount.max_uses.toString(),
        is_active: discount.is_active,
        branch_id: discount.branch_id || 'all',
        activity_ids: discount.activity_ids || []
      });
    } else {
      setEditingDiscount(null);
      setDiscountForm({
        code: '', name_ar: '', name: '', discount_type: 'percentage',
        value: '', min_purchase: '0', max_uses: '0', is_active: true,
        branch_id: 'all',
        activity_ids: []
      });
    }
    setIsDiscountDialogOpen(true);
  };

  const handleDiscountSubmit = async (e) => {
    e.preventDefault();
    if (!discountForm.code || !discountForm.name_ar || !discountForm.value) {
      toast.error(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Please fill required fields');
      return;
    }
    setSaving(true);
    try {
      const data = {
        ...discountForm,
        value: parseFloat(discountForm.value) || 0,
        min_purchase: parseFloat(discountForm.min_purchase) || 0,
        max_uses: parseInt(discountForm.max_uses) || 0,
        branch_id: isAdmin ? discountForm.branch_id : undefined,
        activity_ids: discountForm.activity_ids || []
      };
      if (editingDiscount) {
        await discountsAPI.update(editingDiscount.id, data);
        toast.success(language === 'ar' ? 'تم تحديث الخصم' : 'Discount updated');
      } else {
        await discountsAPI.create(data);
        toast.success(language === 'ar' ? 'تم إضافة الخصم' : 'Discount added');
      }
      setIsDiscountDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(error.response?.data?.detail || (language === 'ar' ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDiscount = async (discountId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف الخصم؟' : 'Delete this discount?')) return;
    try {
      await discountsAPI.delete(discountId);
      toast.success(language === 'ar' ? 'تم حذف الخصم' : 'Discount deleted');
      loadData();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في الحذف' : 'Delete failed');
    }
  };

  // ============ Product Invoice Functions ============
  const openInvoiceDialog = (invoice = null) => {
    if (invoice) {
      setEditingInvoice(invoice);
      setInvoiceItems(invoice.items || []);
      setCustomerName(invoice.customer_name || '');
      setCustomerPhone(invoice.customer_phone || '');
      setSelectedMemberId(invoice.member_id || '');
      setPaymentMethod(invoice.payment_method || 'cash');
      setInvoiceStatus(invoice.status || 'draft');
    } else {
      setEditingInvoice(null);
      setInvoiceItems([]);
      setCustomerName('');
      setCustomerPhone('');
      setSelectedMemberId('');
      setPaymentMethod('cash');
      setInvoiceStatus('draft');
    }
    setMemberSearchTerm('');
    setIsInvoiceDialogOpen(true);
  };

  const addProductToInvoice = (productId) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const existingIndex = invoiceItems.findIndex(i => i.product_id === productId);
    if (existingIndex >= 0) {
      const updated = [...invoiceItems];
      if (updated[existingIndex].quantity < product.quantity) {
        updated[existingIndex].quantity += 1;
        updated[existingIndex].total = updated[existingIndex].quantity * product.price;
        setInvoiceItems(updated);
      } else {
        toast.error(language === 'ar' ? 'الكمية غير متوفرة' : 'Not enough stock');
      }
    } else {
      if (product.quantity < 1) {
        toast.error(language === 'ar' ? 'المنتج غير متوفر' : 'Product not available');
        return;
      }
      setInvoiceItems([...invoiceItems, {
        product_id: productId,
        name: product.name_ar,
        price: product.price,
        quantity: 1,
        total: product.price,
        max_qty: product.quantity
      }]);
    }
  };

  const updateInvoiceItemQty = (index, qty) => {
    const updated = [...invoiceItems];
    const maxQty = updated[index].max_qty;
    if (qty > 0 && qty <= maxQty) {
      updated[index].quantity = qty;
      updated[index].total = qty * updated[index].price;
      setInvoiceItems(updated);
    }
  };

  const removeInvoiceItem = (index) => {
    setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
  };

  const getBranchName = (branchId) => {
    if (!branchId) return language === 'ar' ? 'الفرع الرئيسي' : 'Main Branch';
    const branch = branches.find(b => b.id === branchId);
    return branch?.name_ar || branch?.name || branchId;
  };

  // Activities shown in the coupon offer picker: when a specific branch is
  // selected show ONLY that branch's activities (fall back to global ones if
  // the branch has none); "all branches" shows everything.
  const getCouponActivitiesForBranch = (branchId) => {
    if (!branchId || branchId === 'all') return couponActivities;
    const branchActs = couponActivities.filter(a => a.branch_id === branchId);
    return branchActs.length > 0 ? branchActs : couponActivities.filter(a => !a.branch_id);
  };

  const calculateInvoiceTotals = () => {
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
    const vatAmount = Math.round(subtotal * (COMPANY_INFO.vat_rate / 100) * 100) / 100;
    const total = Math.round((subtotal + vatAmount) * 100) / 100;
    return { subtotal, vatAmount, total };
  };

  const generateInvoiceNumber = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `P${year}${month}${random}`;
  };

  const handleCreateProductInvoice = async (asPaid = false) => {
    if (invoiceItems.length === 0) {
      toast.error(language === 'ar' ? 'أضف منتجات للفاتورة' : 'Add products to invoice');
      return;
    }
    if (!customerName) {
      toast.error(language === 'ar' ? 'أدخل اسم العميل' : 'Enter customer name');
      return;
    }

    setSaving(true);
    try {
      const status = asPaid ? 'paid' : 'draft';
      
      const invoiceData = {
        customer_name: customerName,
        customer_phone: customerPhone,
        member_id: selectedMemberId || null,
        payment_method: paymentMethod,
        items: invoiceItems.map(item => ({
          product_id: item.product_id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          total: item.total
        })),
        status,
        branch_id: selectedBranchId  // Send selected branch for admin
      };

      let savedInvoice;
      if (editingInvoice && editingInvoice.id) {
        // Update existing invoice via API
        const res = await productInvoicesAPI.update(editingInvoice.id, invoiceData);
        savedInvoice = res.data;
        toast.success(language === 'ar' ? 'تم تحديث الفاتورة' : 'Invoice updated');
      } else {
        // Create new invoice via API
        const res = await productInvoicesAPI.create(invoiceData);
        savedInvoice = res.data;
        toast.success(language === 'ar' ? (asPaid ? 'تم إنشاء الفاتورة ودفعها' : 'تم حفظ الفاتورة كمسودة') : (asPaid ? 'Invoice created and paid' : 'Invoice saved as draft'));
      }

      setCurrentInvoice(savedInvoice);
      setIsInvoiceDialogOpen(false);
      loadData(); // Refresh all data
      
      if (asPaid) {
        setIsInvoiceViewOpen(true);
      }
    } catch (error) {
      console.error('Invoice error:', error);
      toast.error(language === 'ar' ? 'خطأ في حفظ الفاتورة' : 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId) => {
    if (!window.confirm(language === 'ar' ? 'هل تريد حذف هذه الفاتورة؟' : 'Delete this invoice?')) return;
    try {
      await productInvoicesAPI.delete(invoiceId);
      loadData();
      toast.success(language === 'ar' ? 'تم حذف الفاتورة' : 'Invoice deleted');
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حذف الفاتورة' : 'Failed to delete invoice');
    }
  };

  const viewInvoice = (invoice) => {
    setCurrentInvoice(invoice);
    setIsInvoiceViewOpen(true);
  };

  const handlePrintInvoice = () => {
    const printContent = invoiceRef.current;
    const printWindow = window.open('', '', 'width=400,height=600');
    printWindow.document.write(`
      <html dir="rtl">
        <head>
          <title>فاتورة منتجات</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
            .header { text-align: center; margin-bottom: 20px; }
            .header h1 { font-size: 16px; margin: 0; }
            .header p { margin: 5px 0; font-size: 11px; color: #666; }
            .info { margin-bottom: 15px; }
            .info p { margin: 3px 0; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
            th { background: #f5f5f5; }
            .totals { margin-top: 15px; }
            .totals p { display: flex; justify-content: space-between; margin: 5px 0; }
            .totals .total { font-size: 16px; font-weight: bold; border-top: 2px solid #333; padding-top: 10px; }
            .qr { text-align: center; margin-top: 20px; }
            .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #666; }
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleSaveInvoicePdf = async () => {
    if (!invoiceRef.current || !currentInvoice) return;
    const branchName = getBranchName(currentInvoice.branch_id);
    const opt = {
      margin: 5,
      filename: `فاتورة_${currentInvoice?.invoice_number}_${customerName || 'عميل'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: [80, 200], orientation: 'portrait' }
    };
    await html2pdf().from(invoiceRef.current).set(opt).save();
    toast.success(language === 'ar' ? 'تم حفظ الفاتورة كـ PDF' : 'Invoice saved as PDF');
    
    // Open WhatsApp with message
    const phone = currentInvoice.customer_phone?.replace(/^0/, '966') || '';
    if (phone) {
      const message = `السلام عليكم،

مرفق فاتورتكم رقم #${currentInvoice.invoice_number}
المبلغ الإجمالي: ${currentInvoice.total} ر.س
الفرع: ${branchName}

يرجى إرفاق ملف PDF المحفوظ في هذه المحادثة.

شكراً لكم،
شركة اداء الابطال العالمية للرياضة`;
      
      setTimeout(() => {
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
      }, 500);
    }
  };
  
  // Share product invoice to WhatsApp (text only)
  const handleShareProductWhatsApp = () => {
    if (!currentInvoice) return;
    
    const branchName = getBranchName(currentInvoice.branch_id);
    const phone = currentInvoice.customer_phone?.replace(/^0/, '966') || '';
    
    const items = currentInvoice.items?.map(item => 
      `• ${item.name} (${item.quantity}×): ${item.total} ر.س`
    ).join('\n') || '';
    
    const message = `السلام عليكم،

📄 *فاتورة منتجات رقم #${currentInvoice.invoice_number}*

${items}

💰 المجموع الفرعي: ${currentInvoice.subtotal} ر.س
📊 ضريبة القيمة المضافة (${currentInvoice.vat_rate || 15}%): ${currentInvoice.vat_amount} ر.س
✅ *الإجمالي: ${currentInvoice.total} ر.س*

🏢 الفرع: ${branchName}
📅 التاريخ: ${new Date(currentInvoice.created_at).toLocaleDateString('ar-SA')}

شكراً لكم،
شركة اداء الابطال العالمية للرياضة`;

    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    } else {
      navigator.clipboard.writeText(message);
      toast.success(language === 'ar' ? 'تم نسخ الرسالة!' : 'Message copied!');
      window.open('https://wa.me/', '_blank');
    }
  };

  // Generate ZATCA-compliant QR Code (TLV Base64 format)
  const generateZATCAQR = (invoice) => {
    if (!invoice) return '';
    
    // ZATCA TLV Format:
    // Tag 1: Seller Name
    // Tag 2: VAT Registration Number
    // Tag 3: Invoice Timestamp (ISO 8601)
    // Tag 4: Invoice Total (with VAT)
    // Tag 5: VAT Amount
    
    const sellerName = COMPANY_INFO.name_ar;
    const vatNumber = COMPANY_INFO.tax_number;
    const timestamp = new Date(invoice.created_at || new Date()).toISOString();
    const totalWithVat = invoice.total?.toFixed(2) || '0.00';
    const vatAmount = invoice.vat_amount?.toFixed(2) || '0.00';
    
    // Create TLV encoded data
    const tlvEncode = (tag, value) => {
      const encoder = new TextEncoder();
      const valueBytes = encoder.encode(value);
      return new Uint8Array([tag, valueBytes.length, ...valueBytes]);
    };
    
    // Combine all TLV tags
    const tag1 = tlvEncode(1, sellerName);
    const tag2 = tlvEncode(2, vatNumber);
    const tag3 = tlvEncode(3, timestamp);
    const tag4 = tlvEncode(4, totalWithVat);
    const tag5 = tlvEncode(5, vatAmount);
    
    // Merge all arrays
    const combined = new Uint8Array([...tag1, ...tag2, ...tag3, ...tag4, ...tag5]);
    
    // Convert to Base64
    let binary = '';
    combined.forEach(byte => binary += String.fromCharCode(byte));
    const base64 = btoa(binary);
    
    return base64;
  };

  const filteredProducts = products.filter(p => {
    const matchSearch = p.name_ar.includes(searchTerm) || p.name?.includes(searchTerm) || p.sku?.includes(searchTerm);
    const matchCategory = filterCategory === 'all' || p.category === filterCategory;
    return matchSearch && matchCategory;
  });

  const stats = {
    total: products?.length || 0,
    lowStock: products?.filter(p => p.quantity <= p.min_quantity)?.length || 0,
    totalValue: products?.reduce((sum, p) => sum + ((p.price || 0) * (p.quantity || 0)), 0) || 0,
    totalCost: products?.reduce((sum, p) => sum + ((p.cost || 0) * (p.quantity || 0)), 0) || 0,
    activeDiscounts: discounts?.filter(d => d.is_active)?.length || 0,
    totalInvoices: productInvoices?.length || 0,
    draftInvoices: productInvoices?.filter(i => i.status === 'draft')?.length || 0,
    paidInvoices: productInvoices?.filter(i => i.status === 'paid')?.length || 0,
    invoicesTotal: productInvoices?.filter(i => i.status === 'paid')?.reduce((sum, i) => sum + (i.total || 0), 0) || 0
  };

  const toggleDetail = (type) => setActiveDetail(activeDetail === type ? null : type);

  if (loading) {
    return <Layout title={language === 'ar' ? 'المخزن' : 'Store'}><div className="flex items-center justify-center h-64"><div className="spinner" /></div></Layout>;
  }

  return (
    <Layout title={language === 'ar' ? 'المخزن' : 'Store'}>
      <div className="space-y-6" data-testid="store-page">
        {/* Stats - Clickable */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-all ${activeDetail === 'total' ? 'ring-2 ring-primary' : ''}`} onClick={() => toggleDetail('total')}>
            <div className="stat-card-icon bg-primary/10"><Package className="w-6 h-6 text-primary" /></div>
            <div className="stat-card-value text-primary">{stats.total}</div>
            <div className="stat-card-label">{language === 'ar' ? 'إجمالي المنتجات' : 'Total Products'}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click'}</div>
          </Card>
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-all ${activeDetail === 'lowStock' ? 'ring-2 ring-amber-500' : ''}`} onClick={() => toggleDetail('lowStock')}>
            <div className="stat-card-icon bg-amber-500/10"><AlertTriangle className="w-6 h-6 text-amber-500" /></div>
            <div className="stat-card-value text-amber-500">{stats.lowStock}</div>
            <div className="stat-card-label">{language === 'ar' ? 'مخزون منخفض' : 'Low Stock'}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click'}</div>
          </Card>
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-all ${activeDetail === 'value' ? 'ring-2 ring-green-500' : ''}`} onClick={() => toggleDetail('value')}>
            <div className="stat-card-icon bg-green-500/10"><TrendingUp className="w-6 h-6 text-green-500" /></div>
            <div className="stat-card-value text-green-500">{stats.totalValue.toLocaleString()} {t('sar')}</div>
            <div className="stat-card-label">{language === 'ar' ? 'قيمة البيع' : 'Sale Value'}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click'}</div>
          </Card>
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-all ${activeDetail === 'cost' ? 'ring-2 ring-blue-500' : ''}`} onClick={() => toggleDetail('cost')}>
            <div className="stat-card-icon bg-blue-500/10"><BarChart3 className="w-6 h-6 text-blue-500" /></div>
            <div className="stat-card-value text-blue-500">{stats.totalCost.toLocaleString()} {t('sar')}</div>
            <div className="stat-card-label">{language === 'ar' ? 'قيمة التكلفة' : 'Cost Value'}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click'}</div>
          </Card>
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-all ${activeDetail === 'discounts' ? 'ring-2 ring-purple-500' : ''}`} onClick={() => { toggleDetail('discounts'); setActiveTab('discounts'); }}>
            <div className="stat-card-icon bg-purple-500/10"><Percent className="w-6 h-6 text-purple-500" /></div>
            <div className="stat-card-value text-purple-500">{stats.activeDiscounts}</div>
            <div className="stat-card-label">{language === 'ar' ? 'كوبونات نشطة' : 'Active Coupons'}</div>
            <div className="text-xs text-muted-foreground mt-1">{language === 'ar' ? 'اضغط للتفاصيل' : 'Click'}</div>
          </Card>
          <Card className={`stat-card cursor-pointer hover:shadow-lg transition-all ${activeTab === 'invoices' ? 'ring-2 ring-emerald-500' : ''}`} onClick={() => setActiveTab('invoices')}>
            <div className="stat-card-icon bg-emerald-500/10"><Receipt className="w-6 h-6 text-emerald-500" /></div>
            <div className="stat-card-value text-emerald-500">{stats.totalInvoices}</div>
            <div className="stat-card-label">{language === 'ar' ? 'فواتير المنتجات' : 'Product Invoices'}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.draftInvoices > 0 && <Badge variant="outline" className="text-amber-600 me-1">{stats.draftInvoices} {language === 'ar' ? 'مسودة' : 'Draft'}</Badge>}
              {stats.paidInvoices > 0 && <Badge variant="outline" className="text-green-600">{stats.paidInvoices} {language === 'ar' ? 'مدفوعة' : 'Paid'}</Badge>}
            </div>
          </Card>
        </div>

        {/* Detail Sections */}
        {activeDetail && activeDetail !== 'discounts' && (
          <Card className="animate-in slide-in-from-top-2 border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-primary">
                {activeDetail === 'total' && (language === 'ar' ? 'تفاصيل المنتجات' : 'Products Details')}
                {activeDetail === 'lowStock' && (language === 'ar' ? 'منتجات المخزون المنخفض' : 'Low Stock Products')}
                {activeDetail === 'value' && (language === 'ar' ? 'تفاصيل قيمة البيع' : 'Sale Value Details')}
                {activeDetail === 'cost' && (language === 'ar' ? 'تفاصيل قيمة التكلفة' : 'Cost Value Details')}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setActiveDetail(null)}><X className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
              {activeDetail === 'total' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(CATEGORIES).map(([key, val]) => {
                    const count = products.filter(p => p.category === key).length;
                    return (
                      <div key={key} className="p-3 bg-white rounded-lg border text-center">
                        <div className="text-xl font-bold">{count}</div>
                        <div className="text-xs text-muted-foreground">{language === 'ar' ? val.ar : val.en}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {activeDetail === 'lowStock' && (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {products.filter(p => p.quantity <= p.min_quantity).map(p => (
                    <div key={p.id} className="flex justify-between items-center p-2 bg-amber-50 rounded border border-amber-200">
                      <span className="font-medium">{p.name_ar}</span>
                      <Badge className="bg-amber-500">{p.quantity} / {p.min_quantity}</Badge>
                    </div>
                  ))}
                  {stats.lowStock === 0 && <p className="text-center text-muted-foreground">{language === 'ar' ? 'لا توجد منتجات بمخزون منخفض' : 'No low stock items'}</p>}
                </div>
              )}
              {(activeDetail === 'value' || activeDetail === 'cost') && (
                <div className="space-y-3">
                  <div className="flex justify-between p-3 bg-white rounded-lg border">
                    <span>{language === 'ar' ? 'إجمالي قيمة البيع:' : 'Total Sale Value:'}</span>
                    <span className="font-bold text-green-600">{stats.totalValue.toLocaleString()} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between p-3 bg-white rounded-lg border">
                    <span>{language === 'ar' ? 'إجمالي التكلفة:' : 'Total Cost:'}</span>
                    <span className="font-bold text-blue-600">{stats.totalCost.toLocaleString()} {t('sar')}</span>
                  </div>
                  <div className="flex justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                    <span className="font-medium">{language === 'ar' ? 'الربح المتوقع:' : 'Expected Profit:'}</span>
                    <span className="font-bold text-green-700">{(stats.totalValue - stats.totalCost).toLocaleString()} {t('sar')}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          <Button variant={activeTab === 'products' ? 'default' : 'ghost'} onClick={() => setActiveTab('products')} className="rounded-b-none">
            <Package className="w-4 h-4 me-2" />{language === 'ar' ? 'المنتجات' : 'Products'}
          </Button>
          <Button variant={activeTab === 'discounts' ? 'default' : 'ghost'} onClick={() => setActiveTab('discounts')} className="rounded-b-none">
            <Percent className="w-4 h-4 me-2" />{language === 'ar' ? 'كوبونات الخصم' : 'Discount Coupons'}
          </Button>
          <Button variant={activeTab === 'invoices' ? 'default' : 'ghost'} onClick={() => setActiveTab('invoices')} className="rounded-b-none">
            <Receipt className="w-4 h-4 me-2" />{language === 'ar' ? 'فواتير المنتجات' : 'Product Invoices'}
            {stats.draftInvoices > 0 && <Badge className="ms-2 bg-amber-500">{stats.draftInvoices}</Badge>}
          </Button>
        </div>

        {activeTab === 'products' && (<>
        {/* Toolbar */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <div className="flex gap-2 items-center flex-1 min-w-[200px]">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder={language === 'ar' ? 'بحث...' : 'Search...'} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="ps-10" />
                </div>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'جميع الفئات' : 'All Categories'}</SelectItem>
                    {Object.entries(CATEGORIES).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{language === 'ar' ? val.ar : val.en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={openInvoiceDialog} variant="outline" className="bg-green-50 border-green-500 text-green-700 hover:bg-green-100" data-testid="create-product-invoice-btn">
                  <Receipt className="w-4 h-4 me-2" />{language === 'ar' ? 'فاتورة منتجات' : 'Product Invoice'}
                </Button>
                <Button onClick={openCreateDialog} data-testid="add-product-btn">
                  <Plus className="w-4 h-4 me-2" />{language === 'ar' ? 'إضافة منتج' : 'Add Product'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.length === 0 ? (
            <Card className="col-span-full p-8 text-center text-muted-foreground">
              <ShoppingBag className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{language === 'ar' ? 'لا توجد منتجات' : 'No products found'}</p>
            </Card>
          ) : filteredProducts.map(product => (
            <Card key={product.id} className={`hover:shadow-md transition-shadow ${product.quantity <= product.min_quantity ? 'border-amber-300 bg-amber-50/30' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-base">{product.name_ar}</CardTitle>
                    <p className="text-xs text-muted-foreground">{product.sku}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {CATEGORIES[product.category]?.[language === 'ar' ? 'ar' : 'en'] || product.category}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{language === 'ar' ? 'السعر:' : 'Price:'}</span>
                  <span className="font-bold text-primary">{product.price} {t('sar')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{language === 'ar' ? 'التكلفة:' : 'Cost:'}</span>
                  <span>{product.cost} {t('sar')}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-muted-foreground">{language === 'ar' ? 'الكمية:' : 'Qty:'}</span>
                  <Badge className={product.quantity <= product.min_quantity ? 'bg-amber-500' : 'bg-green-500'}>
                    {product.quantity}
                  </Badge>
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => openStockDialog(product)}>
                    <TrendingUp className="w-3 h-3 me-1" />{language === 'ar' ? 'تعديل المخزون' : 'Stock'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEditDialog(product)}><Edit className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDelete(product.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Add/Edit Product Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                {editingProduct ? (language === 'ar' ? 'تعديل المنتج' : 'Edit Product') : (language === 'ar' ? 'إضافة منتج جديد' : 'Add New Product')}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>{language === 'ar' ? 'اسم المنتج (عربي) *' : 'Product Name (Arabic) *'}</Label>
                  <Input value={formData.name_ar} onChange={(e) => setFormData({...formData, name_ar: e.target.value})} required />
                </div>
                <div>
                  <Label>{language === 'ar' ? 'اسم المنتج (إنجليزي)' : 'Product Name (English)'}</Label>
                  <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
                </div>
                <div>
                  <Label>{language === 'ar' ? 'الفئة' : 'Category'}</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORIES).map(([key, val]) => (
                        <SelectItem key={key} value={key}>{language === 'ar' ? val.ar : val.en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{language === 'ar' ? 'رمز SKU' : 'SKU'}</Label>
                  <Input value={formData.sku} onChange={(e) => setFormData({...formData, sku: e.target.value})} placeholder="Auto-generated" />
                </div>
                <div>
                  <Label>{language === 'ar' ? 'سعر البيع *' : 'Sale Price *'}</Label>
                  <Input type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} required />
                </div>
                <div>
                  <Label>{language === 'ar' ? 'سعر التكلفة' : 'Cost Price'}</Label>
                  <Input type="number" step="0.01" value={formData.cost} onChange={(e) => setFormData({...formData, cost: e.target.value})} />
                </div>
                <div>
                  <Label>{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
                  <Input type="number" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: e.target.value})} />
                </div>
                <div>
                  <Label>{language === 'ar' ? 'الحد الأدنى للتنبيه' : 'Min Stock Alert'}</Label>
                  <Input type="number" value={formData.min_quantity} onChange={(e) => setFormData({...formData, min_quantity: e.target.value})} />
                </div>
                <div className="col-span-2">
                  <Label>{language === 'ar' ? 'الوصف' : 'Description'}</Label>
                  <Textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>{t('cancel')}</Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {editingProduct ? (language === 'ar' ? 'تحديث' : 'Update') : (language === 'ar' ? 'إضافة' : 'Add')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Stock Update Dialog */}
        <Dialog open={isStockDialogOpen} onOpenChange={setIsStockDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{language === 'ar' ? 'تعديل المخزون' : 'Update Stock'}</DialogTitle>
            </DialogHeader>
            {selectedProduct && (
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg text-center">
                  <p className="font-medium">{selectedProduct.name_ar}</p>
                  <p className="text-sm text-muted-foreground">{language === 'ar' ? 'الكمية الحالية:' : 'Current:'} <span className="font-bold">{selectedProduct.quantity}</span></p>
                </div>
                <div>
                  <Label>{language === 'ar' ? 'التغيير (+ إضافة / - سحب)' : 'Change (+add / -remove)'}</Label>
                  <Input type="number" value={stockChange} onChange={(e) => setStockChange(parseInt(e.target.value) || 0)} className="text-center text-lg" />
                </div>
                <div className="p-3 bg-primary/5 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">{language === 'ar' ? 'الكمية الجديدة:' : 'New Qty:'}</p>
                  <p className="text-2xl font-bold text-primary">{selectedProduct.quantity + stockChange}</p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsStockDialogOpen(false)}>{t('cancel')}</Button>
              <Button onClick={handleStockUpdate} disabled={saving || !stockChange}>
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {language === 'ar' ? 'تحديث' : 'Update'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </>)}

        {/* Discounts Tab */}
        {activeTab === 'discounts' && (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold">{language === 'ar' ? 'كوبونات الخصم' : 'Discount Coupons'}</h3>
                  <Button onClick={() => openDiscountDialog()}>
                    <Plus className="w-4 h-4 me-2" />{language === 'ar' ? 'إضافة كوبون' : 'Add Coupon'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {discounts.length === 0 ? (
                <Card className="col-span-full p-8 text-center text-muted-foreground">
                  <Percent className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{language === 'ar' ? 'لا توجد كوبونات' : 'No coupons found'}</p>
                </Card>
              ) : discounts.map(discount => (
                <Card key={discount.id} className={`${!discount.is_active ? 'opacity-60' : ''}`}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg font-mono">{discount.code}</CardTitle>
                        <p className="text-sm text-muted-foreground">{discount.name_ar}</p>
                      </div>
                      <Badge className={discount.is_active ? 'bg-green-500' : 'bg-gray-400'}>
                        {discount.is_active ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'معطل' : 'Disabled')}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-center p-3 bg-purple-50 rounded-lg">
                      <span className="text-3xl font-bold text-purple-600">
                        {discount.discount_type === 'percentage' ? `${discount.value}%` : `${discount.value} ${t('sar')}`}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {discount.discount_type === 'percentage' ? (language === 'ar' ? 'نسبة خصم' : 'Percentage') : (language === 'ar' ? 'مبلغ ثابت' : 'Fixed Amount')}
                      </p>
                    </div>
                    {/* Show branch info for admin */}
                    {isAdmin && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {language === 'ar' ? 'الفرع:' : 'Branch:'}
                        </span>
                        <span className="font-medium">
                          {discount.branch_id 
                            ? (branches.find(b => b.id === discount.branch_id)?.name_ar || branches.find(b => b.id === discount.branch_id)?.name || discount.branch_id)
                            : (language === 'ar' ? 'عام (جميع الفروع)' : 'Global (All)')}
                        </span>
                      </div>
                    )}
                    {Array.isArray(discount.activity_ids) && discount.activity_ids.length > 0 && (
                      <div className="text-sm p-2 bg-amber-50 rounded-md" data-testid={`coupon-offer-badge-${discount.id}`}>
                        <span className="text-amber-700 font-medium">{language === 'ar' ? '🎯 عرض مشروط بالأنشطة: ' : '🎯 Offer requires: '}</span>
                        <span className="text-amber-800">
                          {discount.activity_ids
                            .map(id => couponActivities.find(a => a.id === id))
                            .map((a, i) => a ? (a.name_ar || a.name) : (language === 'ar' ? 'نشاط محذوف' : 'Deleted activity'))
                            .join('، ')}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{language === 'ar' ? 'الحد الأدنى:' : 'Min Purchase:'}</span>
                      <span>{discount.min_purchase} {t('sar')}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{language === 'ar' ? 'الاستخدام:' : 'Usage:'}</span>
                      <span>{discount.used_count} / {discount.max_uses || '∞'}</span>
                    </div>
                    <div className="flex gap-2 pt-2 border-t">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => openDiscountDialog(discount)}>
                        <Edit className="w-3 h-3 me-1" />{language === 'ar' ? 'تعديل' : 'Edit'}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDeleteDiscount(discount.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Add/Edit Discount Dialog */}
            <Dialog open={isDiscountDialogOpen} onOpenChange={setIsDiscountDialogOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Percent className="w-5 h-5" />
                    {editingDiscount ? (language === 'ar' ? 'تعديل الكوبون' : 'Edit Coupon') : (language === 'ar' ? 'إضافة كوبون جديد' : 'Add New Coupon')}
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleDiscountSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{language === 'ar' ? 'رمز الكوبون *' : 'Coupon Code *'}</Label>
                      <Input value={discountForm.code} onChange={(e) => setDiscountForm({...discountForm, code: e.target.value.toUpperCase()})} placeholder="SAVE20" required />
                    </div>
                    <div>
                      <Label>{language === 'ar' ? 'الاسم *' : 'Name *'}</Label>
                      <Input value={discountForm.name_ar} onChange={(e) => setDiscountForm({...discountForm, name_ar: e.target.value})} required />
                    </div>
                    <div>
                      <Label>{language === 'ar' ? 'نوع الخصم' : 'Discount Type'}</Label>
                      <Select value={discountForm.discount_type} onValueChange={(v) => setDiscountForm({...discountForm, discount_type: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">{language === 'ar' ? 'نسبة مئوية %' : 'Percentage %'}</SelectItem>
                          <SelectItem value="fixed">{language === 'ar' ? 'مبلغ ثابت' : 'Fixed Amount'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{language === 'ar' ? 'القيمة *' : 'Value *'}</Label>
                      <Input type="number" step="0.01" value={discountForm.value} onChange={(e) => setDiscountForm({...discountForm, value: e.target.value})} required />
                    </div>
                    <div>
                      <Label>{language === 'ar' ? 'الحد الأدنى للشراء' : 'Min Purchase'}</Label>
                      <Input type="number" value={discountForm.min_purchase} onChange={(e) => setDiscountForm({...discountForm, min_purchase: e.target.value})} />
                    </div>
                    <div>
                      <Label>{language === 'ar' ? 'الحد الأقصى للاستخدام' : 'Max Uses'}</Label>
                      <Input type="number" value={discountForm.max_uses} onChange={(e) => setDiscountForm({...discountForm, max_uses: e.target.value})} placeholder="0 = غير محدود" />
                    </div>
                    {/* Admin only: Branch selection */}
                    {isAdmin && branches.length > 0 && (
                      <div className="col-span-2">
                        <Label className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {language === 'ar' ? 'الفرع' : 'Branch'}
                        </Label>
                        <Select value={discountForm.branch_id} onValueChange={(v) => {
                          const visibleIds = new Set(getCouponActivitiesForBranch(v).map(a => a.id));
                          setDiscountForm({
                            ...discountForm,
                            branch_id: v,
                            activity_ids: (discountForm.activity_ids || []).filter(id => visibleIds.has(id))
                          });
                        }}>
                          <SelectTrigger data-testid="coupon-branch-select">
                            <SelectValue placeholder={language === 'ar' ? 'اختر الفرع' : 'Select Branch'} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              {language === 'ar' ? '🏢 جميع الفروع (كوبون عام)' : '🏢 All Branches (Global)'}
                            </SelectItem>
                            {branches.map(branch => (
                              <SelectItem key={branch.id} value={branch.id}>
                                {branch.name_ar || branch.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {language === 'ar' ? 'حدد "جميع الفروع" لإنشاء كوبون عام أو اختر فرع محدد' : 'Select "All Branches" for a global coupon or choose a specific branch'}
                        </p>
                      </div>
                    )}
                    {/* Activity-scoped offer: coupon only valid when ALL selected activities are on the invoice */}
                    <div className="col-span-2">
                      <Label className="flex items-center gap-2">
                        <Dumbbell className="w-4 h-4" />
                        {language === 'ar' ? 'ربط الكوبون بأنشطة محددة (عرض)' : 'Link Coupon to Activities (Offer)'}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1 mb-2">
                        {language === 'ar'
                          ? 'اختياري: لو اخترت أنشطة، لن يُقبل الكوبون إلا إذا كانت كلها موجودة معاً في الفاتورة — مناسب لعروض الاشتراك في نشاطين'
                          : 'Optional: if activities are selected, the coupon is only accepted when ALL of them are on the invoice — ideal for two-activity bundle offers'}
                      </p>
                      <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto border rounded-md p-2" data-testid="coupon-activities-picker">
                        {getCouponActivitiesForBranch(discountForm.branch_id).length === 0 ? (
                          <span className="text-xs text-muted-foreground">{language === 'ar' ? 'لا توجد أنشطة' : 'No activities'}</span>
                        ) : getCouponActivitiesForBranch(discountForm.branch_id).map(act => {
                          const selected = discountForm.activity_ids.includes(act.id);
                          return (
                            <button
                              key={act.id}
                              type="button"
                              onClick={() => setDiscountForm({
                                ...discountForm,
                                activity_ids: selected
                                  ? discountForm.activity_ids.filter(id => id !== act.id)
                                  : [...discountForm.activity_ids, act.id]
                              })}
                              className={`px-2 py-1 rounded-full text-xs border transition-colors ${selected ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'}`}
                              data-testid={`coupon-activity-chip-${act.id}`}
                            >
                              {act.name_ar || act.name}
                            </button>
                          );
                        })}
                      </div>
                      {discountForm.activity_ids.length > 0 && (
                        <p className="text-xs text-purple-600 mt-1">
                          {language === 'ar'
                            ? `الكوبون مشروط بوجود ${discountForm.activity_ids.length} نشاط معاً في الفاتورة`
                            : `Coupon requires all ${discountForm.activity_ids.length} activities together on the invoice`}
                        </p>
                      )}
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" id="is_active" checked={discountForm.is_active} onChange={(e) => setDiscountForm({...discountForm, is_active: e.target.checked})} />
                      <Label htmlFor="is_active">{language === 'ar' ? 'كوبون نشط' : 'Active Coupon'}</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDiscountDialogOpen(false)}>{t('cancel')}</Button>
                    <Button type="submit" disabled={saving}>
                      {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                      {editingDiscount ? (language === 'ar' ? 'تحديث' : 'Update') : (language === 'ar' ? 'إضافة' : 'Add')}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        )}

        {/* ============ Product Invoices Tab ============ */}
        {activeTab === 'invoices' && (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="flex justify-between items-center">
                  <div className="flex gap-4 items-center">
                    <div className="text-sm">
                      <span className="text-muted-foreground">{language === 'ar' ? 'إجمالي المبيعات:' : 'Total Sales:'}</span>
                      <span className="font-bold text-green-600 ms-2">{stats.invoicesTotal.toLocaleString()} {t('sar')}</span>
                    </div>
                  </div>
                  <Button onClick={() => openInvoiceDialog()} className="bg-green-600 hover:bg-green-700">
                    <Plus className="w-4 h-4 me-2" />{language === 'ar' ? 'فاتورة جديدة' : 'New Invoice'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Invoices List */}
            <div className="space-y-3">
              {productInvoices.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">
                  <Receipt className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{language === 'ar' ? 'لا توجد فواتير منتجات' : 'No product invoices'}</p>
                </Card>
              ) : productInvoices.map(invoice => (
                <Card key={invoice.id} className={`p-4 hover:shadow-md transition-shadow ${invoice.status === 'draft' ? 'border-amber-300 bg-amber-50/30' : 'border-green-300 bg-green-50/30'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${invoice.status === 'draft' ? 'bg-amber-100' : 'bg-green-100'}`}>
                        <Receipt className={`w-5 h-5 ${invoice.status === 'draft' ? 'text-amber-600' : 'text-green-600'}`} />
                      </div>
                      <div>
                        <p className="font-bold">{invoice.invoice_number}</p>
                        <p className="text-sm text-muted-foreground">{invoice.customer_name}</p>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-lg">{invoice.total.toFixed(2)} {t('sar')}</p>
                      <Badge variant="outline" className={invoice.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>
                        {invoice.status === 'draft' ? (language === 'ar' ? 'مسودة' : 'Draft') : (language === 'ar' ? 'مدفوعة' : 'Paid')}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground text-end">
                      <p>{new Date(invoice.created_at).toLocaleDateString('ar-SA')}</p>
                      <p>{invoice.items.length} {language === 'ar' ? 'منتج' : 'items'}</p>
                    </div>
                    <div className="flex gap-2">
                      {invoice.status === 'draft' && (
                        <Button variant="outline" size="sm" onClick={() => openInvoiceDialog(invoice)}>
                          <Edit className="w-4 h-4 me-1" />{language === 'ar' ? 'تعديل' : 'Edit'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => viewInvoice(invoice)}>
                        <FileText className="w-4 h-4 me-1" />{language === 'ar' ? 'عرض' : 'View'}
                      </Button>
                      {invoice.status === 'draft' && (
                        <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteInvoice(invoice.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* ============ Product Invoice Dialog ============ */}
        <Dialog open={isInvoiceDialogOpen} onOpenChange={setIsInvoiceDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-green-600" />
                {editingInvoice && editingInvoice.invoice_number
                  ? (language === 'ar' ? `تعديل الفاتورة ${editingInvoice.invoice_number}` : `Edit Invoice ${editingInvoice.invoice_number}`)
                  : (language === 'ar' ? 'فاتورة منتجات جديدة' : 'New Product Invoice')
                }
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Customer Info */}
              <Card className="p-4 bg-blue-50 border-blue-200">
                <h4 className="font-semibold mb-3">{language === 'ar' ? 'بيانات العميل' : 'Customer Info'}</h4>
                <div className="mb-3">
                  <Label>{language === 'ar' ? 'ربط بعضو (اختياري)' : 'Link to Member (optional)'}</Label>
                  <div className="relative">
                    <Input
                      placeholder={language === 'ar' ? 'ابحث عن عضو بالاسم أو الجوال...' : 'Search member by name or phone...'}
                      value={memberSearchTerm}
                      onChange={(e) => setMemberSearchTerm(e.target.value)}
                      className="mt-1"
                    />
                    {memberSearchTerm && !selectedMemberId && (
                      <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {allMembers
                          .filter(m => {
                            const term = memberSearchTerm.toLowerCase();
                            return (m.name_ar || '').toLowerCase().includes(term) ||
                                   (m.name || '').toLowerCase().includes(term) ||
                                   (m.phone || '').includes(term);
                          })
                          .slice(0, 10)
                          .map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setSelectedMemberId(m.id);
                                setCustomerName(m.name_ar || m.name || '');
                                setCustomerPhone(m.phone || '');
                                setMemberSearchTerm(m.name_ar || m.name || '');
                              }}
                              className="w-full text-start px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b last:border-0"
                            >
                              <Users className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              <div>
                                <p className="text-sm font-medium">{m.name_ar || m.name}</p>
                                <p className="text-xs text-muted-foreground">{m.phone}</p>
                              </div>
                            </button>
                          ))}
                        {allMembers.filter(m => {
                          const term = memberSearchTerm.toLowerCase();
                          return (m.name_ar || '').toLowerCase().includes(term) || (m.name || '').toLowerCase().includes(term) || (m.phone || '').includes(term);
                        }).length === 0 && (
                          <p className="px-3 py-2 text-sm text-muted-foreground">{language === 'ar' ? 'لا توجد نتائج' : 'No results'}</p>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedMemberId && (
                    <div className="mt-2 flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-800">
                        <Users className="w-3 h-3 me-1" />
                        {allMembers.find(m => m.id === selectedMemberId)?.name_ar || customerName}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => { setSelectedMemberId(''); setMemberSearchTerm(''); }}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{language === 'ar' ? 'اسم العميل *' : 'Customer Name *'}</Label>
                    <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
                  </div>
                  <div>
                    <Label>{language === 'ar' ? 'رقم الجوال' : 'Phone'}</Label>
                    <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} dir="ltr" />
                  </div>
                </div>
              </Card>

              {/* Product Selection */}
              <Card className="p-4">
                <h4 className="font-semibold mb-3">{language === 'ar' ? 'اختر المنتجات' : 'Select Products'}</h4>
                <Select onValueChange={addProductToInvoice}>
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر منتج لإضافته...' : 'Select product to add...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {products.filter(p => p.quantity > 0).map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4" />
                          <span>{p.name_ar}</span>
                          <span className="text-muted-foreground">({p.quantity})</span>
                          <span className="font-bold">{p.price} {t('sar')}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Card>

              {/* Invoice Items */}
              {invoiceItems.length > 0 && (
                <Card className="p-4">
                  <h4 className="font-semibold mb-3">{language === 'ar' ? 'عناصر الفاتورة' : 'Invoice Items'}</h4>
                  <div className="space-y-2">
                    {invoiceItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-green-600" />
                          <span className="font-medium">{item.name}</span>
                          <span className="text-sm text-muted-foreground">@ {item.price} {t('sar')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateInvoiceItemQty(idx, item.quantity - 1)}>-</Button>
                          <span className="w-8 text-center font-bold">{item.quantity}</span>
                          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateInvoiceItemQty(idx, item.quantity + 1)}>+</Button>
                          <span className="w-20 text-end font-bold">{item.total} {t('sar')}</span>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeInvoiceItem(idx)}><X className="w-4 h-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex justify-between text-sm mb-1">
                      <span>{language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span>
                      <span>{calculateInvoiceTotals().subtotal.toFixed(2)} {t('sar')}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1 text-green-600">
                      <span>{language === 'ar' ? `ضريبة القيمة المضافة (${COMPANY_INFO.vat_rate}%)` : `VAT (${COMPANY_INFO.vat_rate}%)`}</span>
                      <span>{calculateInvoiceTotals().vatAmount.toFixed(2)} {t('sar')}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2">
                      <span>{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                      <span className="text-green-700">{calculateInvoiceTotals().total.toFixed(2)} {t('sar')}</span>
                    </div>
                  </div>
                </Card>
              )}

              {/* Payment Method */}
              <div>
                <Label>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{language === 'ar' ? 'نقدي' : 'Cash'}</SelectItem>
                    <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
                    <SelectItem value="transfer">{language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsInvoiceDialogOpen(false)}>{t('cancel')}</Button>
              <Button variant="outline" onClick={() => handleCreateProductInvoice(false)} disabled={saving || invoiceItems.length === 0} className="border-amber-500 text-amber-700 hover:bg-amber-50">
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft'}
              </Button>
              <Button onClick={() => handleCreateProductInvoice(true)} disabled={saving || invoiceItems.length === 0} className="bg-green-600 hover:bg-green-700">
                {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                <CheckCircle className="w-4 h-4 me-2" />
                {language === 'ar' ? 'دفع وحفظ' : 'Pay & Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ============ Invoice View Dialog ============ */}
        <Dialog open={isInvoiceViewOpen} onOpenChange={setIsInvoiceViewOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-green-600" />
                {language === 'ar' ? 'فاتورة منتجات' : 'Product Invoice'}
              </DialogTitle>
            </DialogHeader>
            
            {currentInvoice && (
              <div ref={invoiceRef} className="bg-white p-4 text-sm" dir="rtl">
                {/* Header */}
                <div className="text-center border-b pb-3 mb-3">
                  <h2 className="font-bold text-lg">{COMPANY_INFO.name_ar}</h2>
                  <p className="text-xs text-gray-600">الرقم الضريبي: {COMPANY_INFO.tax_number}</p>
                  <p className="text-xs text-gray-600">السجل التجاري: {COMPANY_INFO.commercial_reg}</p>
                  {/* Branch Name */}
                  <p className="mt-1 font-semibold text-orange-600">🏢 {getBranchName(currentInvoice.branch_id)}</p>
                </div>

                {/* Invoice Info */}
                <div className="mb-3 text-xs">
                  <p><strong>رقم الفاتورة:</strong> {currentInvoice.invoice_number}</p>
                  <p><strong>التاريخ:</strong> {new Date(currentInvoice.created_at).toLocaleDateString('ar-SA')}</p>
                  <p><strong>العميل:</strong> {currentInvoice.customer_name}</p>
                  {currentInvoice.customer_phone && <p><strong>الجوال:</strong> {currentInvoice.customer_phone}</p>}
                </div>

                {/* Items Table */}
                <table className="w-full text-xs border-collapse mb-3">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-1 text-right">المنتج</th>
                      <th className="border p-1 text-center">الكمية</th>
                      <th className="border p-1 text-center">السعر</th>
                      <th className="border p-1 text-left">المجموع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentInvoice.items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="border p-1">{item.name}</td>
                        <td className="border p-1 text-center">{item.quantity}</td>
                        <td className="border p-1 text-center">{item.price}</td>
                        <td className="border p-1 text-left">{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="border-t pt-2 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>المجموع الفرعي:</span>
                    <span>{currentInvoice.subtotal.toFixed(2)} ر.س</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>ضريبة القيمة المضافة ({COMPANY_INFO.vat_rate}%):</span>
                    <span>{currentInvoice.vat_amount.toFixed(2)} ر.س</span>
                  </div>
                  <div className="flex justify-between font-bold text-base border-t pt-2">
                    <span>الإجمالي:</span>
                    <span>{currentInvoice.total.toFixed(2)} ر.س</span>
                  </div>
                </div>

                {/* Payment Method */}
                <div className="mt-2 text-xs text-center text-gray-600">
                  طريقة الدفع: {currentInvoice?.payment_method === 'cash' ? 'نقدي' : currentInvoice?.payment_method === 'card' ? 'بطاقة' : 'تحويل بنكي'}
                </div>

                {/* ZATCA Compliant QR Code */}
                <div className="mt-4 flex flex-col items-center">
                  <QRCodeSVG value={generateZATCAQR(currentInvoice)} size={100} level="M" />
                  <p className="text-center text-xs text-gray-600 mt-2 font-bold">فاتورة ضريبية مبسطة</p>
                  <p className="text-center text-[10px] text-gray-400">متوافقة مع هيئة الزكاة والضريبة والجمارك</p>
                </div>

                {/* Footer */}
                <div className="mt-4 text-center text-xs text-gray-500 border-t pt-2">
                  <p>شكراً لتعاملكم معنا</p>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setIsInvoiceViewOpen(false)}>{language === 'ar' ? 'إغلاق' : 'Close'}</Button>
              <Button variant="outline" onClick={handleShareProductWhatsApp} className="bg-green-50 border-green-400 text-green-700 hover:bg-green-100">
                <MessageSquare className="w-4 h-4 me-2" />
                {language === 'ar' ? 'مشاركة واتساب' : 'Share WhatsApp'}
              </Button>
              <Button variant="outline" onClick={handleSaveInvoicePdf} className="bg-red-50 border-red-400 text-red-700 hover:bg-red-100">
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'PDF + واتساب' : 'PDF + WhatsApp'}
              </Button>
              <Button onClick={handlePrintInvoice}>
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

export default StorePage;
