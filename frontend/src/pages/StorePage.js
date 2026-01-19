import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { productsAPI, discountsAPI, productInvoicesAPI } from '../services/api';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import html2pdf from 'html2pdf.js';
import { 
  Package, Plus, Search, Edit, Trash2, AlertTriangle, 
  ShoppingBag, TrendingUp, TrendingDown, Loader2, BarChart3, X, Percent, Tag,
  Receipt, Printer, FileText, CheckCircle, Eye
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
  const [products, setProducts] = useState([]);
  const [discounts, setDiscounts] = useState([]);
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
    value: '', min_purchase: '0', max_uses: '0', is_active: true
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [productsRes, discountsRes] = await Promise.all([
        productsAPI.getAll(),
        discountsAPI.getAll()
      ]);
      setProducts(productsRes.data);
      setDiscounts(discountsRes.data);
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل البيانات' : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await productsAPI.getAll();
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
        is_active: discount.is_active
      });
    } else {
      setEditingDiscount(null);
      setDiscountForm({
        code: '', name_ar: '', name: '', discount_type: 'percentage',
        value: '', min_purchase: '0', max_uses: '0', is_active: true
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
        max_uses: parseInt(discountForm.max_uses) || 0
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
      // Edit existing invoice
      setEditingInvoice(invoice);
      setInvoiceItems(invoice.items || []);
      setCustomerName(invoice.customer_name || '');
      setCustomerPhone(invoice.customer_phone || '');
      setPaymentMethod(invoice.payment_method || 'cash');
      setInvoiceStatus(invoice.status || 'draft');
    } else {
      // New invoice
      setEditingInvoice(null);
      setInvoiceItems([]);
      setCustomerName('');
      setCustomerPhone('');
      setPaymentMethod('cash');
      setInvoiceStatus('draft');
    }
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
      
      // Only deduct stock if marking as paid
      if (asPaid) {
        for (const item of invoiceItems) {
          await productsAPI.updateStock(item.product_id, -item.quantity);
        }
      }

      const { subtotal, vatAmount, total } = calculateInvoiceTotals();
      const invoice = {
        id: editingInvoice?.id || `INV-${Date.now()}`,
        invoice_number: editingInvoice?.invoice_number || generateInvoiceNumber(),
        customer_name: customerName,
        customer_phone: customerPhone,
        payment_method: paymentMethod,
        items: invoiceItems,
        subtotal,
        vat_amount: vatAmount,
        vat_rate: COMPANY_INFO.vat_rate,
        total,
        created_at: editingInvoice?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status
      };

      if (editingInvoice) {
        // Update existing invoice
        const updatedInvoices = productInvoices.map(inv => 
          inv.id === editingInvoice.id ? invoice : inv
        );
        setProductInvoices(updatedInvoices);
        toast.success(language === 'ar' ? 'تم تحديث الفاتورة' : 'Invoice updated');
      } else {
        // Add new invoice
        setProductInvoices([invoice, ...productInvoices]);
        toast.success(language === 'ar' ? (asPaid ? 'تم إنشاء الفاتورة ودفعها' : 'تم حفظ الفاتورة كمسودة') : (asPaid ? 'Invoice created and paid' : 'Invoice saved as draft'));
      }

      setCurrentInvoice(invoice);
      setIsInvoiceDialogOpen(false);
      
      if (asPaid) {
        setIsInvoiceViewOpen(true);
        loadData(); // Refresh products to update stock
      }
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ الفاتورة' : 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteInvoice = (invoiceId) => {
    if (!window.confirm(language === 'ar' ? 'هل تريد حذف هذه الفاتورة؟' : 'Delete this invoice?')) return;
    setProductInvoices(productInvoices.filter(inv => inv.id !== invoiceId));
    toast.success(language === 'ar' ? 'تم حذف الفاتورة' : 'Invoice deleted');
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
    if (!invoiceRef.current) return;
    const opt = {
      margin: 5,
      filename: `${customerName}_${currentInvoice?.invoice_number}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: [80, 200], orientation: 'portrait' }
    };
    await html2pdf().from(invoiceRef.current).set(opt).save();
    toast.success(language === 'ar' ? 'تم حفظ الفاتورة' : 'Invoice saved');
  };

  const generateQRData = (invoice) => {
    if (!invoice) return '';
    // ZATCA QR format (simplified)
    return JSON.stringify({
      seller: COMPANY_INFO.name_ar,
      vat: COMPANY_INFO.tax_number,
      date: new Date(invoice.created_at).toISOString(),
      total: invoice.total,
      vat_amount: invoice.vat_amount
    });
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
                  طريقة الدفع: {paymentMethod === 'cash' ? 'نقدي' : paymentMethod === 'card' ? 'بطاقة' : 'تحويل بنكي'}
                </div>

                {/* QR Code */}
                <div className="mt-4 flex justify-center">
                  <QRCodeSVG value={generateQRData(currentInvoice)} size={80} />
                </div>
                <p className="text-center text-xs text-gray-500 mt-1">فاتورة ضريبية مبسطة</p>

                {/* Footer */}
                <div className="mt-4 text-center text-xs text-gray-500 border-t pt-2">
                  <p>شكراً لتعاملكم معنا</p>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsInvoiceViewOpen(false)}>{language === 'ar' ? 'إغلاق' : 'Close'}</Button>
              <Button variant="outline" onClick={handleSaveInvoicePdf}>
                <FileText className="w-4 h-4 me-2" />
                {language === 'ar' ? 'حفظ PDF' : 'Save PDF'}
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
