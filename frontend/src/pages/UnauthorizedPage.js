import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { ShieldX, ArrowRight, LogOut } from 'lucide-react';

export default function UnauthorizedPage() {
  const { language } = useLanguage();
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  
  const t = (ar, en) => language === 'ar' ? ar : en;

  // Get first allowed route based on user permissions
  const getFirstAllowedRoute = () => {
    const permissions = user?.permissions || [];
    const routeOrder = ['schedule', 'attendance', 'dashboard', 'members', 'activities', 'levels', 'invoices', 'store', 'accounting', 'reports', 'messages', 'settings'];
    for (const route of routeOrder) {
      if (permissions.includes(route)) {
        return `/${route}`;
      }
    }
    return '/schedule';
  };

  const handleGoToAllowed = () => {
    if (isAdmin) {
      navigate('/dashboard');
    } else {
      navigate(getFirstAllowedRoute());
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {/* Icon */}
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <ShieldX className="w-10 h-10 text-red-500" />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          {t('غير مصرح بالدخول', 'Access Denied')}
        </h1>

        {/* Message */}
        <p className="text-gray-600 mb-6">
          {t(
            'عذراً، ليس لديك صلاحية للوصول إلى هذه الصفحة. يرجى التواصل مع مدير النظام إذا كنت تعتقد أن هذا خطأ.',
            "Sorry, you don't have permission to access this page. Please contact the administrator if you believe this is an error."
          )}
        </p>

        {/* User Info */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-500 mb-1">
            {t('مسجل الدخول كـ:', 'Logged in as:')}
          </p>
          <p className="font-semibold text-gray-800">{user?.name || user?.username}</p>
          {user?.permissions && user.permissions.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">
                {t('صلاحياتك:', 'Your permissions:')}
              </p>
              <div className="flex flex-wrap gap-1 justify-center">
                {user.permissions.map(perm => (
                  <span key={perm} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    {perm}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button 
            onClick={handleGoToAllowed} 
            className="w-full gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            {t('الذهاب للصفحة الرئيسية', 'Go to Home Page')}
          </Button>
          
          <Button 
            variant="outline" 
            onClick={handleLogout}
            className="w-full gap-2 text-red-600 border-red-200 hover:bg-red-50"
          >
            <LogOut className="w-4 h-4" />
            {t('تسجيل الخروج', 'Logout')}
          </Button>
        </div>
      </div>
    </div>
  );
}
