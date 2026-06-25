import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config/api';
import { Loader2, CheckCircle2, Calendar, Phone, User, Dumbbell, Flag, Building2 } from 'lucide-react';

const WEEK_DAYS = [
  { key: 'saturday', label: 'السبت' },
  { key: 'sunday', label: 'الأحد' },
  { key: 'monday', label: 'الاثنين' },
  { key: 'tuesday', label: 'الثلاثاء' },
  { key: 'wednesday', label: 'الأربعاء' },
  { key: 'thursday', label: 'الخميس' },
  { key: 'friday', label: 'الجمعة' },
];

// Fixed set of high-level activity choices shown to parents on the public form.
const ACTIVITY_OPTIONS = ['السباحة', 'كرة قدم', 'كاراتيه', 'برايفت', 'أخرى'];

export const PublicRegistrationPage = () => {
  const { tenantSlug, branchId } = useParams();
  const [searchParams] = useSearchParams();
  const referralCode = (searchParams.get('ref') || '').trim();
  // Marks links shared in social-media ads so we can track their registrations.
  const source = (searchParams.get('src') || '').trim().toLowerCase();
  const [marketer, setMarketer] = useState(null);
  const [academyName, setAcademyName] = useState('');

  const api = useMemo(() => axios.create({
    baseURL: API_URL || '',
    headers: { 'X-Tenant-Slug': tenantSlug || 'default' },
  }), [tenantSlug]);

  // Academy logo served by the public branding endpoint (falls back to the
  // shared default logo automatically when the academy has no custom one).
  const logoUrl = `${API_URL || ''}/api/tenant/branding/logo?slug=${encodeURIComponent(tenantSlug || 'default')}`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branch, setBranch] = useState(null);
  // When the link carries a branch (e.g. /register/:tenant/:branchId) the branch
  // is fixed and locked to the link. When it doesn't (e.g. the all-branches
  // social-media ad link) the visitor picks the branch from a list.
  const hasFixedBranch = !!branchId;
  const [branches, setBranches] = useState([]);
  const [pickedBranchId, setPickedBranchId] = useState('');
  const selectedBranchId = hasFixedBranch ? branchId : pickedBranchId;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nationality, setNationality] = useState('');
  const [activity, setActivity] = useState('');
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
        if (hasFixedBranch) {
          // Branch-locked link: load the single branch tied to the link.
          const res = await api.get(`/api/public/registration/${branchId}`);
          if (!active) return;
          setBranch(res.data.branch);
          if (res.data.academy_name) setAcademyName(res.data.academy_name);
        } else {
          // All-branches link: load the list so the visitor can pick a branch.
          const res = await api.get('/api/public/branches');
          if (!active) return;
          setBranches(res.data.branches || []);
          if (res.data.academy_name) setAcademyName(res.data.academy_name);
        }
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
  }, [api, hasFixedBranch, branchId]);

  // Resolve the referral code (if any) so we can show the special discount.
  useEffect(() => {
    if (!referralCode) { setMarketer(null); return; }
    let active = true;
    (async () => {
      try {
        const res = await api.get(`/api/public/marketers/${encodeURIComponent(referralCode)}`);
        if (active) setMarketer(res.data);
      } catch (e) {
        if (active) setMarketer(null);
      }
    })();
    return () => { active = false; };
  }, [api, referralCode]);

  const toggleDay = (key) => {
    setDays((prev) => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) { setFormError('من فضلك اكتب اسم الطفل'); return; }
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 8) { setFormError('من فضلك اكتب رقم موبايل صحيح'); return; }
    if (!nationality.trim()) { setFormError('من فضلك اكتب الجنسية'); return; }
    if (!selectedBranchId) { setFormError('من فضلك اختر الفرع'); return; }
    setSubmitting(true);
    try {
      const selectedDays = WEEK_DAYS.filter(d => days.includes(d.key)).map(d => d.label);
      await api.post(`/api/public/registration/${selectedBranchId}`, {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        nationality: nationality.trim(),
        activity_id: '',
        activity_name: activity,
        preferred_days: selectedDays,
        preferred_time: time.trim(),
        notes: notes.trim(),
        referral_code: referralCode,
        source,
      });
      setSubmitted(true);
    } catch (e) {
      setFormError(e?.response?.data?.detail || 'تعذّر إرسال الطلب. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const branchName = hasFixedBranch
    ? (branch ? (branch.name_ar || branch.name) : '')
    : (() => { const b = branches.find(x => x.id === pickedBranchId); return b ? (b.name_ar || b.name) : ''; })();

  return (
    <div dir="rtl" className="relative min-h-screen overflow-hidden flex flex-col items-center py-8 px-4 bg-gradient-to-br from-emerald-50 via-white to-sky-50">
      <style>{`
        @keyframes pra-float-a { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(24px,-30px) scale(1.08); } }
        @keyframes pra-float-b { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-28px,26px) scale(1.1); } }
        @keyframes pra-float-c { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(18px,22px) scale(0.94); } }
        @keyframes pra-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .pra-rise { animation: pra-rise .6s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .pra-blob, .pra-rise { animation: none !important; }
        }
      `}</style>
      {/* Animated brand-color background (logo palette: emerald / blue / gold) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="pra-blob absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-300/30 blur-3xl" style={{ animation: 'pra-float-a 14s ease-in-out infinite' }} />
        <div className="pra-blob absolute top-1/3 -left-28 w-96 h-96 rounded-full bg-sky-300/25 blur-3xl" style={{ animation: 'pra-float-b 18s ease-in-out infinite' }} />
        <div className="pra-blob absolute -bottom-28 right-1/4 w-80 h-80 rounded-full bg-amber-200/30 blur-3xl" style={{ animation: 'pra-float-c 16s ease-in-out infinite' }} />
      </div>
      <div className="relative z-10 w-full max-w-md pra-rise">
        <div className="text-center mb-6">
          <div className="mx-auto w-24 h-24 rounded-full bg-white shadow-lg ring-4 ring-emerald-100 flex items-center justify-center mb-4 overflow-hidden p-2">
            <img
              src={logoUrl}
              onError={(e) => { if (!e.target.dataset.fb) { e.target.dataset.fb = '1'; e.target.src = '/logo-new.png'; } }}
              alt="شعار الأكاديمية"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-xl font-extrabold text-gray-800 leading-snug px-2">
            {academyName || 'شركة اداء الابطال العالمية للرياضة'}
          </h1>
          {branchName && (
            <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-100">
              <Building2 className="w-3.5 h-3.5" /> فرع: {branchName}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-6 text-center text-red-600 text-sm">{error}</div>
        ) : submitted ? (
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">تم استلام طلبك بنجاح</h2>
            <p className="text-sm text-gray-600">هيتم التواصل معاك قريبًا لاستكمال التسجيل. شكرًا لك.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-lg border border-gray-100 p-6 space-y-4">
            <p className="text-sm text-gray-600 text-center mb-2">سجّل بيانات اللاعب وهنتواصل معاك لاستكمال الاشتراك.</p>

            {marketer && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-center">
                <p className="text-sm text-emerald-800 font-medium">🎉 تم تطبيق إحالة من {marketer.name}</p>
                {marketer.discount_percent > 0 && (
                  <p className="text-xs text-emerald-700 mt-1">هتحصل على خصم {marketer.discount_percent}% على أول اشتراك</p>
                )}
              </div>
            )}

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
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Flag className="w-4 h-4" /> الجنسية *</label>
              <input value={nationality} onChange={(e) => setNationality(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="مثال: سعودي" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Building2 className="w-4 h-4" /> الفرع{hasFixedBranch ? '' : ' *'}</label>
              {hasFixedBranch ? (
                <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700" data-testid="text-locked-branch">
                  {branchName || '—'}
                </div>
              ) : (
                <select value={pickedBranchId} onChange={(e) => setPickedBranchId(e.target.value)}
                  data-testid="select-branch"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">اختر الفرع</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name_ar || b.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Dumbbell className="w-4 h-4" /> النشاط المطلوب</label>
              <select value={activity} onChange={(e) => setActivity(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="">اختر النشاط</option>
                {ACTIVITY_OPTIONS.map((label, i) => (
                  <option key={i} value={label}>{label}</option>
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
              className="w-full rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold py-3.5 text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-200 transition-all disabled:opacity-60">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              إرسال طلب التسجيل
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">© {academyName || 'شركة اداء الابطال العالمية للرياضة'}</p>
      </div>
    </div>
  );
};

export default PublicRegistrationPage;
