import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config/api';
import { Loader2, CheckCircle2, Calendar, Phone, User, Dumbbell, Flag, Building2, MapPin, Languages } from 'lucide-react';
import { NationalitySelect } from '../components/NationalitySelect';

// The Arabic label is the canonical value (it is what gets submitted and what
// supervisors read in the review queue); label_en is display-only.
const WEEK_DAYS = [
  { key: 'saturday', label: 'السبت', label_en: 'Saturday' },
  { key: 'sunday', label: 'الأحد', label_en: 'Sunday' },
  { key: 'monday', label: 'الاثنين', label_en: 'Monday' },
  { key: 'tuesday', label: 'الثلاثاء', label_en: 'Tuesday' },
  { key: 'wednesday', label: 'الأربعاء', label_en: 'Wednesday' },
  { key: 'thursday', label: 'الخميس', label_en: 'Thursday' },
  { key: 'friday', label: 'الجمعة', label_en: 'Friday' },
];

// Fallback activity choices, used only when the selected branch has no
// activities defined in the system (or they could not be loaded), so the
// form always has something to pick. "أخرى"/"Other" is always appended.
// `value` is canonical (submitted + selection state); `en` is display-only.
const FALLBACK_ACTIVITY_OPTIONS = [
  { value: 'السباحة', en: 'Swimming' },
  { value: 'كرة قدم', en: 'Football' },
  { value: 'كاراتيه', en: 'Karate' },
  { value: 'برايفت', en: 'Private' },
];
const OTHER_ACTIVITY_OPTION = { value: 'أخرى', en: 'Other' };

// UI strings for the public form (visitor can switch Arabic/English).
const STRINGS = {
  ar: {
    badLink: 'رابط التسجيل غير صحيح أو الفرع غير موجود.',
    loadFail: 'تعذّر تحميل بيانات التسجيل. حاول مرة أخرى.',
    branchTag: 'فرع',
    submittedTitle: 'تم استلام طلبك بنجاح',
    submittedBody: 'هيتم التواصل معاك قريبًا لاستكمال التسجيل. شكرًا لك.',
    intro: 'سجّل بيانات اللاعب وهنتواصل معاك لاستكمال الاشتراك.',
    referralApplied: (n) => `🎉 تم تطبيق إحالة من ${n}`,
    referralDiscount: (p) => `هتحصل على خصم ${p}% على أول اشتراك`,
    childName: 'اسم الطفل',
    fullNamePh: 'الاسم بالكامل',
    mobile: 'رقم الموبايل',
    nationality: 'الجنسية',
    nationalityPh: 'ابحث واختر الجنسية',
    branchField: 'الفرع',
    pickBranch: 'اختر الفرع',
    locationOnMap: 'اللوكيشن على الخريطة',
    activity: 'النشاط المطلوب',
    activityHint: '(يمكن اختيار أكثر من نشاط)',
    preferredDays: 'الأيام المفضّلة',
    preferredTime: 'الموعد المفضّل',
    timePh: 'مثال: الفترة الصباحية / الساعة 5 مساءً',
    notes: 'ملاحظات (اختياري)',
    notesPh: 'أي ملاحظات تحب تضيفها',
    submit: 'إرسال طلب التسجيل',
    errName: 'من فضلك اكتب اسم الطفل',
    errPhone: 'من فضلك اكتب رقم موبايل صحيح',
    errNationality: 'من فضلك اختر الجنسية',
    errBranch: 'من فضلك اختر الفرع',
    errBranchScope: 'من فضلك اختر فرعاً من فروع العرض',
    submitFail: 'تعذّر إرسال الطلب. حاول مرة أخرى.',
    logoAlt: 'شعار الأكاديمية',
    switchTo: 'English',
  },
  en: {
    badLink: 'Invalid registration link or the branch was not found.',
    loadFail: 'Could not load the registration data. Please try again.',
    branchTag: 'Branch',
    submittedTitle: 'Your request has been received',
    submittedBody: 'We will contact you soon to complete the registration. Thank you.',
    intro: "Enter the player's details and we will contact you to complete the subscription.",
    referralApplied: (n) => `🎉 Referral applied from ${n}`,
    referralDiscount: (p) => `You will get a ${p}% discount on your first subscription`,
    childName: "Child's name",
    fullNamePh: 'Full name',
    mobile: 'Mobile number',
    nationality: 'Nationality',
    nationalityPh: 'Search and select nationality',
    branchField: 'Branch',
    pickBranch: 'Select a branch',
    locationOnMap: 'Location on the map',
    activity: 'Desired activity',
    activityHint: '(you can pick more than one)',
    preferredDays: 'Preferred days',
    preferredTime: 'Preferred time',
    timePh: 'e.g. Morning period / 5 PM',
    notes: 'Notes (optional)',
    notesPh: 'Anything you would like to add',
    submit: 'Send registration request',
    errName: "Please enter the child's name",
    errPhone: 'Please enter a valid mobile number',
    errNationality: 'Please select a nationality',
    errBranch: 'Please select a branch',
    errBranchScope: 'Please pick one of the offer branches',
    submitFail: 'Could not send the request. Please try again.',
    logoAlt: 'Academy logo',
    switchTo: 'العربية',
  },
};

export const PublicRegistrationPage = () => {
  const { tenantSlug, branchId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const referralCode = (searchParams.get('ref') || '').trim();
  // Marks links shared in social-media ads so we can track their registrations.
  // The short /join/:tenant alias is implicitly a social link (no ?src needed);
  // the legacy /register/:tenant?src=social link keeps working unchanged.
  const isJoinRoute = location.pathname.startsWith('/join/') || location.pathname === '/join';
  const source = (searchParams.get('src') || (isJoinRoute ? 'social' : '')).trim().toLowerCase();
  const [marketer, setMarketer] = useState(null);
  const [academyName, setAcademyName] = useState('');
  // Visitor-facing language. Defaults to Arabic; ?lang=en pre-selects English.
  const [lang, setLang] = useState((searchParams.get('lang') || '').trim().toLowerCase() === 'en' ? 'en' : 'ar');
  const t = STRINGS[lang];

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
  const [activities, setActivities] = useState([]);
  // Real activities of the selected branch, loaded from the system so the
  // choices always mirror what the academy actually offers (null = not loaded).
  const [branchActivities, setBranchActivities] = useState(null);
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
          setBranchActivities(res.data.activities || []);
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
        // Store a translation KEY (not text) so the message follows the
        // language toggle; rendered as STRINGS[lang][error].
        setError(e?.response?.status === 404 ? 'badLink' : 'loadFail');
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

  // A multi-branch link (/register/:tenant?branches=id1,id2) restricts the branch
  // picker to a hand-picked subset of branches without locking to a single one.
  const urlBranchIds = useMemo(() => {
    const raw = searchParams.get('branches') || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }, [searchParams]);

  // The branches the visitor is allowed to pick from. A marketer referral scope
  // and a ?branches= subset both narrow the list; when both are present we take
  // their intersection. Empty everywhere => show all branches.
  const allowedBranchIds = useMemo(() => {
    const m = marketer?.branch_ids || [];
    if (m.length && urlBranchIds.length) return m.filter(id => urlBranchIds.includes(id));
    return m.length ? m : urlBranchIds;
  }, [marketer, urlBranchIds]);

  const visibleBranches = (!hasFixedBranch && allowedBranchIds.length)
    ? branches.filter(b => allowedBranchIds.includes(b.id))
    : branches;

  // Keep the picked branch consistent with what the visitor is allowed to see:
  // clear an out-of-scope pick (e.g. chosen before the marketer data arrived) and
  // auto-select when exactly one branch is available.
  useEffect(() => {
    if (hasFixedBranch) return;
    const vis = allowedBranchIds.length ? branches.filter(b => allowedBranchIds.includes(b.id)) : branches;
    if (pickedBranchId && !vis.some(b => b.id === pickedBranchId)) {
      setPickedBranchId(vis.length === 1 ? vis[0].id : '');
    } else if (!pickedBranchId && vis.length === 1) {
      setPickedBranchId(vis[0].id);
    }
  }, [hasFixedBranch, pickedBranchId, allowedBranchIds, branches]);

  // On all-branches links, load the real activities of whichever branch the
  // visitor picks (branch-locked links get them with the initial load above).
  useEffect(() => {
    if (hasFixedBranch) return;
    if (!selectedBranchId) { setBranchActivities(null); return; }
    let active = true;
    (async () => {
      try {
        const res = await api.get(`/api/public/registration/${selectedBranchId}`);
        if (active) setBranchActivities(res.data.activities || []);
      } catch (e) {
        if (active) setBranchActivities([]); // fall back to the fixed list
      }
    })();
    return () => { active = false; };
  }, [api, hasFixedBranch, selectedBranchId]);

  // The activity chips shown to the visitor: the branch's real activities
  // (deduped by canonical value), or the fallback list when none exist, plus
  // "أخرى"/"Other". Selection state stores `value` (stable across languages).
  const activityOptions = useMemo(() => {
    const seen = new Set();
    const fromBranch = (branchActivities || [])
      .map(a => ({
        value: ((a && (a.name_ar || a.name)) || '').trim(),
        en: ((a && (a.name || a.name_ar)) || '').trim(),
      }))
      .filter(o => o.value && !seen.has(o.value) && seen.add(o.value));
    const base = fromBranch.length ? fromBranch : FALLBACK_ACTIVITY_OPTIONS;
    return [...base, OTHER_ACTIVITY_OPTION];
  }, [branchActivities]);

  // Drop selections that no longer exist after the visitor switches branch.
  useEffect(() => {
    setActivities(prev => prev.filter(a => activityOptions.some(o => o.value === a)));
  }, [activityOptions]);

  const toggleDay = (key) => {
    setDays((prev) => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]);
  };

  const toggleActivity = (label) => {
    setActivities((prev) => prev.includes(label) ? prev.filter(a => a !== label) : [...prev, label]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    // Validation errors are stored as translation KEYS so they follow the
    // language toggle; server messages come through as raw text.
    if (!name.trim()) { setFormError('errName'); return; }
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 8) { setFormError('errPhone'); return; }
    if (!nationality.trim()) { setFormError('errNationality'); return; }
    if (!selectedBranchId) { setFormError('errBranch'); return; }
    if (!hasFixedBranch && allowedBranchIds.length && !visibleBranches.some(b => b.id === selectedBranchId)) {
      setFormError('errBranchScope'); return;
    }
    setSubmitting(true);
    try {
      // Submitted values stay Arabic (canonical) regardless of the visitor's
      // display language — that is what supervisors read in the review queue.
      const selectedDays = WEEK_DAYS.filter(d => days.includes(d.key)).map(d => d.label);
      await api.post(`/api/public/registration/${selectedBranchId}`, {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        nationality: nationality.trim(),
        activity_id: '',
        activity_name: activityOptions.filter(o => activities.includes(o.value)).map(o => o.value).join('، '),
        preferred_days: selectedDays,
        preferred_time: time.trim(),
        notes: notes.trim(),
        referral_code: referralCode,
        source,
      });
      setSubmitted(true);
    } catch (e) {
      // Only render string details; anything else (e.g. a 422 object list)
      // falls back to the generic translated message.
      const detail = e?.response?.data?.detail;
      setFormError(typeof detail === 'string' && detail ? detail : 'submitFail');
    } finally {
      setSubmitting(false);
    }
  };

  // Branch display label follows the visitor's language (public_name wins,
  // then the language-preferred name).
  const branchLabel = (b) => b ? (b.public_name || (lang === 'en' ? (b.name || b.name_ar) : (b.name_ar || b.name))) : '';
  const branchName = hasFixedBranch
    ? branchLabel(branch)
    : branchLabel(branches.find(x => x.id === pickedBranchId));

  // Contact info (phone + maps location) of the currently relevant branch:
  // the locked branch on branch-specific links, or the picked one otherwise.
  const selectedBranchInfo = hasFixedBranch
    ? branch
    : branches.find(x => x.id === pickedBranchId) || null;

  // Defensive guard: only render http(s) links (backend validates on save,
  // this also hides any bad legacy value instead of creating a live link).
  const safeLocationUrl = (() => {
    const url = (selectedBranchInfo?.location_url || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  })();

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="relative min-h-screen overflow-hidden flex flex-col items-center py-8 px-4 bg-gradient-to-br from-emerald-50 via-white to-sky-50">
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
        <div className="flex justify-end mb-2">
          <button type="button" onClick={() => setLang(l => (l === 'ar' ? 'en' : 'ar'))}
            data-testid="button-toggle-language"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-sm border border-gray-200 text-xs font-semibold text-gray-600 shadow-sm hover:bg-white transition-colors">
            <Languages className="w-3.5 h-3.5" /> {t.switchTo}
          </button>
        </div>
        <div className="text-center mb-6">
          <div className="mx-auto w-24 h-24 rounded-full bg-white shadow-lg ring-4 ring-emerald-100 flex items-center justify-center mb-4 overflow-hidden p-2">
            <img
              src={logoUrl}
              onError={(e) => { if (!e.target.dataset.fb) { e.target.dataset.fb = '1'; e.target.src = '/logo-new.png'; } }}
              alt={t.logoAlt}
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-xl font-extrabold text-gray-800 leading-snug px-2">
            {academyName || 'شركة اداء الابطال العالمية للرياضة'}
          </h1>
          {branchName && (
            <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-100">
              <Building2 className="w-3.5 h-3.5" /> {t.branchTag}: {branchName}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-6 text-center text-red-600 text-sm">{t[error] || error}</div>
        ) : submitted ? (
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">{t.submittedTitle}</h2>
            <p className="text-sm text-gray-600">{t.submittedBody}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-lg border border-gray-100 p-6 space-y-4">
            <p className="text-sm text-gray-600 text-center mb-2">{t.intro}</p>

            {marketer && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-center">
                <p className="text-sm text-emerald-800 font-medium">{t.referralApplied(marketer.name)}</p>
                {marketer.discount_percent > 0 && (
                  <p className="text-xs text-emerald-700 mt-1">{t.referralDiscount(marketer.discount_percent)}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><User className="w-4 h-4" /> {t.childName} *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder={t.fullNamePh} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Phone className="w-4 h-4" /> {t.mobile} *</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr"
                className={`w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm ${lang === 'ar' ? 'text-right' : 'text-left'} focus:outline-none focus:ring-2 focus:ring-emerald-500`}
                placeholder="05xxxxxxxx" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Flag className="w-4 h-4" /> {t.nationality} *</label>
              <NationalitySelect
                value={nationality}
                onChange={(val) => setNationality(val)}
                language={lang}
                placeholder={t.nationalityPh}
                data-testid="public-nationality-input"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Building2 className="w-4 h-4" /> {t.branchField}{hasFixedBranch ? '' : ' *'}</label>
              {hasFixedBranch ? (
                <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700" data-testid="text-locked-branch">
                  {branchName || '—'}
                </div>
              ) : (
                <select value={pickedBranchId} onChange={(e) => setPickedBranchId(e.target.value)}
                  data-testid="select-branch"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="">{t.pickBranch}</option>
                  {visibleBranches.map(b => (
                    <option key={b.id} value={b.id}>{branchLabel(b)}</option>
                  ))}
                </select>
              )}
              {(selectedBranchInfo?.phone || safeLocationUrl) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1" data-testid="branch-contact-info">
                  {selectedBranchInfo.phone && (
                    <a href={`tel:${selectedBranchInfo.phone}`} dir="ltr"
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline"
                      data-testid="link-branch-phone">
                      <Phone className="w-3.5 h-3.5" /> {selectedBranchInfo.phone}
                    </a>
                  )}
                  {safeLocationUrl && (
                    <a href={safeLocationUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline"
                      data-testid="link-branch-location">
                      <MapPin className="w-3.5 h-3.5" /> {t.locationOnMap}
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Dumbbell className="w-4 h-4" /> {t.activity} <span className="text-gray-400 font-normal">{t.activityHint}</span></label>
              <div className="flex flex-wrap gap-2">
                {activityOptions.map((o) => (
                  <button type="button" key={o.value} onClick={() => toggleActivity(o.value)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${activities.includes(o.value) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    {lang === 'en' ? (o.en || o.value) : o.value}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {t.preferredDays}</label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map(d => (
                  <button type="button" key={d.key} onClick={() => toggleDay(d.key)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${days.includes(d.key) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    {lang === 'en' ? d.label_en : d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">{t.preferredTime}</label>
              <input value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder={t.timePh} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">{t.notes}</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder={t.notesPh} />
            </div>

            {formError && <div className="text-sm text-red-600 text-center">{t[formError] || formError}</div>}

            <button type="submit" disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold py-3.5 text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-200 transition-all disabled:opacity-60">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t.submit}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">© {academyName || 'شركة اداء الابطال العالمية للرياضة'}</p>
      </div>
    </div>
  );
};

export default PublicRegistrationPage;
