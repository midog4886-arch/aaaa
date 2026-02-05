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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import api from '../services/api';
import { toast } from 'sonner';
import { 
  Plus, 
  Edit, 
  Trash2, 
  User,
  Shield,
  Building2,
  Loader2,
  Eye,
  EyeOff,
  Check
} from 'lucide-react';

// Available permissions
const ALL_PERMISSIONS = [
  { key: 'dashboard', label_ar: 'لوحة التحكم', label_en: 'Dashboard' },
  { key: 'members', label_ar: 'الأعضاء', label_en: 'Members' },
  { key: 'activities', label_ar: 'الأنشطة', label_en: 'Activities' },
  { key: 'levels', label_ar: 'المستويات', label_en: 'Levels' },
  { key: 'schedule', label_ar: 'الجدول', label_en: 'Schedule' },
  { key: 'attendance', label_ar: 'الحضور', label_en: 'Attendance' },
  { key: 'invoices', label_ar: 'الفواتير', label_en: 'Invoices' },
  { key: 'store', label_ar: 'المخزن', label_en: 'Store' },
  { key: 'accounting', label_ar: 'المحاسبة', label_en: 'Accounting' },
  { key: 'reports', label_ar: 'التقارير', label_en: 'Reports' },
  { key: 'messages', label_ar: 'الرسائل', label_en: 'Messages' },
  { key: 'settings', label_ar: 'الإعدادات', label_en: 'Settings' },
];

const UsersPage = () => {
  const { language } = useLanguage();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    name: '',
    branch_id: '',
    is_admin: false,
    permissions: []
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [usersRes, branchesRes] = await Promise.all([
        api.get('/users'),
        api.get('/branches')
      ]);
      setUsers(usersRes.data);
      setBranches(branchesRes.data);
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في تحميل البيانات' : 'Error loading data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!editingUser && (!formData.username || !formData.password || !formData.name)) {
      toast.error(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Please fill required fields');
      return;
    }
    
    if (editingUser && (!formData.name || !formData.username)) {
      toast.error(language === 'ar' ? 'يرجى ملء الحقول المطلوبة' : 'Please fill required fields');
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        const updateData = {
          username: formData.username,
          name: formData.name,
          branch_id: formData.branch_id || null,
          is_admin: formData.is_admin,
          permissions: formData.is_admin ? [] : formData.permissions
        };
        if (formData.password) {
          updateData.password = formData.password;
        }
        await api.put(`/users/${editingUser.id}`, updateData);
        toast.success(language === 'ar' ? 'تم تحديث المستخدم بنجاح' : 'User updated successfully');
      } else {
        await api.post('/users/create', {
          username: formData.username,
          password: formData.password,
          name: formData.name,
          branch_id: formData.branch_id || null,
          is_admin: formData.is_admin,
          permissions: formData.is_admin ? [] : formData.permissions
        });
        toast.success(language === 'ar' ? 'تم إضافة المستخدم بنجاح' : 'User added successfully');
      }
      loadData();
      handleCloseDialog();
    } catch (error) {
      const errorMsg = error.response?.data?.detail || (language === 'ar' ? 'خطأ في حفظ المستخدم' : 'Error saving user');
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId) => {
    if (userId === currentUser?.id) {
      toast.error(language === 'ar' ? 'لا يمكنك حذف نفسك' : 'Cannot delete yourself');
      return;
    }
    
    if (!window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا المستخدم؟' : 'Are you sure you want to delete this user?')) {
      return;
    }
    
    try {
      await api.delete(`/users/${userId}`);
      toast.success(language === 'ar' ? 'تم حذف المستخدم' : 'User deleted');
      loadData();
    } catch (error) {
      toast.error(language === 'ar' ? 'خطأ في حذف المستخدم' : 'Error deleting user');
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      name: user.name,
      branch_id: user.branch_id || '',
      is_admin: user.is_admin || false,
      permissions: user.permissions || []
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingUser(null);
    setShowPassword(false);
    setFormData({
      username: '',
      password: '',
      name: '',
      branch_id: '',
      is_admin: false,
      permissions: []
    });
  };

  const togglePermission = (permKey) => {
    setFormData(prev => {
      const newPermissions = prev.permissions.includes(permKey)
        ? prev.permissions.filter(p => p !== permKey)
        : [...prev.permissions, permKey];
      return { ...prev, permissions: newPermissions };
    });
  };

  const selectAllPermissions = () => {
    setFormData(prev => ({
      ...prev,
      permissions: ALL_PERMISSIONS.map(p => p.key)
    }));
  };

  const clearAllPermissions = () => {
    setFormData(prev => ({
      ...prev,
      permissions: []
    }));
  };

  const isAdmin = currentUser?.is_admin;

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
            <h1 className="text-2xl font-bold">{language === 'ar' ? 'إدارة المستخدمين' : 'Users Management'}</h1>
            <p className="text-muted-foreground">{language === 'ar' ? 'إضافة وتعديل مستخدمي النظام' : 'Add and manage system users'}</p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} data-testid="add-user-btn">
            <Plus className="w-4 h-4 me-2" />
            {language === 'ar' ? 'إضافة مستخدم' : 'Add User'}
          </Button>
        </div>

        {/* Users Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : users.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <User className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{language === 'ar' ? 'لا يوجد مستخدمين' : 'No users'}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-start p-4 font-medium">{language === 'ar' ? 'اسم المستخدم' : 'Username'}</th>
                      <th className="text-start p-4 font-medium">{language === 'ar' ? 'الاسم' : 'Name'}</th>
                      <th className="text-start p-4 font-medium">{language === 'ar' ? 'الفرع' : 'Branch'}</th>
                      <th className="text-start p-4 font-medium">{language === 'ar' ? 'الصلاحية' : 'Role'}</th>
                      <th className="text-start p-4 font-medium">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-t hover:bg-muted/30" data-testid={`user-row-${user.id}`}>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="w-4 h-4 text-primary" />
                            </div>
                            <span className="font-medium">{user.username}</span>
                          </div>
                        </td>
                        <td className="p-4">{user.name}</td>
                        <td className="p-4">
                          {user.branch_name ? (
                            <div className="flex items-center gap-1 text-sm">
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                              {user.branch_name}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">{language === 'ar' ? 'غير محدد' : 'Not assigned'}</span>
                          )}
                        </td>
                        <td className="p-4">
                          {user.is_admin ? (
                            <Badge className="bg-primary">
                              <Shield className="w-3 h-3 me-1" />
                              {language === 'ar' ? 'مدير' : 'Admin'}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              {language === 'ar' ? 'مستخدم' : 'User'}
                            </Badge>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleEdit(user)} data-testid={`edit-user-${user.id}`}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            {user.id !== currentUser?.id && (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-red-600 hover:text-red-700"
                                onClick={() => handleDelete(user.id)}
                                data-testid={`delete-user-${user.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingUser 
                  ? (language === 'ar' ? 'تعديل المستخدم' : 'Edit User')
                  : (language === 'ar' ? 'إضافة مستخدم جديد' : 'Add New User')
                }
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'اسم المستخدم' : 'Username'} *</Label>
                <Input
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder={language === 'ar' ? 'اسم المستخدم للدخول' : 'Login username'}
                  dir="ltr"
                  data-testid="user-username-input"
                />
              </div>
              
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'الاسم الكامل' : 'Full Name'} *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={language === 'ar' ? 'الاسم الكامل' : 'Full name'}
                  data-testid="user-name-input"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  {editingUser 
                    ? (language === 'ar' ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء)' : 'New Password (leave empty to keep)')
                    : (language === 'ar' ? 'كلمة المرور' : 'Password')
                  } {!editingUser && '*'}
                </Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="••••••••"
                    dir="ltr"
                    data-testid="user-password-input"
                  />
                  <button
                    type="button"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{language === 'ar' ? 'الفرع' : 'Branch'}</Label>
                <Select 
                  value={formData.branch_id || 'none'} 
                  onValueChange={(value) => setFormData({ ...formData, branch_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger data-testid="user-branch-select">
                    <SelectValue placeholder={language === 'ar' ? 'اختر الفرع' : 'Select branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{language === 'ar' ? 'بدون فرع' : 'No branch'}</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name_ar || branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <Label className="cursor-pointer">{language === 'ar' ? 'صلاحية مدير (رؤية جميع الفروع)' : 'Admin role (see all branches)'}</Label>
                </div>
                <Switch
                  checked={formData.is_admin}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_admin: checked })}
                  data-testid="user-admin-switch"
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button type="submit" disabled={saving} data-testid="save-user-btn">
                  {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {editingUser 
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

export default UsersPage;
