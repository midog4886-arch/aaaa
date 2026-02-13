import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { 
  Trophy, Home, CreditCard, Calendar, FileText, QrCode, Bell, 
  LogOut, Menu, X, User, Clock, CheckCircle, AlertTriangle,
  ChevronLeft, ClipboardList, Moon, Sun, Star, Activity, Video,
  Download, Smartphone, Share, MoreVertical, Languages
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

// Language helper
export const getLanguage = () => localStorage.getItem('member_language') || 'ar';
export const setLanguage = (lang) => localStorage.setItem('member_language', lang);

// Auth helper
export const getMemberToken = () => localStorage.getItem('member_token');
export const getMemberData = () => {
  const data = localStorage.getItem('member_data');
  return data ? JSON.parse(data) : null;
};
export const memberLogout = () => {
  localStorage.removeItem('member_token');
  localStorage.removeItem('member_data');
};

// Dark mode helper
export const getDarkMode = () => localStorage.getItem('portal_dark_mode') === 'true';
export const setDarkMode = (value) => localStorage.setItem('portal_dark_mode', value);

// Axios instance with auth
export const memberAPI = axios.create({
  baseURL: API_URL
});

memberAPI.interceptors.request.use((config) => {
  const token = getMemberToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const MemberLayout = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [member, setMember] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState({ unread_count: 0 });
  const [darkMode, setDarkModeState] = useState(getDarkMode());
  const [language, setLanguageState] = useState(getLanguage());
  
  // PWA Install prompt
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  // Detect device type for install instructions
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  // Toggle language
  const toggleLanguage = () => {
    const newLang = language === 'ar' ? 'en' : 'ar';
    setLanguageState(newLang);
    setLanguage(newLang);
  };

  // Translations
  const t = (key) => {
    const translations = {
      home: { ar: 'الرئيسية', en: 'Home' },
      dailyVideos: { ar: 'الفيديوهات اليومية', en: 'Daily Videos' },
      attendance: { ar: 'سجل الحضور', en: 'Attendance' },
      memberCard: { ar: 'بطاقة العضوية', en: 'Member Card' },
      rateCoaches: { ar: 'تقييم المدربين', en: 'Rate Coaches' },
      notifications: { ar: 'الإشعارات', en: 'Notifications' },
      install: { ar: 'تثبيت', en: 'Install' },
      logout: { ar: 'تسجيل خروج', en: 'Logout' },
      lightMode: { ar: 'الوضع الفاتح', en: 'Light Mode' },
      darkModeLabel: { ar: 'الوضع المظلم', en: 'Dark Mode' },
      installApp: { ar: 'تثبيت التطبيق', en: 'Install App' },
      installDescription: { ar: 'يمكنك تثبيت التطبيق على جهازك للوصول السريع والعمل بدون إنترنت.', en: 'You can install the app on your device for quick access and offline use.' },
      understood: { ar: 'فهمت', en: 'Got it' },
      computer: { ar: 'الكمبيوتر', en: 'Computer' },
      afterInstall: { ar: 'بعد التثبيت، سيظهر التطبيق على شاشتك الرئيسية ويمكنك فتحه مباشرة!', en: 'After installation, the app will appear on your home screen!' },
      allRights: { ar: 'جميع الحقوق محفوظة', en: 'All rights reserved' },
      academyName: { ar: 'أكاديمية أداء الأبطال العالمية', en: 'Global Champions Sports Academy' }
    };
    return translations[key]?.[language] || key;
  };

  useEffect(() => {
    const memberData = getMemberData();
    if (!memberData) {
      navigate('/portal/login');
      return;
    }
    setMember(memberData);
    fetchNotifications();

    // PWA Install prompt handler
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShowInstallButton(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [navigate]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setShowInstallButton(false);
    }
    setDeferredPrompt(null);
  };

  useEffect(() => {
    // Apply dark mode class to document
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = () => {
    const newValue = !darkMode;
    setDarkModeState(newValue);
    setDarkMode(newValue.toString());
  };

  const fetchNotifications = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/notifications');
      setNotifications(res.data);
    } catch (error) {
      console.error('Failed to fetch notifications');
    }
  };

  const handleLogout = () => {
    memberLogout();
    navigate('/portal/login');
  };

  const navItems = [
    { to: '/portal/dashboard', icon: Home, labelKey: 'home' },
    { to: '/portal/daily-videos', icon: Video, labelKey: 'dailyVideos' },
    { to: '/portal/attendance', icon: Activity, labelKey: 'attendance' },
    { to: '/portal/subscriptions', icon: CreditCard, labelKey: 'subscriptions' },
    { to: '/portal/schedule', icon: Calendar, labelKey: 'schedule' },
    { to: '/portal/card', icon: QrCode, labelKey: 'memberCard' },
    { to: '/portal/rate-coach', icon: Star, labelKey: 'rateCoaches' },
    { to: '/portal/notifications', icon: Bell, labelKey: 'notifications', badge: notifications.unread_count },
  ];

  // Extended translations
  const getText = (key) => {
    const texts = {
      home: { ar: 'الرئيسية', en: 'Home' },
      dailyVideos: { ar: 'الفيديوهات اليومية', en: 'Daily Videos' },
      attendance: { ar: 'سجل الحضور', en: 'Attendance' },
      subscriptions: { ar: 'اشتراكاتي', en: 'My Subscriptions' },
      schedule: { ar: 'جدول التدريبات', en: 'Schedule' },
      memberCard: { ar: 'بطاقة العضوية', en: 'Member Card' },
      rateCoaches: { ar: 'تقييم المدربين', en: 'Rate Coaches' },
      notifications: { ar: 'الإشعارات', en: 'Notifications' },
      memberPortal: { ar: 'بوابة الأعضاء', en: 'Member Portal' },
      academy: { ar: 'أكاديمية أداء الأبطال', en: 'Champions Academy' },
      ...Object.fromEntries(Object.entries({
        install: { ar: 'تثبيت', en: 'Install' },
        logout: { ar: 'خروج', en: 'Logout' },
        lightMode: { ar: 'الوضع الفاتح', en: 'Light Mode' },
        darkModeLabel: { ar: 'الوضع المظلم', en: 'Dark Mode' },
      }).map(([k, v]) => [k, v]))
    };
    return texts[key]?.[language] || key;
  };

  if (!member) return null;

  return (
    <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className={`${darkMode ? 'bg-gray-800' : 'bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900'} text-white sticky top-0 z-50 shadow-lg`}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-500 rounded-full flex items-center justify-center">
                <Trophy className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <p className="font-bold">{getText('memberPortal')}</p>
                <p className="text-xs text-gray-300">{getText('academy')}</p>
              </div>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                    location.pathname === item.to 
                      ? 'bg-white/20 text-white' 
                      : 'text-gray-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="text-sm">{getText(item.labelKey)}</span>
                  {item.badge > 0 && (
                    <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </nav>

            {/* User Menu */}
            <div className="flex items-center gap-2">
              {/* Language Toggle */}
              <Button 
                variant="ghost" 
                size="sm"
                onClick={toggleLanguage}
                className="text-gray-300 hover:text-white hover:bg-white/10 font-bold"
                title={language === 'ar' ? 'English' : 'العربية'}
              >
                <Languages className="w-4 h-4 me-1" />
                <span className="text-xs">{language === 'ar' ? 'EN' : 'ع'}</span>
              </Button>

              {/* PWA Install Button - Always visible */}
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  if (deferredPrompt) {
                    handleInstallClick();
                  } else {
                    setShowInstallGuide(true);
                  }
                }}
                className="bg-green-500 text-white hover:bg-green-600"
                title={language === 'ar' ? 'تثبيت التطبيق' : 'Install App'}
              >
                <Download className="w-4 h-4 me-1" />
                <span className="hidden sm:inline">{getText('install')}</span>
              </Button>

              {/* Dark Mode Toggle */}
              <Button 
                variant="ghost" 
                size="icon"
                onClick={toggleDarkMode}
                className="text-gray-300 hover:text-white hover:bg-white/10"
                title={darkMode ? getText('lightMode') : getText('darkModeLabel')}
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </Button>
              
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium">{member.name_ar}</p>
                <p className="text-xs text-gray-300">#{member.member_code}</p>
              </div>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleLogout}
                className="text-gray-300 hover:text-white hover:bg-white/10"
              >
                <LogOut className="w-5 h-5" />
              </Button>
              
              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-gray-300"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className={`lg:hidden ${darkMode ? 'bg-gray-700' : 'bg-slate-800'} border-t border-slate-700 px-4 py-3 space-y-1`}>
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-4 py-3 rounded-lg ${
                  location.pathname === item.to 
                    ? 'bg-white/20 text-white' 
                    : 'text-gray-300 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="w-5 h-5" />
                  <span>{getText(item.labelKey)}</span>
                </div>
                {item.badge > 0 && (
                  <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className={`border-t py-4 mt-auto ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
        <div className={`max-w-7xl mx-auto px-4 text-center text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <p>أكاديمية أداء الأبطال العالمية © {new Date().getFullYear()}</p>
        </div>
      </footer>

      {/* Install Guide Dialog */}
      <Dialog open={showInstallGuide} onOpenChange={setShowInstallGuide}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Smartphone className="w-6 h-6 text-green-600" />
              تثبيت التطبيق
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <p className="text-gray-600">
              يمكنك تثبيت التطبيق على جهازك للوصول السريع والعمل بدون إنترنت.
            </p>

            {isIOS && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <h4 className="font-bold text-gray-900 flex items-center gap-2">
                  <span className="text-2xl">🍎</span> iPhone / iPad
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span>اضغط على زر المشاركة</span>
                    <Share className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  </li>
                  <li>مرر للأسفل واضغط على <strong>"إضافة إلى الشاشة الرئيسية"</strong></li>
                  <li>اضغط على <strong>"إضافة"</strong> في الأعلى</li>
                </ol>
              </div>
            )}

            {isAndroid && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <h4 className="font-bold text-gray-900 flex items-center gap-2">
                  <span className="text-2xl">🤖</span> Android
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span>اضغط على قائمة المتصفح</span>
                    <MoreVertical className="w-5 h-5 text-gray-500 flex-shrink-0" />
                  </li>
                  <li>اضغط على <strong>"تثبيت التطبيق"</strong> أو <strong>"إضافة إلى الشاشة الرئيسية"</strong></li>
                  <li>اضغط على <strong>"تثبيت"</strong></li>
                </ol>
              </div>
            )}

            {!isIOS && !isAndroid && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <h4 className="font-bold text-gray-900 flex items-center gap-2">
                  <span className="text-2xl">💻</span> الكمبيوتر
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                  <li>ابحث عن أيقونة التثبيت <Download className="w-4 h-4 inline" /> في شريط العنوان</li>
                  <li>أو اضغط على قائمة المتصفح <MoreVertical className="w-4 h-4 inline" /></li>
                  <li>اختر <strong>"تثبيت التطبيق"</strong></li>
                </ol>
              </div>
            )}

            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="text-sm text-green-700">
                ✅ بعد التثبيت، سيظهر التطبيق على شاشتك الرئيسية ويمكنك فتحه مباشرة!
              </p>
            </div>
          </div>

          <Button 
            onClick={() => setShowInstallGuide(false)}
            className="w-full"
          >
            فهمت
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MemberLayout;
