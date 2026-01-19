import React, { useState, useEffect } from 'react';
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
import { productsAPI, discountsAPI } from '../services/api';
import { toast } from 'sonner';
import { 
  Package, Plus, Search, Edit, Trash2, AlertTriangle, 
  ShoppingBag, TrendingUp, TrendingDown, Loader2, BarChart3, X, Percent, Tag
} from 'lucide-react';

const CATEGORIES = {
  swimming: { ar: 'أدوات السباحة', en: 'Swimming' },
  sports: { ar: 'أدوات رياضية', en: 'Sports' },
  accessories: { ar: 'إكسسوارات', en: 'Accessories' },
  clothing: { ar: 'ملابس رياضية', en: 'Clothing' },
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
  const [activeTab, setActiveTab] = useState('products'); // products or discounts
  
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

  const filteredProducts = products.filter(p => {
    const matchSearch = p.name_ar.includes(searchTerm) || p.name?.includes(searchTerm) || p.sku?.includes(searchTerm);
    const matchCategory = filterCategory === 'all' || p.category === filterCategory;
    return matchSearch && matchCategory;
  });

  const stats = {
    total: products.length,
    lowStock: products.filter(p => p.quantity <= p.min_quantity).length,
    totalValue: products.reduce((sum, p) => sum + (p.price * p.quantity), 0),
    totalCost: products.reduce((sum, p) => sum + (p.cost * p.quantity), 0)
  };

  if (loading) {
    return <Layout title={language === 'ar' ? 'المخزن' : 'Store'}><div className="flex items-center justify-center h-64"><div className="spinner" /></div></Layout>;
  }

  return (
    <Layout title={language === 'ar' ? 'المخزن' : 'Store'}>
      <div className="space-y-6" data-testid="store-page">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="stat-card">
            <div className="stat-card-icon bg-primary/10"><Package className="w-6 h-6 text-primary" /></div>
            <div className="stat-card-value text-primary">{stats.total}</div>
            <div className="stat-card-label">{language === 'ar' ? 'إجمالي المنتجات' : 'Total Products'}</div>
          </Card>
          <Card className="stat-card">
            <div className="stat-card-icon bg-amber-500/10"><AlertTriangle className="w-6 h-6 text-amber-500" /></div>
            <div className="stat-card-value text-amber-500">{stats.lowStock}</div>
            <div className="stat-card-label">{language === 'ar' ? 'مخزون منخفض' : 'Low Stock'}</div>
          </Card>
          <Card className="stat-card">
            <div className="stat-card-icon bg-green-500/10"><TrendingUp className="w-6 h-6 text-green-500" /></div>
            <div className="stat-card-value text-green-500">{stats.totalValue.toLocaleString()} {t('sar')}</div>
            <div className="stat-card-label">{language === 'ar' ? 'قيمة المخزون (البيع)' : 'Stock Value (Sale)'}</div>
          </Card>
          <Card className="stat-card">
            <div className="stat-card-icon bg-blue-500/10"><BarChart3 className="w-6 h-6 text-blue-500" /></div>
            <div className="stat-card-value text-blue-500">{stats.totalCost.toLocaleString()} {t('sar')}</div>
            <div className="stat-card-label">{language === 'ar' ? 'قيمة المخزون (التكلفة)' : 'Stock Value (Cost)'}</div>
          </Card>
        </div>

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
              <Button onClick={openCreateDialog} data-testid="add-product-btn">
                <Plus className="w-4 h-4 me-2" />{language === 'ar' ? 'إضافة منتج' : 'Add Product'}
              </Button>
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
      </div>
    </Layout>
  );
};

export default StorePage;
