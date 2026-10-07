import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowRight, UserPlus } from 'lucide-react';
import { Layout } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { branchesAPI, registrationRequestsAPI } from '../services/api';

const today = () => new Date().toLocaleDateString('en-CA');
const fieldClass = 'w-full rounded-lg border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200';

export default function StaffRegistrationPage() {
  const navigate = useNavigate();
  const { selectedBranchId } = useAuth();
  const [branches, setBranches] = useState([]);
  const [activities, setActivities] = useState([]);
  const [form, setForm] = useState({ branch_id: selectedBranchId !== 'all' ? selectedBranchId : '', customer_name: '', customer_phone: '', age: '', nationality: '', expected_start_date: today(), activity_name: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    branchesAPI.getAll().then(({ data }) => setBranches(Array.isArray(data) ? data : data?.branches || [])).catch(() => setError('تعذّر تحميل الفروع'));
  }, []);
  useEffect(() => {
    if (!form.branch_id) { setActivities([]); return; }
    let active = true;
    axios.get(`/api/public/registration/${encodeURIComponent(form.branch_id)}`).then(({ data }) => {
      if (active) setActivities(data.activities || []);
    }).catch(() => { if (active) setActivities([]); });
    return () => { active = false; };
  }, [form.branch_id]);
  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, age: Number(form.age), source: 'staff' };
      const { data } = await registrationRequestsAPI.createStaff(payload);
      navigate(`/admin/registration-journey/${encodeURIComponent(data.request_id)}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'تعذّر حفظ طلب التسجيل');
    } finally {
      setSaving(false);
    }
  };
  return <Layout><main className="max-w-3xl mx-auto p-4 md:p-8" dir="rtl">
    <Link to="/admin/registration-requests" className="text-sm text-blue-700 inline-flex items-center gap-1"><ArrowRight size={15} />طلبات التسجيل</Link>
    <h1 className="text-2xl font-bold flex items-center gap-2 mt-3"><UserPlus className="text-blue-700" />بدء تسجيل جديد</h1>
    <p className="text-sm text-slate-500 mt-1 mb-5">يدخل الموظف بيانات اللاعب هنا، ثم يسير الطلب في المراحل نفسها التي يستخدمها طلب ولي الأمر عبر الرابط.</p>
    <form onSubmit={submit} className="rounded-xl border bg-white p-5 md:p-7 space-y-4">
      {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 p-3">{String(error)}</div>}
      <div><label className="block text-sm font-medium mb-1">الفرع *</label><select required value={form.branch_id} onChange={e => { set('branch_id', e.target.value); set('activity_name', ''); }} className={fieldClass}><option value="">اختر الفرع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name_ar || branch.name}</option>)}</select></div>
      <div className="grid md:grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium mb-1">اسم اللاعب *</label><input required value={form.customer_name} onChange={e => set('customer_name', e.target.value)} className={fieldClass} /></div>
        <div><label className="block text-sm font-medium mb-1">جوال ولي الأمر *</label><input required inputMode="tel" value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} className={fieldClass} dir="ltr" /></div>
        <div><label className="block text-sm font-medium mb-1">العمر *</label><input required type="number" min="1" max="100" value={form.age} onChange={e => set('age', e.target.value)} className={fieldClass} /></div>
        <div><label className="block text-sm font-medium mb-1">الجنسية *</label><input required value={form.nationality} onChange={e => set('nationality', e.target.value)} className={fieldClass} /></div>
        <div><label className="block text-sm font-medium mb-1">تاريخ البداية المتوقع *</label><input required type="date" value={form.expected_start_date} onChange={e => set('expected_start_date', e.target.value)} className={fieldClass} /></div>
        <div><label className="block text-sm font-medium mb-1">النشاط المطلوب</label><select value={form.activity_name} onChange={e => set('activity_name', e.target.value)} className={fieldClass}><option value="">اختر النشاط</option>{activities.map((activity, index) => <option key={`${activity.id}-${index}`} value={activity.name_ar || activity.name}>{activity.name_ar || activity.name}</option>)}<option value="أخرى">أخرى</option></select></div>
      </div>
      <div><label className="block text-sm font-medium mb-1">ملاحظات</label><textarea value={form.notes} onChange={e => set('notes', e.target.value)} className={`${fieldClass} min-h-24`} /></div>
      <div className="flex flex-wrap gap-2"><button disabled={saving} type="submit" className="rounded-lg bg-blue-700 text-white px-5 py-2 disabled:opacity-50">{saving ? 'جارٍ حفظ الطلب...' : 'حفظ وفتح مسار التسجيل'}</button><Link to="/admin/registration-requests" className="rounded-lg border px-5 py-2">إلغاء</Link></div>
    </form>
  </main></Layout>;
}
