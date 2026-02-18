import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const PrivacyPolicyPage = () => {
  const [searchParams] = useSearchParams();
  const langParam = searchParams.get('lang');
  const [language, setLanguage] = useState(langParam === 'en' ? 'en' : 'ar');

  const toggleLanguage = () => {
    setLanguage(prev => prev === 'ar' ? 'en' : 'ar');
  };

  const isAr = language === 'ar';

  const content = {
    ar: {
      title: 'سياسة الخصوصية',
      companyName: 'شركة اداء الابطال العالمية للرياضة',
      lastUpdated: 'آخر تحديث: فبراير 2026',
      toggleLabel: 'English',
      sections: [
        {
          title: 'مقدمة',
          body: 'نحن في شركة اداء الابطال العالمية للرياضة نلتزم بحماية خصوصية مستخدمينا. توضح سياسة الخصوصية هذه كيفية جمع واستخدام وحماية معلوماتك الشخصية عند استخدام تطبيقنا وخدماتنا.'
        },
        {
          title: 'البيانات التي نجمعها',
          body: 'نقوم بجمع المعلومات التالية:\n• الاسم الكامل ومعلومات الاتصال (رقم الهاتف، البريد الإلكتروني)\n• تاريخ الميلاد والجنس\n• معلومات العضوية والاشتراكات\n• سجلات الحضور والتدريب\n• بيانات الدفع والفواتير\n• صور الهوية (عند التسجيل)\n• بيانات الاستخدام والتفاعل مع التطبيق'
        },
        {
          title: 'كيف نستخدم بياناتك',
          body: 'نستخدم المعلومات التي نجمعها للأغراض التالية:\n• إدارة حسابك وعضويتك\n• تقديم الخدمات الرياضية والتدريبية\n• إرسال الإشعارات والتنبيهات المتعلقة بالاشتراكات\n• تحسين خدماتنا وتجربة المستخدم\n• إصدار الفواتير ومعالجة المدفوعات\n• التواصل معك بخصوص التحديثات والعروض\n• الامتثال للمتطلبات القانونية والتنظيمية'
        },
        {
          title: 'مشاركة البيانات',
          body: 'لا نقوم ببيع أو تأجير معلوماتك الشخصية لأطراف ثالثة. قد نشارك بياناتك في الحالات التالية:\n• مع مقدمي الخدمات الذين يساعدوننا في تشغيل التطبيق\n• عند الضرورة للامتثال للقوانين واللوائح المعمول بها\n• لحماية حقوقنا القانونية وسلامة مستخدمينا\n• بموافقتك الصريحة'
        },
        {
          title: 'أمان البيانات',
          body: 'نتخذ تدابير أمنية مناسبة لحماية معلوماتك الشخصية من الوصول غير المصرح به أو التغيير أو الإفصاح أو الإتلاف. تشمل هذه التدابير:\n• تشفير البيانات أثناء النقل والتخزين\n• التحكم في الوصول وإدارة الصلاحيات\n• المراقبة الدورية للأنظمة\n• النسخ الاحتياطي المنتظم للبيانات'
        },
        {
          title: 'حقوقك',
          body: 'لديك الحقوق التالية فيما يتعلق ببياناتك الشخصية:\n• الوصول إلى بياناتك الشخصية ومراجعتها\n• طلب تصحيح أو تحديث بياناتك\n• طلب حذف بياناتك الشخصية\n• الاعتراض على معالجة بياناتك\n• سحب موافقتك في أي وقت'
        },
        {
          title: 'تواصل معنا',
          body: 'إذا كانت لديك أي أسئلة أو استفسارات حول سياسة الخصوصية هذه، يرجى التواصل معنا:\n\nشركة اداء الابطال العالمية للرياضة\nالمملكة العربية السعودية'
        }
      ]
    },
    en: {
      title: 'Privacy Policy',
      companyName: 'Global Champions Sports Performance Company',
      lastUpdated: 'Last Updated: February 2026',
      toggleLabel: 'العربية',
      sections: [
        {
          title: 'Introduction',
          body: 'At Global Champions Sports Performance Company, we are committed to protecting the privacy of our users. This Privacy Policy explains how we collect, use, and protect your personal information when you use our application and services.'
        },
        {
          title: 'Data We Collect',
          body: 'We collect the following information:\n• Full name and contact information (phone number, email)\n• Date of birth and gender\n• Membership and subscription information\n• Attendance and training records\n• Payment and billing data\n• ID photos (during registration)\n• Usage data and app interaction data'
        },
        {
          title: 'How We Use Your Data',
          body: 'We use the information we collect for the following purposes:\n• Managing your account and membership\n• Providing sports and training services\n• Sending subscription-related notifications and alerts\n• Improving our services and user experience\n• Issuing invoices and processing payments\n• Communicating with you about updates and offers\n• Complying with legal and regulatory requirements'
        },
        {
          title: 'Data Sharing',
          body: 'We do not sell or rent your personal information to third parties. We may share your data in the following cases:\n• With service providers who help us operate the application\n• When necessary to comply with applicable laws and regulations\n• To protect our legal rights and the safety of our users\n• With your explicit consent'
        },
        {
          title: 'Data Security',
          body: 'We take appropriate security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. These measures include:\n• Data encryption during transmission and storage\n• Access control and permission management\n• Regular system monitoring\n• Regular data backups'
        },
        {
          title: 'Your Rights',
          body: 'You have the following rights regarding your personal data:\n• Access and review your personal data\n• Request correction or update of your data\n• Request deletion of your personal data\n• Object to the processing of your data\n• Withdraw your consent at any time'
        },
        {
          title: 'Contact Us',
          body: 'If you have any questions or inquiries about this Privacy Policy, please contact us:\n\nGlobal Champions Sports Performance Company\nKingdom of Saudi Arabia'
        }
      ]
    }
  };

  const c = content[language];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', direction: isAr ? 'rtl' : 'ltr' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>{c.title}</h1>
            <p style={{ fontSize: '16px', color: '#64748b', marginTop: '4px' }}>{c.companyName}</p>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>{c.lastUpdated}</p>
          </div>
          <button
            onClick={toggleLanguage}
            style={{
              padding: '8px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#475569'
            }}
          >
            {c.toggleLabel}
          </button>
        </div>

        <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          {c.sections.map((section, index) => (
            <div key={index} style={{ padding: '24px 28px', borderBottom: index < c.sections.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1e293b', marginBottom: '12px' }}>{section.title}</h2>
              <p style={{ fontSize: '15px', color: '#475569', lineHeight: '1.8', whiteSpace: 'pre-line', margin: 0 }}>{section.body}</p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: '32px', color: '#94a3b8', fontSize: '13px' }}>
          <p>© {new Date().getFullYear()} {isAr ? 'شركة اداء الابطال العالمية للرياضة' : 'Global Champions Sports Performance Company'}</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyPage;
