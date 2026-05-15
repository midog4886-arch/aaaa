import React from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { useLanguage } from '../contexts/LanguageContext';
import { LifeBuoy, Mail, MessageCircle, BookOpen, FileText, Shield } from 'lucide-react';

const SUPPORT_EMAIL = 'support@championsacademy.app';
const BILLING_EMAIL = 'billing@championsacademy.app';
const WHATSAPP_NUMBER = '+966500000000';

const SupportPage = () => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const title = isAr ? 'الدعم والمساعدة' : 'Support & Help';

  const channels = [
    {
      icon: Mail,
      title: isAr ? 'البريد الإلكتروني' : 'Email support',
      desc: isAr ? 'للأسئلة العامة والدعم الفني، نرد خلال يوم عمل واحد.' : 'For general questions and technical support, we reply within one business day.',
      action: (
        <a href={`mailto:${SUPPORT_EMAIL}`}>
          <Button data-testid="support-email-btn">{SUPPORT_EMAIL}</Button>
        </a>
      ),
    },
    {
      icon: MessageCircle,
      title: isAr ? 'واتساب' : 'WhatsApp',
      desc: isAr ? 'دعم سريع عبر واتساب من الأحد إلى الخميس، 9 صباحاً - 6 مساءً (توقيت الرياض).' : 'Quick WhatsApp support Sun-Thu, 9am-6pm (Riyadh time).',
      action: (
        <a href={`https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">
          <Button data-testid="support-whatsapp-btn">{WHATSAPP_NUMBER}</Button>
        </a>
      ),
    },
    {
      icon: FileText,
      title: isAr ? 'الفوترة والاشتراكات' : 'Billing & subscriptions',
      desc: isAr ? 'لأسئلة الفواتير، تغيير الخطة، أو طلبات الاسترجاع.' : 'For invoice questions, plan changes, or refund requests.',
      action: (
        <a href={`mailto:${BILLING_EMAIL}`}>
          <Button variant="outline" data-testid="support-billing-btn">{BILLING_EMAIL}</Button>
        </a>
      ),
    },
  ];

  const resources = [
    {
      icon: BookOpen,
      title: isAr ? 'دليل البدء السريع' : 'Quick start guide',
      desc: isAr ? 'خطوات الإعداد الأولى لأكاديميتك في أقل من 10 دقائق.' : 'First-time setup steps for your academy in under 10 minutes.',
      to: '/admin/onboarding',
      label: isAr ? 'افتح المعالج' : 'Open wizard',
    },
    {
      icon: Shield,
      title: isAr ? 'سياسة الخصوصية' : 'Privacy policy',
      desc: isAr ? 'كيف نحمي بيانات أكاديميتك وأعضائها.' : 'How we protect your academy and member data.',
      to: '/privacy',
      label: isAr ? 'اقرأ السياسة' : 'Read policy',
    },
    {
      icon: FileText,
      title: isAr ? 'شروط الاستخدام' : 'Terms of service',
      desc: isAr ? 'الشروط القانونية لاستخدام المنصة.' : 'Legal terms for using the platform.',
      to: '/terms',
      label: isAr ? 'اقرأ الشروط' : 'Read terms',
    },
    {
      icon: FileText,
      title: isAr ? 'سياسة الاسترجاع' : 'Refund policy',
      desc: isAr ? 'تفاصيل الإلغاء والاسترجاع للاشتراكات.' : 'Cancellation and refund details for subscriptions.',
      to: '/refund-policy',
      label: isAr ? 'اقرأ السياسة' : 'Read policy',
    },
  ];

  return (
    <Layout title={title}>
      <div className="space-y-6 max-w-4xl" data-testid="support-page">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LifeBuoy className="w-5 h-5 text-primary" />
              {isAr ? 'تواصل معنا' : 'Contact us'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {channels.map((ch, i) => {
              const Icon = ch.icon;
              return (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold">{ch.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{ch.desc}</p>
                  {ch.action}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              {isAr ? 'موارد ومساعدة' : 'Resources & help'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {resources.map((r, i) => {
              const Icon = r.icon;
              return (
                <div key={i} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold">{r.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{r.desc}</p>
                  <Link to={r.to}>
                    <Button variant="outline" size="sm">{r.label}</Button>
                  </Link>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default SupportPage;
