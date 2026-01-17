import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import api from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Building2,
  Phone,
  User,
  MapPin,
  Loader2
} from 'lucide-react';

const BranchesPage = () => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    phone: '',
    manager_name: '',
    manager_name_ar: '',
    address: '',
    address_ar: '',
    is_active: true
  });

  useEffect(() => {
    loadBranches();
  }, []);

  const loadBranches = async () => {
    try {
      const response = await api.get('/branches');
      setBranches(response.data);
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل الفروع' : 'Error loading branches');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name_ar || !formData.phone) {
      toast.error(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Please fill required fields');
      return;
    }

    setSaving(true);
    try {
      if (editingBranch) {
        await api.put(`/branches/${editingBranch.id}`, formData);
        toast.success(language === 'ar' ? 'تم تحديث الفرع بنجاح' : 'Branch updated successfully');
      } else {
        await api.post('/branches', formData);
        toast.success(language === 'ar' ? 'تم إضافة الفرع بنجاح' : 'Branch added successfully');
      }
      loadBranches();
      handleCloseDialog();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حفظ الفرع' : 'Error saving branch');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (branchId) => {
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا الفرع؟' : 'Are you sure you want to delete this branch?')) {
      return;
    }
    try {
      await api.delete(`/branches/${branchId}`);
      toast.success(language === 'ar' ? 'تم حذف الفرع' : 'Branch deleted');
      loadBranches();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حذف الفرع' : 'Error deleting branch');
    }
  };

  const handleEdit = (branch) => {
    setEditingBranch(branch);
    setFormData({
      name: branch.name || '',
      name_ar: branch.name_ar || '',
      phone: branch.phone || '',
      manager_name: branch.manager_name || '',
      manager_name_ar: branch.manager_name_ar || '',
      address: branch.address || '',
      address_ar: branch.address_ar || '',
      is_active: branch.is_active !== false
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingBranch(null);
    setFormData({
      name: '',
      name_ar: '',
      phone: '',
      manager_name: '',
      manager_name_ar: '',
      address: '',
      address_ar: '',
      is_active: true
    });
  };

  const isAdmin = user?.is_admin;

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">{language === 'ar' ? 'ليس لديك صلاحية الوصول لهذه الصفحة' : 'You do not have access to this page'}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">{language === 'ar' ? 'إدارة الفروع' : 'Branches Management'}</h1>
            <p className="text-muted-foreground">{language === 'ar' ? 'إضافة وتعديل فروع الأكاديمية' : 'Add and manage academy branches'}</p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-branch-btn">
            <Plus className="w-4 h-4 me-2" />
            {language === 'ar' ? 'إضافة فرع' : 'Add Branch'}
          </Button>
        </div>

        {/* Branches Grid */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : branches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{language === 'ar' ? 'لا توجد فروع بعد' : 'No branches yet'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((branch) => (
              <Card key={branch.id} className="hover:shadow-md transition-shadow" data-testid={`branch-card-${branch.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">{branch.name_ar || branch.name}</CardTitle>
                    </div>
                    <Badge variant={branch.is_active ? "default" : "secondary"}>
                      {branch.is_active ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'غير نشط' : 'Inactive')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-4 h-4" />
                    <span dir="ltr">{branch.phone}</span>
                  </div>
                  {(branch.manager_name_ar || branch.manager_name) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="w-4 h-4" />
                      <span>{branch.manager_name_ar || branch.manager_name}</span>
                    </div>
                  )}
                  {(branch.address_ar || branch.address) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="w-4 h-4" />
                      <span>{branch.address_ar || branch.address}</span>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(branch)} data-testid={`edit-branch-${branch.id}`}>
                      <Edit className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'تعديل' : 'Edit'}
                    </Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(branch.id)} data-testid={`delete-branch-${branch.id}`}>
                      <Trash2 className="w-4 h-4 me-1" />
                      {language === 'ar' ? 'حذف' : 'Delete'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingBranch 
                  ? (language === 'ar' ? 'تعديل الفرع' : 'Edit Branch')
                  : (language === 'ar' ? 'إضافة فرع جديد' : 'Add New Branch')
                }
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'اسم الفرع (عربي)' : 'Branch Name (Arabic)'} *</Label>
                  <Input
                    value={formData.name_ar}
                    onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                    placeholder={language === 'ar' ? 'الفرع الرئيسي' : 'Main Branch'}
                    data-testid="branch-name-ar-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'اسم الفرع (إنجليزي)' : 'Branch Name (English)'}</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Main Branch"
                    data-testid="branch-name-input"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'رقم الجوال' : 'Phone Number'} *</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                  data-testid="branch-phone-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'المدير المسؤول (عربي)' : 'Manager (Arabic)'}</Label>
                  <Input
                    value={formData.manager_name_ar}
                    onChange={(e) => setFormData({ ...formData, manager_name_ar: e.target.value })}
                    data-testid="branch-manager-ar-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'المدير المسؤول (إنجليزي)' : 'Manager (English)'}</Label>
                  <Input
                    value={formData.manager_name}
                    onChange={(e) => setFormData({ ...formData, manager_name: e.target.value })}
                    data-testid="branch-manager-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'العنوان' : 'Address'}</Label>
                <Input
                  value={formData.address_ar}
                  onChange={(e) => setFormData({ ...formData, address_ar: e.target.value })}
                  placeholder={language === 'ar' ? 'العنوان بالعربي' : 'Address in Arabic'}
                  data-testid="branch-address-input"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>{language === 'ar' ? 'الفرع نشط' : 'Branch Active'}</Label>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  data-testid="branch-active-switch"
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-branch-btn">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {editingBranch 
                    ? (language === 'ar' ? 'تحديث' : 'Update')
                    : (language === 'ar' ? 'إضافة' : 'Add')
                  }
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default BranchesPage;
