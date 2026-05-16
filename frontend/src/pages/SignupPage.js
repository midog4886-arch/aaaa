import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { publicAPI } from '../services/api';
import { Trophy, Loader2, Languages, Check, X, ArrowLeft, ArrowRight } from 'lucide-react';

export default function SignupPage() {
  const { language, toggleLanguage } = useLanguage();
  const { isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isAr = language === 'ar';
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  const [plans, setPlans] = useState([]);
  const [trialDays, setTrialDays] = useState(30);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [academyName, setAcademyName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');
  const [planId, setPlanId] = useState(params.get('plan') || 'pro');
  const [cycle, setCycle] = useState(params.get('cycle') || 'monthly');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [slugCheck, setSlugCheck] = useState({ status: 'idle' });
  const slugTimer = useRef(null);

  useEffect(() => {
    if (isAuthenticated && isAdmin) navigate('/admin/dashboard');
  }, [isAuthenticated, isAdmin, navigate]);

  useEffect(() => {
    publicAPI.getPlans()
      .then((res) => {
        const list = res.data?.plans || [];
        setPlans(list.filter((p) => !p.contact_only));
        setTrialDays(res.data?.trial_days || 30);
        if (!list.find((p) => p.id === planId)) {
          const def = list.find((p) => !p.contact_only)?.id || 'starter';
          setPlanId(def);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPlans(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSlugChange = (raw) => {
    const cleaned = (raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
    setSlug(cleaned);
    setSlugCheck({ status: 'idle' });
    if (slugTimer.current) clearTimeout(slugTimer.current);
    if (cleaned.length < 2) return;
    setSlugCheck({ status: 'checking' });
    slugTimer.current = setTimeout(async () => {
      try {
        const res = await publicAPI.checkSlug(cleaned);
        if (res.data?.available) {
          setSlugCheck({ status: 'available' });
        } else {
          const reason = res.data?.reason;
          const msg = reason === 'taken'
            ? (isAr ? 'هذا النطاق محجوز' : 'Already taken')
            : reason === 'reserved'
            ? (isAr ? 'هذا النطاق محجوز للنظام' : 'Reserved name')
            : (isAr ? 'صيغة غير صحيحة' : 'Invalid format');
          setSlugCheck({ status: 'unavailable', message: msg });
        }
      } catch {
        setSlugCheck({ status: 'idle' });
      }
    }, 350);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (slugCheck.status === 'unavailable') {
      setError(isAr ? 'النطاق الفرعي غير متاح' : 'Subdomain not available');
      return;
    }
    if (adminPassword.length < 6) {
      setError(isAr ? 'كلمة المرور 6 أحرف على الأقل' : 'Password must be at least 6 characters');
      return;
    }
    setSubmitting(true);
    try {
      const res = await publicAPI.signup({
        academy_name: academyName.trim(),
        slug: slug.trim(),
        owner_name: ownerName.trim(),
        owner_email: email.trim(),
        owner_phone: phone.trim(),
        admin_username: adminUsername.trim().toLowerCase(),
        admin_password: adminPassword,
        plan: planId,
        billing_cycle: cycle,
      });
      const data = res.data || {};
      try {
        localStorage.setItem('tenant_slug', data.tenant?.slug || slug);
        Object.keys(localStorage).filter((k) => k.startsWith('tenant_branding:')).forEach((k) => localStorage.removeItem(k));
      } catch {}
      if (data.pending_approval) {
        toast.success(
          isAr
            ? 'تم إنشاء طلبك بنجاح! حسابك بانتظار موافقة الإدارة قبل التفعيل.'
            : 'Your request was submitted! Your account is awaiting admin approval.'
        );
        setSubmitting(false);
        setError(
          isAr
            ? `تم تسجيل أكاديميتك "${data.tenant?.name || ''}" بنجاح. سيتم إعلامك عبر البريد الإلكتروني (${email}) فور الموافقة. لا يمكنك الدخول حالياً حتى تتم الموافقة.`
            : `Your academy was registered. We will notify ${email} once an admin approves it.`
        );
        return;
      }
      try {
        localStorage.setItem('token', data.access_token || '');
        axios.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`;
      } catch {}
      toast.success(isAr ? `تم إنشاء أكاديميتك! تجربة ${trialDays} يوم بدأت.` : `Academy created! ${trialDays}-day trial started.`);
      window.location.replace('/admin/onboarding');
    } catch (err) {
      const msg = err?.response?.data?.detail || (isAr ? 'تعذر إنشاء الحساب' : 'Signup failed');
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 py-10 px-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center gap-3 text-slate-700 dark:text-slate-200 hover:opacity-80">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Trophy className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="font-bold">{isAr ? 'منصة الأبطال' : 'Champions Platform'}</span>
          </Link>
          <Button variant="outline" size="sm" onClick={toggleLanguage} className="bg-white/80 backdrop-blur">
            <Languages className="w-4 h-4 me-1" />
            {isAr ? 'EN' : 'العربية'}
          </Button>
        </div>

        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl">
              {isAr ? 'سجّل أكاديميتك' : 'Create your academy'}
            </CardTitle>
            <CardDescription>
              {isAr ? `ابدأ تجربة مجانية لمدة ${trialDays} يوم — بدون بطاقة ائتمانية.` : `Start a ${trialDays}-day free trial — no credit card needed.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm" data-testid="signup-error">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="academy_name">{isAr ? 'اسم الأكاديمية *' : 'Academy name *'}</Label>
                  <Input
                    id="academy_name"
                    value={academyName}
                    onChange={(e) => setAcademyName(e.target.value)}
                    required maxLength={120}
                    placeholder={isAr ? 'أكاديمية النجوم' : 'Stars Academy'}
                    data-testid="signup-academy-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">{isAr ? 'النطاق الفرعي *' : 'Subdomain *'}</Label>
                  <div className="relative">
                    <Input
                      id="slug"
                      value={slug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      required minLength={2} maxLength={40}
                      placeholder="stars_academy"
                      className="ltr text-left pe-9"
                      style={{ direction: 'ltr' }}
                      data-testid="signup-slug"
                    />
                    {slugCheck.status === 'checking' && <Loader2 className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />}
                    {slugCheck.status === 'available' && <Check className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 text-green-600" />}
                    {slugCheck.status === 'unavailable' && <X className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 text-red-600" />}
                  </div>
                  <p className="text-xs text-slate-500">
                    {slugCheck.status === 'unavailable'
                      ? <span className="text-red-600">{slugCheck.message}</span>
                      : (isAr ? 'حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط.' : 'Lowercase letters, digits, and underscores only.')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="owner_name">{isAr ? 'اسمك (المسؤول) *' : 'Your name (admin) *'}</Label>
                  <Input id="owner_name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required maxLength={120} data-testid="signup-owner-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{isAr ? 'البريد الإلكتروني *' : 'Email *'}</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="signup-email" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">{isAr ? 'رقم الجوال' : 'Phone'}</Label>
                  <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" data-testid="signup-phone" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin_username">{isAr ? 'اسم المستخدم *' : 'Admin username *'}</Label>
                  <Input
                    id="admin_username"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                    required minLength={3} maxLength={40}
                    style={{ direction: 'ltr' }}
                    data-testid="signup-username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="admin_password">{isAr ? 'كلمة المرور *' : 'Password *'}</Label>
                <Input
                  id="admin_password"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required minLength={6}
                  data-testid="signup-password"
                />
                <p className="text-xs text-slate-500">{isAr ? '6 أحرف على الأقل.' : 'At least 6 characters.'}</p>
              </div>

              <div className="space-y-2">
                <Label>{isAr ? 'اختر الخطة' : 'Choose your plan'}</Label>
                {loadingPlans ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {plans.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPlanId(p.id)}
                        data-testid={`signup-plan-${p.id}`}
                        className={`text-start p-4 rounded-lg border-2 transition ${planId === p.id ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                      >
                        <div className="font-bold mb-1">{isAr ? p.name_ar : p.name_en}</div>
                        <div className="text-xs text-slate-500">{isAr ? p.tagline_ar : p.tagline_en}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>{isAr ? 'دورة الفوترة' : 'Billing cycle'}</Label>
                <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-full">
                  <button type="button" onClick={() => setCycle('monthly')} className={`px-4 py-1.5 text-sm font-semibold rounded-full ${cycle === 'monthly' ? 'bg-white dark:bg-slate-700 shadow' : 'text-slate-600'}`}>
                    {isAr ? 'شهري' : 'Monthly'}
                  </button>
                  <button type="button" onClick={() => setCycle('yearly')} className={`px-4 py-1.5 text-sm font-semibold rounded-full ${cycle === 'yearly' ? 'bg-white dark:bg-slate-700 shadow' : 'text-slate-600'}`}>
                    {isAr ? 'سنوي' : 'Yearly'}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  {isAr ? 'لن يتم الخصم خلال فترة التجربة. يمكنك الإلغاء في أي وقت.' : 'You won\'t be charged during the trial. Cancel anytime.'}
                </p>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting} data-testid="signup-submit">
                {submitting ? (
                  <><Loader2 className="w-4 h-4 me-2 animate-spin" /> {isAr ? 'جاري الإنشاء...' : 'Creating...'}</>
                ) : (
                  <>{isAr ? 'إنشاء الأكاديمية' : 'Create my academy'} <Arrow className="w-4 h-4 ms-2" /></>
                )}
              </Button>

              <p className="text-xs text-center text-slate-500">
                {isAr ? (
                  <>بإنشاء الحساب أنت توافق على <Link to="/terms" className="text-primary underline">شروط الاستخدام</Link>، <Link to="/privacy" className="text-primary underline">سياسة الخصوصية</Link>، و<Link to="/refund-policy" className="text-primary underline">سياسة الاسترجاع</Link>.</>
                ) : (
                  <>By signing up you agree to our <Link to="/terms" className="text-primary underline">Terms</Link>, <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>, and <Link to="/refund-policy" className="text-primary underline">Refund Policy</Link>.</>
                )}
              </p>

              <p className="text-sm text-center">
                {isAr ? 'لديك حساب بالفعل؟ ' : 'Already have an account? '}
                <Link to="/login" className="text-primary font-semibold hover:underline">
                  {isAr ? 'سجّل دخول' : 'Sign in'}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
