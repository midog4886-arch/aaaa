import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { publicAPI } from '../services/api';
import {
  Trophy, Languages, Check, Users, Calendar, Receipt, MessageCircle,
  BarChart3, Smartphone, ShieldCheck, Loader2, Sparkles, ArrowLeft, ArrowRight,
} from 'lucide-react';

const FEATURE_ICONS = [Users, Calendar, Receipt, BarChart3, MessageCircle, Smartphone];

export default function LandingPage() {
  const { language, toggleLanguage } = useLanguage();
  const { isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [trialDays, setTrialDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState('monthly');

  useEffect(() => {
    let cancelled = false;
    publicAPI.getPlans()
      .then((res) => {
        if (cancelled) return;
        setPlans(res.data?.plans || []);
        setTrialDays(res.data?.trial_days || 30);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const isAr = language === 'ar';
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  const features = [
    { ar: 'إدارة الأعضاء والاشتراكات', en: 'Member & subscription management', desc_ar: 'ملفات الأعضاء، التجديدات، التجميد، وكروت QR.', desc_en: 'Member profiles, renewals, freezes, and QR cards.' },
    { ar: 'الجدول والمستويات', en: 'Schedule & levels', desc_ar: 'جدول تدريبي ذكي، مستويات تلقائية حسب اليوم والوقت.', desc_en: 'Smart training schedule with auto-assigned levels.' },
    { ar: 'الفواتير والمحاسبة', en: 'Invoicing & accounting', desc_ar: 'فواتير ضريبية بـ 15% VAT، يومية مالية، ومصاريف داخلية.', desc_en: 'VAT 15% tax invoices, daily ledger, and expenses.' },
    { ar: 'تقارير وحضور', en: 'Reports & attendance', desc_ar: 'حضور بـ QR، تقارير تفصيلية للأعضاء والمدربين.', desc_en: 'QR check-in and detailed member & coach reports.' },
    { ar: 'تواصل وإشعارات', en: 'Communication & notifications', desc_ar: 'WhatsApp، إشعارات Push، ورسائل داخلية.', desc_en: 'WhatsApp, push notifications, and in-app messages.' },
    { ar: 'تطبيق جوال للأعضاء', en: 'Member mobile app', desc_ar: 'تطبيق Android للأعضاء يعرض الجدول والإشعارات والولاء.', desc_en: 'Android app for members with schedule, notifications, and loyalty.' },
  ];

  const handleStart = () => {
    if (isAuthenticated && isAdmin) navigate('/admin/dashboard');
    else navigate('/signup');
  };

  const formatPrice = (plan) => {
    if (plan.contact_only) return isAr ? 'تواصل معنا' : 'Contact us';
    const val = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;
    if (val == null) return isAr ? 'قريباً' : 'TBD';
    if (billingCycle === 'yearly') return isAr ? `${val} ر.س / سنة` : `${val} SAR / year`;
    return isAr ? `${val} ر.س / شهر` : `${val} SAR / month`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Trophy className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="font-bold text-lg">
              {isAr ? 'منصة الأبطال للأكاديميات' : 'Champions Academy Platform'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleLanguage}>
              <Languages className="w-4 h-4 me-1" />
              {isAr ? 'EN' : 'العربية'}
            </Button>
            <Link to="/login">
              <Button variant="outline" size="sm" data-testid="landing-login-btn">
                {isAr ? 'دخول الأكاديميات' : 'Academy login'}
              </Button>
            </Link>
            <Button size="sm" onClick={handleStart} data-testid="landing-start-btn">
              {isAr ? 'ابدأ مجاناً' : 'Start free'}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-16 sm:py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-semibold mb-6">
          <Sparkles className="w-4 h-4" />
          {isAr ? `جربها مجاناً ${trialDays} يوم — بدون بطاقة` : `Free ${trialDays}-day trial — no card needed`}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          {isAr ? (
            <>نظام إدارة كامل<br />لأكاديميتك الرياضية</>
          ) : (
            <>The complete management<br />system for your sports academy</>
          )}
        </h1>
        <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-10">
          {isAr
            ? 'أعضاء، جداول، فواتير، حضور، تواصل وتقارير — كل ما تحتاجه لإدارة أكاديميتك من مكان واحد.'
            : 'Members, schedules, invoices, attendance, communication, and reports — everything you need to run your academy in one place.'}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button size="lg" onClick={handleStart} data-testid="hero-start-btn">
            {isAr ? 'ابدأ تجربتك المجانية' : 'Start your free trial'}
            <Arrow className="w-4 h-4 ms-2" />
          </Button>
          <a href="#pricing">
            <Button size="lg" variant="outline">
              {isAr ? 'شاهد الأسعار' : 'See pricing'}
            </Button>
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">
          {isAr ? 'كل أدواتك في منصة واحدة' : 'All your tools in one platform'}
        </h2>
        <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
          {isAr ? 'صُمّم خصيصاً للأكاديميات الرياضية في السوق السعودي والخليجي.' : 'Built for sports academies in the Saudi and Gulf market.'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => {
            const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
            return (
              <Card key={i} className="border-slate-200 dark:border-slate-800">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{isAr ? f.ar : f.en}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{isAr ? f.desc_ar : f.desc_en}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-4 py-16 sm:py-24">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">
          {isAr ? 'خطط بسيطة وواضحة' : 'Simple, clear pricing'}
        </h2>
        <p className="text-center text-slate-600 dark:text-slate-400 mb-8 max-w-2xl mx-auto">
          {isAr
            ? `جميع الخطط تشمل تجربة ${trialDays} يوم مجانية. الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة 15%.`
            : `All plans include a ${trialDays}-day free trial. Prices in SAR, exclusive of 15% VAT.`}
        </p>

        <div className="flex justify-center mb-10">
          <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-full">
            <button
              onClick={() => setBillingCycle('monthly')}
              data-testid="cycle-monthly"
              className={`px-5 py-1.5 text-sm font-semibold rounded-full transition ${billingCycle === 'monthly' ? 'bg-white dark:bg-slate-700 shadow' : 'text-slate-600 dark:text-slate-400'}`}
            >
              {isAr ? 'شهري' : 'Monthly'}
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              data-testid="cycle-yearly"
              className={`px-5 py-1.5 text-sm font-semibold rounded-full transition ${billingCycle === 'yearly' ? 'bg-white dark:bg-slate-700 shadow' : 'text-slate-600 dark:text-slate-400'}`}
            >
              {isAr ? 'سنوي (وفّر ~17%)' : 'Yearly (save ~17%)'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((plan) => (
              <Card
                key={plan.id}
                className={`relative ${plan.popular ? 'border-primary border-2 shadow-xl scale-[1.02]' : 'border-slate-200 dark:border-slate-800'}`}
                data-testid={`plan-card-${plan.id}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                    {isAr ? 'الأكثر طلباً' : 'Most popular'}
                  </div>
                )}
                <CardContent className="p-6">
                  <h3 className="text-2xl font-bold mb-1">{isAr ? plan.name_ar : plan.name_en}</h3>
                  <p className="text-sm text-slate-500 mb-4">{isAr ? plan.tagline_ar : plan.tagline_en}</p>
                  <div className="mb-6">
                    <div className="text-3xl font-extrabold">{formatPrice(plan)}</div>
                  </div>
                  <ul className="space-y-2 mb-6">
                    {(isAr ? plan.features_ar : plan.features_en).map((feat, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={plan.popular ? 'default' : 'outline'}
                    onClick={() => {
                      if (plan.contact_only) {
                        window.location.href = `mailto:sales@championsacademy.app?subject=${encodeURIComponent(isAr ? 'استفسار خطة المؤسسات' : 'Enterprise plan inquiry')}`;
                      } else {
                        navigate(`/signup?plan=${plan.id}&cycle=${billingCycle}`);
                      }
                    }}
                    data-testid={`plan-cta-${plan.id}`}
                  >
                    {isAr ? plan.cta_ar : plan.cta_en}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Trust */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <Card className="bg-primary text-primary-foreground border-0">
          <CardContent className="p-8 sm:p-12 text-center">
            <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-80" />
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">
              {isAr ? 'بياناتك معك دائماً' : 'Your data, always yours'}
            </h2>
            <p className="opacity-90 max-w-2xl mx-auto">
              {isAr
                ? 'كل أكاديمية معزولة في قاعدة بيانات مستقلة. نسخ احتياطي تلقائي، تشفير، وامتثال لسياسات الخصوصية.'
                : 'Each academy is isolated in its own database. Automatic backups, encryption, and privacy compliance.'}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Final CTA */}
      <section className="max-w-3xl mx-auto px-4 py-16 sm:py-24 text-center">
        <h2 className="text-3xl sm:text-5xl font-bold mb-6">
          {isAr ? 'جاهز تطلق أكاديميتك؟' : 'Ready to launch your academy?'}
        </h2>
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
          {isAr
            ? `جربها مجاناً ${trialDays} يوم. لا تحتاج بطاقة ائتمانية للبدء.`
            : `${trialDays}-day free trial. No credit card required.`}
        </p>
        <Button size="lg" onClick={handleStart} data-testid="footer-start-btn">
          {isAr ? 'ابدأ تجربتك الآن' : 'Start your trial'}
          <Arrow className="w-4 h-4 ms-2" />
        </Button>
      </section>

      {/* Footer */}
      <footer className="border-t bg-slate-50 dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-600 dark:text-slate-400">
          <div>© {new Date().getFullYear()} {isAr ? 'منصة الأبطال للأكاديميات' : 'Champions Academy Platform'}</div>
          <div className="flex items-center gap-4 flex-wrap">
            <Link to="/privacy" className="hover:text-primary">
              {isAr ? 'سياسة الخصوصية' : 'Privacy policy'}
            </Link>
            <Link to="/privacy" className="hover:text-primary">
              {isAr ? 'الشروط والاسترداد' : 'Terms & refunds'}
            </Link>
            <a href="mailto:sales@championsacademy.app" className="hover:text-primary">
              {isAr ? 'تواصل معنا' : 'Contact us'}
            </a>
            <Link to="/login" className="hover:text-primary">
              {isAr ? 'تسجيل الدخول' : 'Login'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
