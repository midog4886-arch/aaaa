import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Plus, Pencil, Trash2, UserCog, Loader2, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import Layout from '../components/Layout';
import {
  compressImageFile,
  estimateDataUrlBytes,
  PROFILE_PHOTO_HARD_CAP_BYTES,
} from '../utils/imageCompression';

const API = process.env.REACT_APP_BACKEND_URL || '';

const SupervisorAvatar = ({ supervisor, size = 'w-16 h-16', textSize = 'text-lg' }) => {
  const [imgError, setImgError] = useState(false);
  const initials = (supervisor.name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  if (supervisor.photo && !imgError) {
    return (
      <img
        src={supervisor.photo}
        alt={supervisor.name}
        className={`${size} rounded-full object-cover flex-shrink-0 border-2 border-white shadow`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className={`${size} bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0`}
    >
      <span className={`${textSize} font-bold text-white`}>{initials || <UserCog className="w-6 h-6" />}</span>
    </div>
  );
};

const SupervisorsPage = () => {
  const [loading, setLoading] = useState(true);
  const [supervisors, setSupervisors] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState('');
  const [saving, setSaving] = useState(false);

  const token = localStorage.getItem('token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchSupervisors = async () => {
    try {
      const res = await axios.get(`${API}/api/supervisors`, { headers: authHeaders });
      setSupervisors(res.data || []);
    } catch (err) {
      console.error(err);
      toast.error('فشل تحميل المشرفين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSupervisors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setPhoto('');
    setDialogOpen(true);
  };

  const openEdit = (sup) => {
    setEditing(sup);
    setName(sup.name || '');
    setPhoto(sup.photo || '');
    setDialogOpen(true);
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      toast.error('يرجى اختيار صورة');
      return;
    }
    try {
      const base64 = await compressImageFile(file);
      if (estimateDataUrlBytes(base64) > PROFILE_PHOTO_HARD_CAP_BYTES) {
        toast.error('تعذّر تصغير الصورة بما يكفي، يرجى اختيار صورة أصغر');
        return;
      }
      setPhoto(base64);
    } catch (err) {
      toast.error('فشل قراءة الصورة');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('يرجى إدخال الاسم');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), photo: photo || null };
      if (editing) {
        await axios.put(`${API}/api/supervisors/${editing.id}`, payload, { headers: authHeaders });
        toast.success('تم تحديث المشرف');
      } else {
        await axios.post(`${API}/api/supervisors`, payload, { headers: authHeaders });
        toast.success('تم إضافة المشرف');
      }
      setDialogOpen(false);
      fetchSupervisors();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.detail || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sup) => {
    if (!window.confirm(`حذف المشرف "${sup.name}"؟`)) return;
    try {
      await axios.delete(`${API}/api/supervisors/${sup.id}`, { headers: authHeaders });
      toast.success('تم الحذف');
      fetchSupervisors();
    } catch (err) {
      toast.error('فشل الحذف');
    }
  };

  return (
    <Layout>
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white">المشرفون</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              إدارة المشرفين الذين يظهرون في بوابة الأعضاء
            </p>
          </div>
          <Button onClick={openAdd} className="gap-2 bg-gradient-to-r from-emerald-500 to-teal-600">
            <Plus className="w-4 h-4" />
            إضافة مشرف
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : supervisors.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <UserCog className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium text-gray-600">لا يوجد مشرفون مضافون بعد</p>
              <p className="mt-2 text-sm text-gray-400">اضغط "إضافة مشرف" لإضافة أول مشرف</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {supervisors.map((sup) => (
              <Card key={sup.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <SupervisorAvatar supervisor={sup} size="w-16 h-16" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-800 dark:text-white truncate">{sup.name}</h3>
                      <p className="text-xs text-gray-400">مشرف</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => openEdit(sup)}>
                      <Pencil className="w-3 h-3" />
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => handleDelete(sup)}
                    >
                      <Trash2 className="w-3 h-3" />
                      حذف
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? 'تعديل المشرف' : 'إضافة مشرف جديد'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3">
                <SupervisorAvatar supervisor={{ name, photo }} size="w-24 h-24" textSize="text-2xl" />
                <div className="flex gap-2">
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border bg-white hover:bg-gray-50 text-gray-700">
                      <ImagePlus className="w-4 h-4" />
                      {photo ? 'تغيير الصورة' : 'رفع صورة'}
                    </span>
                  </label>
                  {photo && (
                    <button
                      type="button"
                      onClick={() => setPhoto('')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                      إزالة
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">الحد الأقصى 2 ميجا</p>
              </div>

              <div>
                <Label htmlFor="sup-name">الاسم</Label>
                <Input
                  id="sup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="اسم المشرف"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)} disabled={saving}>
                إلغاء
              </Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default SupervisorsPage;
