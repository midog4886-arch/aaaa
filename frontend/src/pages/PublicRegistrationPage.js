import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config/api';
import { Loader2, CheckCircle2, Calendar, Phone, User, Dumbbell } from 'lucide-react';

const WEEK_DAYS = [
  { key: 'saturday', label: 'السبت' },
  { key: 'sunday', label: 'الأحد' },
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
  { key: 'friday', label: 'الجمعة' },
];

export const PublicRegistrationPage = () => {
  const { tenantSlug, branchId } = useParams();

  const api = useMemo(() => axios.create({
    baseURL: API_URL || '',
    headers: { 'X-Tenant-Slug': tenantSlug || 'default' },
  }), [tenantSlug]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branch, setBranch] = useState(null);
  const [activities, setActivities] = useState([]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [activityId, setActivityId] = useState('');
  const [days, setDays] = useState([]);
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/api/public/registration/${branchId}`);
        if (!active) return;
        setBranch(res.data.branch);
        setActivities(res.data.activities || []);
      } catch (e) {
        if (!active) return;
        setError(e?.response?.status === 404
          ? 'رابط التسجيل غير صحيح أو الفرع غير موجود.'
          : 'تعذّر تحميل بيانات التسجيل. حاول مرة أخرى.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [api, branchId]);

  const toggleDay = (key) => {
    setDays((prev) => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) { setFormError('من فضلك اكتب اسم الطفل'); return; }
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 8) { setFormError('من فضلك اكتب رقم موبايل صحيح'); return; }
    setSubmitting(true);
    try {
      const selectedActivity = activities.find(a => a.id === activityId);
      const selectedDays = WEEK_DAYS.filter(d => days.includes(d.key)).map(d => d.label);
      await api.post(`/api/public/registration/${branchId}`, {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        activity_id: activityId,
        activity_name: selectedActivity ? (selectedActivity.name_ar || selectedActivity.name) : '',
        preferred_days: selectedDays,
        preferred_time: time.trim(),
        notes: notes.trim(),
      });
      setSubmitted(true);
    } catch (e) {
      setFormError(e?.response?.data?.detail || 'تعذّر إرسال الطلب. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const branchName = branch ? (branch.name_ar || branch.name) : '';

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-emerald-50 to-white flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mb-3">
            <Dumbbell className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-800">شركة اداء الابطال العالمية للرياضة</h1>
          {branchName && <p className="text-sm text-emerald-700 mt-1">فرع: {branchName}</p>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl shadow p-6 text-center text-red-600 text-sm">{error}</div>
        ) : submitted ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-600 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-gray-800 mb-2">تم استلام طلبك بنجاح</h2>
            <p className="text-sm text-gray-600">هيتم التواصل معاك قريبًا لاستكمال التسجيل. شكرًا لك.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-5 space-y-4">
            <p className="text-sm text-gray-600 text-center mb-2">سجّل بيانات اللاعب وهنتواصل معاك لاستكمال الاشتراك.</p>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><User className="w-4 h-4" /> اسم الطفل *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="الاسم بالكامل" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Phone className="w-4 h-4" /> رقم الموبايل *</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="05xxxxxxxx" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Dumbbell className="w-4 h-4" /> النشاط المطلوب</label>
              <select value={activityId} onChange={(e) => setActivityId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="">اختر النشاط</option>
                {activities.map(a => (
                  <option key={a.id} value={a.id}>{a.name_ar || a.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> الأيام المفضّلة</label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map(d => (
                  <button type="button" key={d.key} onClick={() => toggleDay(d.key)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${days.includes(d.key) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">الموعد المفضّل</label>
              <input value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="مثال: الفترة الصباحية / الساعة 5 مساءً" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">ملاحظات (اختياري)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="أي ملاحظات تحب تضيفها" />
            </div>

            {formError && <div className="text-sm text-red-600 text-center">{formError}</div>}

            <button type="submit" disabled={submitting}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              إرسال طلب التسجيل
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">© شركة اداء الابطال العالمية للرياضة</p>
      </div>
    </div>
  );
};

export default PublicRegistrationPage;
