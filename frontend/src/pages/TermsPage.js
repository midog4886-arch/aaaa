import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trophy, Languages, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';

const TermsPage = () => {
  const [searchParams] = useSearchParams();
  const langParam = searchParams.get('lang');
  const [language, setLanguage] = useState(langParam === 'en' ? 'en' : 'ar');
  const isAr = language === 'ar';
  const toggleLanguage = () => setLanguage((p) => (p === 'ar' ? 'en' : 'ar'));

  const content = {
    ar: {
      title: 'شروط الاستخدام',
      lastUpdated: 'آخر تحديث: مايو 2026',
      backHome: 'العودة للرئيسية',
      sections: [
        {
          title: '1. قبول الشروط',
          body: 'باستخدامك لمنصة الأبطال للأكاديميات (يُشار إليها فيما بعد بـ "المنصة" أو "الخدمة")، فإنك توافق على الالتزام بهذه الشروط. إذا لم توافق على أي جزء منها، يرجى عدم استخدام الخدمة.',
        },
        {
          title: '2. وصف الخدمة',
          body: 'تقدم المنصة نظاماً لإدارة الأكاديميات الرياضية يشمل إدارة الأعضاء، الفواتير، الحضور، الجداول، التقارير، والتواصل. تُقدَّم الخدمة عبر اشتراك شهري أو سنوي حسب الخطة المختارة.',
        },
        {
          title: '3. الحساب والاشتراك',
          body: '• تجربة مجانية: تتاح فترة تجريبية مجانية لمدة محددة عند التسجيل، دون الحاجة لإدخال بطاقة ائتمانية.\n• المسؤولية: أنت مسؤول عن سرية بيانات حسابك وعن جميع الأنشطة التي تتم من خلاله.\n• الدقة: تتعهد بتقديم بيانات صحيحة ومحدثة عند التسجيل.',
        },
        {
          title: '4. الدفع والفواتير',
          body: '• الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة (15%) ما لم يُذكر خلاف ذلك.\n• تُجدَّد الاشتراكات تلقائياً في نهاية كل دورة فوترة، ما لم تطلب الإلغاء قبل تاريخ التجديد.\n• قد نقوم بتعديل الأسعار مع إشعارك قبل 30 يوماً على الأقل من سريان التعديل.',
        },
        {
          title: '5. الاستخدام المسموح',
          body: 'يُحظر استخدام المنصة لأي غرض غير قانوني أو ضار، بما في ذلك على سبيل المثال لا الحصر:\n• محاولة اختراق المنصة أو الوصول غير المصرح به للبيانات\n• إرسال محتوى مسيء أو تحريضي\n• استخدام المنصة لإرسال رسائل غير مرغوبة\n• تحميل ملفات ضارة أو فيروسات',
        },
        {
          title: '6. الملكية الفكرية',
          body: 'جميع الحقوق المتعلقة بالمنصة، بما في ذلك التصميم والشعارات والكود والمحتوى، مملوكة لشركة اداء الابطال العالمية للرياضة. لا يجوز نسخها أو إعادة توزيعها دون إذن خطي مسبق.',
        },
        {
          title: '7. تعليق الحساب وإنهاؤه',
          body: 'يحق لنا تعليق أو إنهاء حسابك في حال:\n• مخالفة شروط الاستخدام\n• عدم سداد رسوم الاشتراك في الموعد المحدد\n• الاشتباه في نشاط احتيالي\n\nستحتفظ ببياناتك لمدة 30 يوماً بعد الإنهاء قبل حذفها نهائياً، ما لم يُطلب منا غير ذلك بموجب القانون.',
        },
        {
          title: '8. حدود المسؤولية',
          body: 'تُقدَّم الخدمة "كما هي" دون أي ضمانات صريحة أو ضمنية. لا نتحمل المسؤولية عن أي أضرار غير مباشرة أو تبعية تنشأ عن استخدام أو عدم القدرة على استخدام الخدمة، باستثناء ما لا يجوز استبعاده قانوناً.',
        },
        {
          title: '9. التعديلات',
          body: 'يحق لنا تعديل هذه الشروط في أي وقت. سيتم إشعارك بأي تعديلات جوهرية عبر البريد الإلكتروني أو من خلال المنصة. استمرارك في استخدام الخدمة بعد التعديل يُعدّ موافقة على الشروط المعدلة.',
        },
        {
          title: '10. القانون المعمول به',
          body: 'تخضع هذه الشروط لقوانين المملكة العربية السعودية. تُحَل أي نزاعات تنشأ عنها عبر المحاكم المختصة في المملكة العربية السعودية.',
        },
        {
          title: '11. التواصل',
          body: 'لأي استفسار حول هذه الشروط، يرجى التواصل عبر:\nالبريد الإلكتروني: support@championsacademy.app\nشركة اداء الابطال العالمية للرياضة، المملكة العربية السعودية',
        },
      ],
    },
    en: {
      title: 'Terms of Service',
      lastUpdated: 'Last updated: May 2026',
      backHome: 'Back to home',
      sections: [
        {
          title: '1. Acceptance of Terms',
          body: 'By using the Champions Academy Platform (the "Platform" or "Service"), you agree to be bound by these Terms. If you do not agree to any part of them, please do not use the Service.',
        },
        {
          title: '2. Service Description',
          body: 'The Platform provides a sports academy management system covering member management, invoicing, attendance, scheduling, reporting, and communication. The Service is offered via monthly or yearly subscription depending on the chosen plan.',
        },
        {
          title: '3. Account & Subscription',
          body: '• Free trial: A free trial period is offered upon signup, with no credit card required.\n• Responsibility: You are responsible for the confidentiality of your account credentials and all activities conducted through your account.\n• Accuracy: You agree to provide accurate and up-to-date information when registering.',
        },
        {
          title: '4. Payment & Billing',
          body: '• Prices are in Saudi Riyals and exclusive of 15% VAT unless stated otherwise.\n• Subscriptions auto-renew at the end of each billing cycle unless cancellation is requested before the renewal date.\n• We may revise pricing with at least 30 days advance notice before changes take effect.',
        },
        {
          title: '5. Acceptable Use',
          body: 'You may not use the Platform for any unlawful or harmful purpose, including but not limited to:\n• Attempting to breach security or gain unauthorized access to data\n• Posting offensive or inflammatory content\n• Using the Platform to send unsolicited messages\n• Uploading malicious files or viruses',
        },
        {
          title: '6. Intellectual Property',
          body: 'All rights related to the Platform — including design, logos, code, and content — are owned by Global Champions Sports Performance Company. No copying or redistribution is permitted without prior written authorization.',
        },
        {
          title: '7. Suspension & Termination',
          body: 'We reserve the right to suspend or terminate your account if:\n• You violate these Terms\n• Subscription fees are not paid on time\n• Fraudulent activity is suspected\n\nYour data will be retained for 30 days after termination before permanent deletion, unless we are otherwise required by law.',
        },
        {
          title: '8. Limitation of Liability',
          body: 'The Service is provided "as is" without warranties of any kind, express or implied. We are not liable for any indirect or consequential damages arising from the use or inability to use the Service, except where such exclusion is prohibited by law.',
        },
        {
          title: '9. Modifications',
          body: 'We may modify these Terms at any time. Material changes will be communicated via email or through the Platform. Continued use of the Service after changes constitutes acceptance of the revised Terms.',
        },
        {
          title: '10. Governing Law',
          body: 'These Terms are governed by the laws of the Kingdom of Saudi Arabia. Any disputes arising shall be resolved through the competent courts in Saudi Arabia.',
        },
        {
          title: '11. Contact',
          body: 'For questions about these Terms, please contact:\nEmail: support@championsacademy.app\nGlobal Champions Sports Performance Company, Kingdom of Saudi Arabia',
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
      <main className="max-w-4xl mx-auto px-4 py-10" data-testid="terms-page">
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

export default TermsPage;
