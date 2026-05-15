import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getSubscriptionInfo } from '../services/branding';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { XCircle, LogOut, Mail } from 'lucide-react';

export default function ExpiredTenantGuard({ children }) {
  const { isAuthenticated, isAdmin, logout } = useAuth();
  const { language } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [info, setInfo] = useState(getSubscriptionInfo());

  useEffect(() => {
    const refresh = () => setInfo(getSubscriptionInfo());
    window.addEventListener('branding:updated', refresh);
    const id = setInterval(refresh, 60 * 1000);
    return () => { window.removeEventListener('branding:updated', refresh); clearInterval(id); };
  }, []);

  const isAr = language === 'ar';
  const blocking = isAuthenticated && isAdmin
    && (info.state === 'expired' || info.state === 'suspended')
    && location.pathname.startsWith('/admin')
    && !location.pathname.startsWith('/admin/settings');

  if (!blocking) return children;

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4" dir={isAr ? 'rtl' : 'ltr'}>
      <Card className="max-w-lg w-full shadow-xl">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mx-auto flex items-center justify-center mb-5">
            <XCircle className="w-9 h-9 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold mb-3">
            {info.state === 'suspended'
              ? (isAr ? 'تم تعليق اشتراك أكاديميتك' : 'Your academy subscription is suspended')
              : (isAr ? 'انتهت فترة اشتراكك' : 'Your subscription has expired')}
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            {isAr
              ? 'لاستعادة الوصول الكامل للوحة التحكم، تواصل معنا لتجديد الاشتراك أو ترقية خطتك.'
              : 'To regain full access to your dashboard, contact us to renew or upgrade your plan.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <a href="mailto:sales@championsacademy.app?subject=Renew%20subscription" className="inline-block">
              <Button size="lg" className="w-full sm:w-auto">
                <Mail className="w-4 h-4 me-2" />
                {isAr ? 'تواصل لتجديد الاشتراك' : 'Contact to renew'}
              </Button>
            </a>
            <Button variant="outline" size="lg" onClick={() => navigate('/admin/settings')}>
              {isAr ? 'تفاصيل الاشتراك' : 'Subscription details'}
            </Button>
            <Button variant="ghost" size="lg" onClick={handleLogout}>
              <LogOut className="w-4 h-4 me-2" />
              {isAr ? 'خروج' : 'Logout'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
