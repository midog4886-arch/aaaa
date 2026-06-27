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
import api from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Building2,
  Phone,
  Loader2
} from 'lucide-react';

const WEEKDAYS = [
  { id: 'saturday', name_ar: 'السبت', name_en: 'Saturday' },
  { id: 'sunday', name_ar: 'الأحد', name_en: 'Sunday' },
  { id: 'monday', name_ar: 'الاثنين', name_en: 'Monday' },
  { id: 'tuesday', name_ar: 'الثلاثاء', name_en: 'Tuesday' },
  { id: 'wednesday', name_ar: 'الأربعاء', name_en: 'Wednesday' },
  { id: 'thursday', name_ar: 'الخميس', name_en: 'Thursday' },
  { id: 'friday', name_ar: 'الجمعة', name_en: 'Friday' },
];
const ALL_WEEKDAY_IDS = WEEKDAYS.map(d => d.id);

const BranchesPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name_ar: '',
    public_name: '',
    phone: '',
    code_prefix: '',
    whatsapp_group_url: '',
    working_days: [...ALL_WEEKDAY_IDS]
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
    if ((formData.working_days || []).length === 0) {
      toast.error(language === 'ar' ? 'اختر يوم عمل واحد على الأقل للفرع' : 'Select at least one working day');
      return;
    }

    setSaving(true);
    try {
      const cleanedPrefix = (formData.code_prefix || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 8);
      const dataToSend = {
        name: formData.name_ar,
        name_ar: formData.name_ar,
        public_name: (formData.public_name || '').trim(),
        phone: formData.phone,
        manager_name: '',
        manager_name_ar: '',
        address: '',
        address_ar: '',
        is_active: true,
        code_prefix: cleanedPrefix,
        whatsapp_group_url: (formData.whatsapp_group_url || '').trim(),
        working_days: WEEKDAYS
          .map(d => d.id)
          .filter(id => (formData.working_days || []).includes(id))
      };
      
      if (editingBranch) {
        await api.put(`/branches/${editingBranch.id}`, dataToSend);
        toast.success(language === 'ar' ? 'تم تحديث الفرع بنجاح' : 'Branch updated successfully');
      } else {
        await api.post('/branches', dataToSend);
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
      name_ar: branch.name_ar || branch.name || '',
      public_name: branch.public_name || '',
      phone: branch.phone || '',
      code_prefix: branch.code_prefix || '',
      whatsapp_group_url: branch.whatsapp_group_url || '',
      // Missing/empty working_days means the branch was created before this
      // feature -> treat it as open all week.
      working_days: Array.isArray(branch.working_days) && branch.working_days.length > 0
        ? branch.working_days
        : [...ALL_WEEKDAY_IDS]
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingBranch(null);
    setFormData({
      name_ar: '',
      public_name: '',
      phone: '',
      code_prefix: '',
      whatsapp_group_url: '',
      working_days: [...ALL_WEEKDAY_IDS]
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
                    <Badge variant={branch.is_active !== false ? "default" : "secondary"}>
                      {branch.is_active !== false ? (language === 'ar' ? 'نشط' : 'Active') : (language === 'ar' ? 'غير نشط' : 'Inactive')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-4 h-4" />
                    <span dir="ltr">{branch.phone}</span>
                  </div>
                  {branch.code_prefix && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'بادئة كود العضوية:' : 'Member code prefix:'}
                      </span>
                      <Badge variant="outline" dir="ltr">{branch.code_prefix}-001</Badge>
                    </div>
                  )}
                  <div className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {language === 'ar' ? 'أيام العمل:' : 'Working days:'}
                    </span>
                    {(!Array.isArray(branch.working_days) || branch.working_days.length === 0 || branch.working_days.length === ALL_WEEKDAY_IDS.length) ? (
                      <span>{language === 'ar' ? 'كل أيام الأسبوع' : 'All week'}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {WEEKDAYS.filter(d => branch.working_days.includes(d.id)).map(d => (
                          <Badge key={d.id} variant="secondary" className="text-xs">
                            {language === 'ar' ? d.name_ar : d.name_en}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
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

        {/* Add/Edit Dialog - Simplified */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {editingBranch 
                  ? (language === 'ar' ? 'تعديل الفرع' : 'Edit Branch')
                  : (language === 'ar' ? 'إضافة فرع جديد' : 'Add New Branch')
                }
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'اسم الفرع' : 'Branch Name'} *</Label>
                <Input
                  value={formData.name_ar}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                  placeholder={language === 'ar' ? 'مثال: الفرع الرئيسي' : 'e.g. Main Branch'}
                  data-testid="branch-name-input"
                />
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'اسم العرض العام (اختياري)' : 'Public display name (optional)'}</Label>
                <Input
                  value={formData.public_name}
                  onChange={(e) => setFormData({ ...formData, public_name: e.target.value })}
                  placeholder={language === 'ar' ? 'الاسم اللي هيظهر للأهالي في صفحة التسجيل' : 'Name shown to parents on the public registration page'}
                  data-testid="branch-public-name-input"
                />
                <p className="text-xs text-gray-500">
                  {language === 'ar'
                    ? 'لو سيبته فاضي هيظهر اسم الفرع العادي للأهالي.'
                    : 'Leave empty to show the normal branch name.'}
                </p>
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

              <div className="space-y-2">
                <Label>
                  {language === 'ar' ? 'بادئة كود العضوية' : 'Member Code Prefix'}
                </Label>
                <Input
                  value={formData.code_prefix}
                  onChange={(e) => setFormData({
                    ...formData,
                    code_prefix: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
                  })}
                  placeholder={language === 'ar' ? 'مثال: RYD' : 'e.g. RYD'}
                  dir="ltr"
                  maxLength={8}
                  data-testid="branch-code-prefix-input"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? `سيتم توليد أكواد الأعضاء في هذا الفرع بصيغة ${formData.code_prefix || 'PREFIX'}-001, ${formData.code_prefix || 'PREFIX'}-002 ... (اتركه فارغًا للتوليد التلقائي)`
                    : `New member codes in this branch will be ${formData.code_prefix || 'PREFIX'}-001, ${formData.code_prefix || 'PREFIX'}-002 ... (leave empty for auto)`}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'أيام عمل الفرع' : 'Branch Working Days'}</Label>
                <div className="grid grid-cols-2 gap-2 p-2 border rounded">
                  {WEEKDAYS.map(d => {
                    const checked = (formData.working_days || []).includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm border ${checked ? 'bg-primary/10 border-primary' : 'border-gray-200 hover:bg-gray-50'}`}
                        data-testid={`branch-day-${d.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const cur = new Set(formData.working_days || []);
                            if (e.target.checked) cur.add(d.id); else cur.delete(d.id);
                            setFormData({
                              ...formData,
                              working_days: WEEKDAYS.map(w => w.id).filter(id => cur.has(id))
                            });
                          }}
                          className="w-4 h-4"
                        />
                        <span>{language === 'ar' ? d.name_ar : d.name_en}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'الأيام المختارة فقط هي اللي هتظهر في صفحة المستويات والجدول لهذا الفرع.'
                    : 'Only the selected days will appear on the levels/schedule page for this branch.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'رابط جروب الواتساب الخاص بالفرع' : 'Branch WhatsApp Group Link'}</Label>
                <Input
                  value={formData.whatsapp_group_url}
                  onChange={(e) => setFormData({ ...formData, whatsapp_group_url: e.target.value })}
                  placeholder="https://chat.whatsapp.com/XXXXXXXXXXXX"
                  dir="ltr"
                  data-testid="branch-whatsapp-group-input"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'ar'
                    ? 'سيتم إدراج هذا الرابط في رسائل واتساب الفواتير واستمارات التسجيل لهذا الفرع. اتركه فارغًا لإخفاء الرابط من الرسائل.'
                    : 'This link will be inserted in WhatsApp messages for invoices and registration forms of this branch. Leave empty to omit the link.'}
                </p>
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
