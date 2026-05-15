import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trophy, Languages, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';

const RefundPolicyPage = () => {
  const [searchParams] = useSearchParams();
  const langParam = searchParams.get('lang');
  const [language, setLanguage] = useState(langParam === 'en' ? 'en' : 'ar');
  const isAr = language === 'ar';
  const toggleLanguage = () => setLanguage((p) => (p === 'ar' ? 'en' : 'ar'));

  const content = {
    ar: {
      title: 'سياسة الاسترجاع والإلغاء',
      lastUpdated: 'آخر تحديث: مايو 2026',
      backHome: 'العودة للرئيسية',
      sections: [
        {
          title: '1. الفترة التجريبية المجانية',
          body: 'نوفر تجربة مجانية لجميع الخطط دون الحاجة لإدخال بطاقة ائتمانية. خلال هذه الفترة، يمكنك تقييم المنصة بالكامل قبل الالتزام بأي اشتراك مدفوع.',
        },
        {
          title: '2. سياسة الاسترجاع للاشتراكات الشهرية',
          body: 'الاشتراكات الشهرية غير قابلة للاسترجاع بعد إتمام عملية الدفع، نظراً لقصر مدة الفوترة. يمكنك إلغاء التجديد التلقائي في أي وقت لتجنب فوترة الشهر التالي، وستستمر في الاستفادة من الخدمة حتى نهاية فترة الفوترة الحالية.',
        },
        {
          title: '3. سياسة الاسترجاع للاشتراكات السنوية',
          body: 'يحق لك طلب استرجاع كامل خلال 14 يوماً من تاريخ الدفع للاشتراكات السنوية، شريطة عدم استخدام الخدمة استخداماً جوهرياً. بعد هذه الفترة، يُحسَب الاسترجاع نسبياً بناءً على الأشهر المتبقية، مع خصم رسوم إدارية قدرها شهر واحد.',
        },
        {
          title: '4. حالات لا يُمنح فيها استرجاع',
          body: '• مخالفة شروط الاستخدام التي أدّت إلى تعليق الحساب\n• مرور أكثر من 14 يوماً على الدفع للاشتراكات السنوية مع استخدام جوهري للخدمة\n• الاشتراكات الشهرية بعد بدء فترة الفوترة\n• الخدمات الإضافية المقدَّمة لمرة واحدة (مثل الإعداد المخصص أو التدريب)',
        },
        {
          title: '5. كيفية طلب الاسترجاع',
          body: 'لطلب الاسترجاع، يرجى إرسال بريد إلكتروني إلى billing@championsacademy.app مع تضمين:\n• اسم الأكاديمية ورقم الحساب\n• تاريخ ورقم الفاتورة\n• سبب طلب الاسترجاع\n\nسنرد على طلبك خلال 5 أيام عمل، ويتم تحويل المبلغ المسترَد إلى نفس وسيلة الدفع الأصلية خلال 7-14 يوم عمل بعد الموافقة.',
        },
        {
          title: '6. إلغاء الاشتراك',
          body: 'يمكنك إلغاء اشتراكك في أي وقت من خلال:\n• لوحة الإعدادات في حسابك (قسم الفوترة)\n• إرسال طلب إلى support@championsacademy.app\n\nبعد الإلغاء، ستستمر في الوصول للخدمة حتى نهاية فترة الفوترة المدفوعة. لن يتم تجديد الاشتراك تلقائياً بعد ذلك.',
        },
        {
          title: '7. حذف البيانات',
          body: 'بعد إلغاء الاشتراك، تُحفَظ بياناتك لمدة 30 يوماً تتيح لك الاستئناف أو تحميل نسخة احتياطية. بعد هذه المدة، تُحذف البيانات نهائياً من خوادمنا، ما لم نُلزَم بالاحتفاظ بها لأغراض قانونية.',
        },
        {
          title: '8. التواصل',
          body: 'لأي استفسار حول الفوترة أو الاسترجاع:\nالبريد الإلكتروني: billing@championsacademy.app\nالدعم العام: support@championsacademy.app',
        },
      ],
    },
    en: {
      title: 'Refund & Cancellation Policy',
      lastUpdated: 'Last updated: May 2026',
      backHome: 'Back to home',
      sections: [
        {
          title: '1. Free Trial Period',
          body: 'We offer a free trial for all plans with no credit card required. During this period, you can fully evaluate the Platform before committing to any paid subscription.',
        },
        {
          title: '2. Monthly Subscription Refunds',
          body: 'Monthly subscriptions are non-refundable once payment has been processed, given the short billing period. You may cancel auto-renewal at any time to avoid being billed for the next month, and you will retain access until the end of the current billing cycle.',
        },
        {
          title: '3. Yearly Subscription Refunds',
          body: 'You may request a full refund within 14 days of payment for yearly subscriptions, provided the Service has not been used substantively. After this window, refunds are prorated based on the remaining months, less a one-month administrative fee.',
        },
        {
          title: '4. Non-Refundable Cases',
          body: '• Violations of the Terms of Service that resulted in account suspension\n• More than 14 days have passed since payment for yearly subscriptions, with substantive Service usage\n• Monthly subscriptions after the billing period has started\n• One-time add-on services (such as custom setup or training)',
        },
        {
          title: '5. How to Request a Refund',
          body: 'To request a refund, please email billing@championsacademy.app with:\n• Academy name and account number\n• Invoice date and number\n• Reason for the refund request\n\nWe will respond within 5 business days. Approved refunds are returned to the original payment method within 7-14 business days after approval.',
        },
        {
          title: '6. Cancelling a Subscription',
          body: 'You can cancel your subscription at any time via:\n• The Settings page in your account (Billing section)\n• Sending a request to support@championsacademy.app\n\nAfter cancellation, you will retain access through the end of your paid billing period. The subscription will not auto-renew after that.',
        },
        {
          title: '7. Data Deletion',
          body: 'After cancellation, your data is kept for 30 days, allowing you to resume or download a backup. Beyond this period, data is permanently deleted from our servers, unless we are required to retain it for legal purposes.',
        },
        {
          title: '8. Contact',
          body: 'For any billing or refund questions:\nEmail: billing@championsacademy.app\nGeneral support: support@championsacademy.app',
        },
      ],
    },
  };

  const c = content[language];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <Trophy className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="font-bold">{isAr ? 'منصة الأبطال' : 'Champions Academy'}</div>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleLanguage}>
              <Languages className="w-4 h-4 me-1" />
              {isAr ? 'EN' : 'العربية'}
            </Button>
            <Link to="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 me-1" />
                {c.backHome}
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-10" data-testid="refund-policy-page">
        <h1 className="text-3xl sm:text-4xl font-extrabold mb-2">{c.title}</h1>
        <p className="text-sm text-slate-500 mb-8">{c.lastUpdated}</p>
        <div className="space-y-8">
          {c.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-xl font-bold mb-2">{s.title}</h2>
              <p className="whitespace-pre-line text-slate-700 dark:text-slate-300 leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
};

export default RefundPolicyPage;
