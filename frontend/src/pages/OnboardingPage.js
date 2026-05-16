import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { tenantAPI, branchesAPI, coachesAPI } from '../services/api';
import { loadBranding } from '../services/branding';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Trophy, Upload, ChevronLeft, ChevronRight, Check, SkipForward, Building2, UserCog, Sparkles, Image as ImageIcon } from 'lucide-react';

const STEPS = ['welcome', 'branding', 'branch', 'coach'];
const MAX_LOGO_BYTES = 600 * 1024;
const PRESET_COLORS = ['#f97316', '#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#eab308', '#14b8a6', '#1f2937'];

const OnboardingPage = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(true);
  const [stepIdx, setStepIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const [tenantInfo, setTenantInfo] = useState({ name: '', plan: '' });
  const [logoBase64, setLogoBase64] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [academyName, setAcademyName] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [commercialReg, setCommercialReg] = useState('');

  const [branchId, setBranchId] = useState('');
  const [branchForm, setBranchForm] = useState({ name: '', name_ar: '', address: '', phone: '' });

  const [coachForm, setCoachForm] = useState({ name: '', specialty: '', phone: '' });
  const [skipCoach, setSkipCoach] = useState(false);
  const branchOriginalRef = useRef(null);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/admin/dashboard', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [statusRes, branchesRes] = await Promise.all([
          tenantAPI.getOnboardingStatus(),
          branchesAPI.getAll().catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const s = statusRes.data || {};
        if (s.completed) {
          navigate('/admin/dashboard', { replace: true });
          return;
        }
        setTenantInfo({ name: s.tenant_name || '', plan: s.plan || '' });
        setAcademyName(s.tenant_name || '');
        setLogoBase64(s.logo_base64 || '');
        setPrimaryColor(s.primary_color || '');
        setTaxNumber(s.tax_number || '');
        setCommercialReg(s.commercial_reg || '');
        const bs = branchesRes.data || [];
        if (bs.length > 0) {
          const b = bs[0];
          setBranchId(b.id);
          branchOriginalRef.current = b;
          setBranchForm({
            name: b.name || '',
            name_ar: b.name_ar || b.name || '',
            address: b.address || '',
            phone: b.phone || '',
          });
        }
      } catch (e) {
        if (e?.response?.status === 403 || e?.response?.status === 400) {
          navigate('/admin/dashboard', { replace: true });
          return;
        }
        toast.error(isAr ? 'تعذر تحميل بيانات المعالج' : 'Failed to load wizard data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, navigate, isAr]);

  const handleLogoFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(isAr ? 'الملف يجب أن يكون صورة' : 'File must be an image');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      if (typeof result !== 'string' || result.length > MAX_LOGO_BYTES) {
        toast.error(isAr ? 'حجم الصورة كبير، الحد الأقصى ~450 ك.ب' : 'Image too large, max ~450KB');
        return;
      }
      setLogoBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const saveBranding = async () => {
    const trimmedName = (academyName || '').trim();
    if (!trimmedName) {
      toast.error(isAr ? 'اسم الأكاديمية مطلوب' : 'Academy name required');
      return false;
    }
    try {
      await tenantAPI.updateBranding({
        name: trimmedName,
        logo_base64: logoBase64 || '',
        primary_color: primaryColor || '',
        tax_number: (taxNumber || '').trim(),
        commercial_reg: (commercialReg || '').trim(),
      });
      try { await loadBranding(); } catch (e) {}
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || (isAr ? 'تعذر حفظ هوية الأكاديمية' : 'Failed to save branding'));
      return false;
    }
  };

  const saveBranch = async () => {
    if (!branchId) return true;
    const nameAr = (branchForm.name_ar || '').trim();
    const nameEn = (branchForm.name || '').trim() || nameAr;
    if (!nameAr && !nameEn) {
      toast.error(isAr ? 'اسم الفرع مطلوب' : 'Branch name required');
      return false;
    }
    try {
      const original = branchOriginalRef.current || {};
      await branchesAPI.update(branchId, {
        ...original,
        name: nameEn,
        name_ar: nameAr || nameEn,
        address: branchForm.address || '',
        phone: branchForm.phone || '',
        email: original.email || '',
        manager_name: original.manager_name || '',
        is_active: original.is_active !== false,
      });
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || (isAr ? 'تعذر حفظ بيانات الفرع' : 'Failed to save branch'));
      return false;
    }
  };

  const saveCoach = async () => {
    if (skipCoach) return true;
    const nm = (coachForm.name || '').trim();
    if (!nm) return true;
    const phone = (coachForm.phone || '').trim();
    if (!phone) {
      toast.error(isAr ? 'رقم المدرب مطلوب أو فعّل التخطي' : 'Coach phone required or enable skip');
      return false;
    }
    try {
      await coachesAPI.create({
        name: nm,
        name_ar: nm,
        phone,
        email: '',
        activities: [],
        specialization: coachForm.specialty || '',
        notes: '',
        photo: '',
        branch_id: branchId || null,
      });
      return true;
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail.map(d => d.msg).join('، ') : detail;
      toast.error(msg || (isAr ? 'تعذر إضافة المدرب' : 'Failed to add coach'));
      return false;
    }
  };

  const finalize = async () => {
    try {
      await tenantAPI.completeOnboarding();
      toast.success(isAr ? 'تم إكمال الإعداد بنجاح' : 'Onboarding completed');
      navigate('/admin/dashboard', { replace: true });
    } catch (e) {
      toast.error(isAr ? 'تعذر إنهاء الإعداد' : 'Failed to finish onboarding');
    }
  };

  const handleNext = async () => {
    setSaving(true);
    try {
      const step = STEPS[stepIdx];
      let ok = true;
      if (step === 'branding') ok = await saveBranding();
      else if (step === 'branch') ok = await saveBranch();
      else if (step === 'coach') ok = await saveCoach();
      if (!ok) return;
      if (stepIdx === STEPS.length - 1) {
        await finalize();
      } else {
        setStepIdx(stepIdx + 1);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => { if (stepIdx > 0) setStepIdx(stepIdx - 1); };

  const handleSkipAll = async () => {
    if (!window.confirm(isAr ? 'هل تريد تخطي جميع خطوات الإعداد؟ يمكنك تعديل الإعدادات لاحقاً.' : 'Skip all setup steps? You can edit settings later.')) return;
    setSaving(true);
    try { await finalize(); } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="spinner" />
      </div>
    );
  }

  const step = STEPS[stepIdx];
  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background flex items-center justify-center p-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-2xl bg-card rounded-2xl shadow-xl border overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold">{isAr ? 'معالج إعداد الأكاديمية' : 'Academy Setup Wizard'}</h2>
            </div>
            <span className="text-xs text-muted-foreground">{isAr ? `الخطوة ${stepIdx + 1} من ${STEPS.length}` : `Step ${stepIdx + 1} of ${STEPS.length}`}</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="p-6 min-h-[360px]">
          {step === 'welcome' && (
            <div className="text-center py-6 space-y-4">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Trophy className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-2xl font-bold">{isAr ? `أهلاً بك في ${tenantInfo.name || 'أكاديميتك'}` : `Welcome to ${tenantInfo.name || 'your academy'}`}</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                {isAr
                  ? 'سنأخذك في جولة سريعة لضبط هوية أكاديميتك وأول فرع وأول مدرب. تستغرق دقيقتين فقط.'
                  : 'We\'ll quickly set up your branding, first branch, and first coach. Takes about 2 minutes.'}
              </p>
              {tenantInfo.plan && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  {isAr ? `خطة: ${tenantInfo.plan}` : `Plan: ${tenantInfo.plan}`}
                </div>
              )}
            </div>
          )}

          {step === 'branding' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2"><ImageIcon className="w-5 h-5 text-primary" />{isAr ? 'هوية الأكاديمية' : 'Academy Branding'}</h3>
                <p className="text-sm text-muted-foreground mt-1">{isAr ? 'الشعار واللون والاسم اختيارية، يمكنك تعديلها لاحقاً.' : 'Logo, color and name are optional — editable later.'}</p>
              </div>
              <div>
                <Label>{isAr ? 'اسم الأكاديمية المعروض' : 'Display name'}</Label>
                <Input value={academyName} onChange={(e) => setAcademyName(e.target.value)} placeholder={isAr ? 'مثال: أكاديمية الأبطال' : 'e.g. Champions Academy'} maxLength={120} />
              </div>
              <div>
                <Label>{isAr ? 'الشعار (اختياري)' : 'Logo (optional)'}</Label>
                <div className="flex items-center gap-3 mt-1">
                  <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center overflow-hidden border">
                    {logoBase64 ? <img src={logoBase64} alt="logo" className="w-full h-full object-contain" /> : <Trophy className="w-7 h-7 text-muted-foreground" />}
                  </div>
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoFile(e.target.files?.[0])} />
                    <span className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-background hover:bg-accent text-sm">
                      <Upload className="w-4 h-4" />{isAr ? 'رفع صورة' : 'Upload'}
                    </span>
                  </label>
                  {logoBase64 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLogoBase64('')}>{isAr ? 'إزالة' : 'Remove'}</Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>{isAr ? 'الرقم الضريبي (اختياري)' : 'Tax number (optional)'}</Label>
                  <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} placeholder={isAr ? 'مثال: 312655637900003' : 'e.g. 312655637900003'} maxLength={50} dir="ltr" />
                  <p className="text-xs text-muted-foreground mt-1">{isAr ? 'سيظهر تلقائياً في كل فواتير أكاديميتك.' : 'Will appear automatically on all your invoices.'}</p>
                </div>
                <div>
                  <Label>{isAr ? 'رقم السجل التجاري (اختياري)' : 'Commercial registration (optional)'}</Label>
                  <Input value={commercialReg} onChange={(e) => setCommercialReg(e.target.value)} placeholder={isAr ? 'مثال: 7043630230' : 'e.g. 7043630230'} maxLength={50} dir="ltr" />
                </div>
              </div>
              <div>
                <Label>{isAr ? 'اللون الأساسي (اختياري)' : 'Primary color (optional)'}</Label>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPrimaryColor(c)}
                      className={`w-8 h-8 rounded-full border-2 transition ${primaryColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                  <input type="color" value={primaryColor || '#f97316'} onChange={(e) => setPrimaryColor(e.target.value.toLowerCase())} className="w-10 h-10 rounded cursor-pointer border" />
                  {primaryColor && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPrimaryColor('')}>{isAr ? 'افتراضي' : 'Default'}</Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 'branch' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2"><Building2 className="w-5 h-5 text-primary" />{isAr ? 'الفرع الأول' : 'First Branch'}</h3>
                <p className="text-sm text-muted-foreground mt-1">{isAr ? 'تأكد من بيانات الفرع الذي أُنشئ تلقائياً.' : 'Confirm details of the auto-created branch.'}</p>
              </div>
              {!branchId ? (
                <p className="text-sm text-muted-foreground">{isAr ? 'لم يُعثر على فرع افتراضي.' : 'No default branch found.'}</p>
              ) : (
                <>
                  <div>
                    <Label>{isAr ? 'اسم الفرع (عربي)' : 'Branch name (Arabic)'}</Label>
                    <Input value={branchForm.name_ar} onChange={(e) => setBranchForm({ ...branchForm, name_ar: e.target.value })} />
                  </div>
                  <div>
                    <Label>{isAr ? 'اسم الفرع (إنجليزي)' : 'Branch name (English)'}</Label>
                    <Input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>{isAr ? 'العنوان' : 'Address'}</Label>
                    <Input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} />
                  </div>
                  <div>
                    <Label>{isAr ? 'رقم التواصل' : 'Phone'}</Label>
                    <Input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'coach' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2"><UserCog className="w-5 h-5 text-primary" />{isAr ? 'أول مدرب' : 'First Coach'}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{isAr ? 'أضف بيانات أول مدرب أو تخطّ هذه الخطوة.' : 'Add your first coach or skip this step.'}</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={skipCoach} onChange={(e) => setSkipCoach(e.target.checked)} />
                  {isAr ? 'تخطي' : 'Skip'}
                </label>
              </div>
              {!skipCoach && (
                <>
                  <div>
                    <Label>{isAr ? 'الاسم' : 'Name'}</Label>
                    <Input value={coachForm.name} onChange={(e) => setCoachForm({ ...coachForm, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>{isAr ? 'التخصص' : 'Specialty'}</Label>
                    <Input value={coachForm.specialty} onChange={(e) => setCoachForm({ ...coachForm, specialty: e.target.value })} placeholder={isAr ? 'مثال: كرة قدم' : 'e.g. Football'} />
                  </div>
                  <div>
                    <Label>{isAr ? 'رقم التواصل' : 'Phone'}</Label>
                    <Input value={coachForm.phone} onChange={(e) => setCoachForm({ ...coachForm, phone: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleSkipAll} disabled={saving}>
            <SkipForward className="w-4 h-4 me-1" />{isAr ? 'تخطي الكل' : 'Skip all'}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleBack} disabled={stepIdx === 0 || saving}>
              {isAr ? <ChevronRight className="w-4 h-4 me-1" /> : <ChevronLeft className="w-4 h-4 me-1" />}
              {isAr ? 'السابق' : 'Back'}
            </Button>
            <Button onClick={handleNext} disabled={saving}>
              {stepIdx === STEPS.length - 1 ? (
                <><Check className="w-4 h-4 me-1" />{isAr ? 'إنهاء الإعداد' : 'Finish'}</>
              ) : (
                <>{isAr ? 'التالي' : 'Next'}{isAr ? <ChevronLeft className="w-4 h-4 ms-1" /> : <ChevronRight className="w-4 h-4 ms-1" />}</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
