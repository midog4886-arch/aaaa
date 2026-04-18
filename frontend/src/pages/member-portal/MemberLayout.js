import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { 
  Trophy, Home, CreditCard, Calendar, Bell, QrCode,
  LogOut, Menu, X, Clock, CheckCircle, AlertTriangle,
  Moon, Sun, Star, Activity, Video, Languages, Download, Smartphone, Phone, Mail
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import axios from 'axios';
import API_URL from '../../config/api';

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

// Dark mode helper - reads from member_data (DB-synced) first, falls back to localStorage
export const getDarkMode = () => {
  try {
    const memberData = localStorage.getItem('member_data');
    if (memberData) {
      const parsed = JSON.parse(memberData);
      if (typeof parsed.dark_mode === 'boolean') return parsed.dark_mode;
    }
  } catch (_) {}
  return localStorage.getItem('portal_dark_mode') === 'true';
};
export const setDarkMode = (value) => {
  const boolValue = value === true || value === 'true';
  localStorage.setItem('portal_dark_mode', String(boolValue));
  try {
    const memberData = localStorage.getItem('member_data');
    if (memberData) {
      const parsed = JSON.parse(memberData);
      parsed.dark_mode = boolValue;
      localStorage.setItem('member_data', JSON.stringify(parsed));
    }
  } catch (_) {}
};

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
  const isNativeApp = !!(window.Capacitor?.isNativePlatform?.());
  const [member, setMember] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState({ unread_count: 0 });
  const [msgUnreadCount, setMsgUnreadCount] = useState(0);
  const [tournamentsCount, setTournamentsCount] = useState(0);
  const [darkMode, setDarkModeState] = useState(getDarkMode());
  const [language, setLanguageState] = useState(getLanguage());
  
  // PWA Install states
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [showInstallReminder, setShowInstallReminder] = useState(false);
  const installPromptRef = useRef(null);

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
      academyName: { ar: 'شركة اداء الابطال العالمية للرياضة', en: 'Global Champions Sports Academy' }
    };
    return translations[key]?.[language] || key;
  };

  useEffect(() => {
    const memberData = getMemberData();
    if (!memberData) {
      navigate('/member-login');
      return;
    }
    setMember(memberData);
    fetchNotifications();
    fetchMsgUnread();
    fetchTournamentsCount();
    
    // Update document title and manifest for member portal PWA
    document.title = language === 'ar' ? 'بوابة الأعضاء - شركة اداء الابطال العالمية للرياضة' : 'Member Portal - Champions Academy';
    
    // Update manifest link for portal
    const manifestLink = document.getElementById('pwa-manifest');
    if (manifestLink) {
      manifestLink.href = '/manifest-portal.json';
    }
    
    // Update apple-mobile-web-app-title
    let appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitleMeta) {
      appleTitleMeta.content = language === 'ar' ? 'بوابة الأعضاء' : 'Member Portal';
    }
  }, [navigate, language]);

  // PWA Install prompt handler
  useEffect(() => {
    // Check if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsAppInstalled(true);
      return;
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      installPromptRef.current = e;
      setInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPrompt(null);
      installPromptRef.current = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Handle PWA install
  const handleInstallClick = async () => {
    if (installPromptRef.current) {
      try {
        await installPromptRef.current.prompt();
        const { outcome } = await installPromptRef.current.userChoice;
        if (outcome === 'accepted') {
          setIsAppInstalled(true);
          setShowInstallReminder(false);
          localStorage.setItem('pwa_installed', 'true');
        }
        installPromptRef.current = null;
        setInstallPrompt(null);
      } catch (error) {
        console.error('Install prompt error:', error);
      }
    } else {
      // Show manual instructions dialog
      setShowInstallDialog(true);
    }
  };

  // Install reminder after visits
  useEffect(() => {
    // Skip if already installed or reminder dismissed
    if (isAppInstalled || localStorage.getItem('pwa_installed') === 'true') return;
    if (localStorage.getItem('install_reminder_dismissed') === 'true') return;
    
    // Count visits
    const visitCount = parseInt(localStorage.getItem('portal_visit_count') || '0') + 1;
    localStorage.setItem('portal_visit_count', visitCount.toString());
    
    // Show reminder after 3 visits
    if (visitCount >= 3) {
      // Delay showing the reminder
      const timer = setTimeout(() => {
        setShowInstallReminder(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isAppInstalled]);

  // Dismiss install reminder
  const dismissInstallReminder = () => {
    setShowInstallReminder(false);
    localStorage.setItem('install_reminder_dismissed', 'true');
  };

  // Handle install from reminder
  const handleInstallFromReminder = () => {
    setShowInstallReminder(false);
    handleInstallClick();
  };

  useEffect(() => {
    // Apply dark mode class to document
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = async () => {
    const newValue = !darkMode;
    setDarkModeState(newValue);
    setDarkMode(newValue);
    try {
      await memberAPI.put('/api/member-portal/preferences', { dark_mode: newValue });
    } catch (error) {
      console.error('Failed to save dark mode preference, reverting');
      setDarkModeState(darkMode);
      setDarkMode(darkMode);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/notifications');
      setNotifications(res.data);
    } catch (error) {
      console.error('Failed to fetch notifications');
    }
  };

  const fetchMsgUnread = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/member/messages/unread-count');
      setMsgUnreadCount(res.data.unread_count || 0);
    } catch (error) {
      console.error('Failed to fetch message unread count');
    }
  };

  const fetchTournamentsCount = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/my-tournaments');
      const list = Array.isArray(res.data?.tournaments) ? res.data.tournaments : [];
      setTournamentsCount(list.length);
    } catch (error) {
      setTournamentsCount(0);
    }
  };

  const handleLogout = () => {
    memberLogout();
    navigate('/member-login');
  };

  const navItems = [
    { to: '/member-dashboard', icon: Home, labelKey: 'home' },
    { to: '/videos', icon: Video, labelKey: 'dailyVideos' },
    { to: '/member-attendance', icon: Activity, labelKey: 'attendance' },
    { to: '/subscriptions', icon: CreditCard, labelKey: 'subscriptions' },
    { to: '/member-schedule', icon: Calendar, labelKey: 'schedule' },
    { to: '/loyalty-points', icon: Trophy, labelKey: 'loyalty' },
    ...(tournamentsCount > 0
      ? [{ to: '/my-tournaments', icon: Trophy, labelKey: 'tournaments' }]
      : []),
    { to: '/card', icon: QrCode, labelKey: 'memberCard' },
    { to: '/rate-coach', icon: Star, labelKey: 'rateCoaches' },
    { to: '/member-messages', icon: Mail, labelKey: 'messages', badge: msgUnreadCount },
    { to: '/notifications', icon: Bell, labelKey: 'notifications', badge: notifications.unread_count },
    { to: '/support', icon: Phone, labelKey: 'support' },
  ];

  // Extended translations
  const getText = (key) => {
    const texts = {
      home: { ar: 'الرئيسية', en: 'Home' },
      dailyVideos: { ar: 'الفيديوهات اليومية', en: 'Daily Videos' },
      attendance: { ar: 'سجل الحضور', en: 'Attendance' },
      subscriptions: { ar: 'اشتراكاتي', en: 'My Subscriptions' },
      schedule: { ar: 'جدول التدريبات', en: 'Schedule' },
      loyalty: { ar: 'نقاط الولاء', en: 'Loyalty Points' },
      tournaments: { ar: 'بطولاتي', en: 'My Tournaments' },
      memberCard: { ar: 'بطاقة العضوية', en: 'Member Card' },
      rateCoaches: { ar: 'تقييم المدربين', en: 'Rate Coaches' },
      messages: { ar: 'الرسائل', en: 'Messages' },
      notifications: { ar: 'الإشعارات', en: 'Notifications' },
      support: { ar: 'خدمة العملاء', en: 'Support' },
      memberPortal: { ar: 'بوابة الأعضاء', en: 'Member Portal' },
      academy: { ar: 'شركة اداء الابطال العالمية للرياضة', en: 'Champions Academy' },
      install: { ar: 'تثبيت', en: 'Install' },
      installApp: { ar: 'تثبيت التطبيق', en: 'Install App' },
      installDescription: { ar: 'يمكنك تثبيت التطبيق على جهازك للوصول السريع والعمل بدون إنترنت.', en: 'Install the app on your device for quick access and offline use.' },
      understood: { ar: 'فهمت', en: 'Got it' },
      computer: { ar: 'الكمبيوتر', en: 'Computer' },
      afterInstall: { ar: 'بعد التثبيت، سيظهر التطبيق على شاشتك الرئيسية!', en: 'After installation, the app will appear on your home screen!' },
      logout: { ar: 'خروج', en: 'Logout' },
      lightMode: { ar: 'الوضع الفاتح', en: 'Light Mode' },
      darkModeLabel: { ar: 'الوضع المظلم', en: 'Dark Mode' },
      // Install reminder texts
      installReminderTitle: { ar: '📲 ثبّت التطبيق الآن!', en: '📲 Install the App Now!' },
      installReminderText: { ar: 'للوصول السريع والإشعارات الفورية', en: 'For quick access and instant notifications' },
      installNow: { ar: 'تثبيت الآن', en: 'Install Now' },
      later: { ar: 'لاحقاً', en: 'Later' },
    };
    return texts[key]?.[language] || key;
  };

  if (!member) return null;

  return (
    <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-gray-900' : 'bg-stone-50'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className={`${darkMode ? 'bg-gray-800' : 'bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950'} text-white sticky top-0 z-50 shadow-lg safe-area-top`}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-full flex items-center justify-center">
                <Trophy className="w-5 h-5 text-gray-900" />
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
              {/* Install App Button - Only show if not installed and not native app */}
              {!isAppInstalled && !isNativeApp && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleInstallClick}
                  className="text-gray-300 hover:text-white hover:bg-white/10 gap-1"
                  title={getText('installApp')}
                  data-testid="install-app-btn"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs">{getText('install')}</span>
                </Button>
              )}

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
          <nav className={`lg:hidden ${darkMode ? 'bg-gray-700' : 'bg-gray-900'} border-t border-gray-800 px-4 py-3 space-y-1`}>
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

      {/* Main Content - Add padding for bottom nav */}
      <main className="max-w-7xl mx-auto px-4 py-6 pb-20 mobile-scroll">
        <div className="page-enter">
          {children}
        </div>
      </main>

      {/* Bottom Navigation for Mobile */}
      <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 ${
        darkMode 
          ? 'bg-gray-900/95 border-gray-700' 
          : 'bg-white/95 border-gray-200'
      } border-t backdrop-blur-lg safe-area-bottom`}>
        <div className="flex items-center justify-around h-14 max-w-lg mx-auto px-2">
          {[
            { to: '/', icon: Home, label: getText('home') },
            { to: '/videos', icon: Video, label: language === 'ar' ? 'الفيديوهات' : 'Videos' },
            { to: '/card', icon: QrCode, label: language === 'ar' ? 'البطاقة' : 'Card' },
            { to: '/loyalty-points', icon: Trophy, label: language === 'ar' ? 'النقاط' : 'Points' },
            { to: '/subscriptions', icon: CreditCard, label: language === 'ar' ? 'الاشتراكات' : 'Subs' },
            { to: '/notifications', icon: Bell, label: getText('notifications'), badge: notifications.unread_count },
          ].map((item) => {
            const isActive = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="relative flex flex-col items-center justify-center flex-1 h-full tap-highlight"
              >
                <div className="relative flex flex-col items-center">
                  {isActive && (
                    <div className="absolute -top-1 w-12 h-1 bg-gradient-to-r from-amber-500 to-yellow-500 rounded-full" />
                  )}
                  <div className={`relative p-2 rounded-xl transition-colors ${
                    isActive 
                      ? 'text-amber-600' 
                      : darkMode ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5]' : ''}`} />
                    {item.badge > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] mt-0.5 font-medium ${
                    isActive 
                      ? 'text-amber-600' 
                      : darkMode ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer - Hidden on mobile due to bottom nav */}
      <footer className={`hidden lg:block border-t py-4 mt-auto ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
        <div className={`max-w-7xl mx-auto px-4 text-center text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          <p>{language === 'ar' ? 'شركة اداء الابطال العالمية للرياضة' : 'Global Champions Sports Academy'} © {new Date().getFullYear()}</p>
        </div>
      </footer>

      {/* Install Reminder Popup */}
      {showInstallReminder && !isAppInstalled && !isNativeApp && (
        <div 
          className="fixed bottom-20 left-4 right-4 lg:bottom-6 lg:left-auto lg:right-6 lg:w-96 z-50 animate-in slide-in-from-bottom-5 duration-500"
          dir={language === 'ar' ? 'rtl' : 'ltr'}
        >
          <div className={`rounded-2xl shadow-2xl border overflow-hidden ${
            darkMode 
              ? 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700' 
              : 'bg-gradient-to-br from-white to-blue-50 border-blue-200'
          }`}>
            {/* Decorative top bar */}
            <div className="h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
            
            <div className="p-4">
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                  <Download className="w-6 h-6 text-white" />
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className={`font-bold text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {getText('installReminderTitle')}
                  </h3>
                  <p className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {getText('installReminderText')}
                  </p>
                </div>
                
                {/* Close button */}
                <button 
                  onClick={dismissInstallReminder}
                  className={`flex-shrink-0 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
                >
                  <X className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                </button>
              </div>
              
              {/* Buttons */}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleInstallFromReminder}
                  className="flex-1 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white gap-2"
                  data-testid="install-reminder-btn"
                >
                  <Download className="w-4 h-4" />
                  {getText('installNow')}
                </Button>
                <Button
                  variant="outline"
                  onClick={dismissInstallReminder}
                  className={`${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : ''}`}
                >
                  {getText('later')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Install Instructions Dialog */}
      <Dialog open={showInstallDialog && !isNativeApp} onOpenChange={setShowInstallDialog}>
        <DialogContent className={`max-w-md ${darkMode ? 'bg-gray-800 text-white' : ''}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Smartphone className="w-6 h-6 text-blue-500" />
              {getText('installApp')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              {getText('installDescription')}
            </p>
            
            {/* iOS Instructions */}
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
              <h4 className="font-bold mb-2 flex items-center gap-2">
                <span className="text-2xl">📱</span>
                iPhone / iPad
              </h4>
              
              {/* Safari Instructions */}
              <div className={`mb-3 p-2 rounded-lg ${darkMode ? 'bg-gray-600' : 'bg-blue-100'}`}>
                <p className="font-semibold text-sm mb-1">Safari:</p>
                <ol className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
                  <li>1. {language === 'ar' ? 'اضغط على أيقونة المشاركة في الشريط السفلي' : 'Tap share icon in bottom bar'} <span className="inline-block px-2 py-0.5 bg-white dark:bg-gray-500 rounded text-xs">⬆️</span></li>
                  <li>2. {language === 'ar' ? 'مرر للأسفل واختر "إضافة للشاشة الرئيسية"' : 'Scroll down, tap "Add to Home Screen"'}</li>
                </ol>
              </div>
              
              {/* Chrome/Other browsers Instructions */}
              <div className={`p-2 rounded-lg ${darkMode ? 'bg-gray-600' : 'bg-blue-100'}`}>
                <p className="font-semibold text-sm mb-1">Chrome / {language === 'ar' ? 'متصفحات أخرى' : 'Other browsers'}:</p>
                <ol className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
                  <li>1. {language === 'ar' ? 'اضغط على الثلاث نقاط أعلى الشاشة' : 'Tap three dots at top'} <span className="inline-block px-2 py-0.5 bg-white dark:bg-gray-500 rounded text-xs">•••</span></li>
                  <li>2. {language === 'ar' ? 'اختر "إضافة إلى الشاشة الرئيسية"' : 'Select "Add to Home Screen"'}</li>
                </ol>
              </div>
              
              <p className={`text-xs mt-2 ${darkMode ? 'text-yellow-400' : 'text-amber-600'}`}>
                💡 {language === 'ar' ? 'للأفضل: استخدم Safari للتثبيت' : 'Best: Use Safari for installation'}
              </p>
            </div>
            
            {/* Android Instructions */}
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-700' : 'bg-green-50'}`}>
              <h4 className="font-bold mb-2 flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                Android
              </h4>
              <ol className={`text-sm space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
                <li>1. {language === 'ar' ? 'اضغط على قائمة المتصفح' : 'Tap browser menu'} <span className="inline-block px-2 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs">⋮</span></li>
                <li>2. {language === 'ar' ? 'اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"' : 'Select "Install app" or "Add to Home screen"'}</li>
                <li>3. {language === 'ar' ? 'اضغط "تثبيت"' : 'Tap "Install"'}</li>
              </ol>
            </div>

            {/* Desktop Instructions */}
            <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-700' : 'bg-purple-50'}`}>
              <h4 className="font-bold mb-2 flex items-center gap-2">
                <span className="text-2xl">💻</span>
                {getText('computer')}
              </h4>
              <ol className={`text-sm space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
                <li>1. {language === 'ar' ? 'ابحث عن أيقونة التثبيت في شريط العنوان' : 'Look for install icon in address bar'} <span className="inline-block px-2 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs">⊕</span></li>
                <li>2. {language === 'ar' ? 'أو اضغط على قائمة المتصفح واختر "تثبيت"' : 'Or click browser menu and select "Install"'}</li>
              </ol>
            </div>
            
            <p className={`text-center text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              ✨ {getText('afterInstall')}
            </p>
          </div>
          
          <Button 
            onClick={() => setShowInstallDialog(false)}
            className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600"
          >
            {getText('understood')}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MemberLayout;
