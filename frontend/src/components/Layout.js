import { getAcademyLogoUrl, getAcademyName } from '../services/branding';
import SubscriptionBanner from './SubscriptionBanner';
import OnboardingGuard from './OnboardingGuard';
import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { branchesAPI, notificationsAPI, levelsAPI } from '../services/api';
import GlobalScanner from './GlobalScanner';
import CameraQRScanner from './CameraQRScanner';
import GlobalSearch from './GlobalSearch';
import { 
  LayoutDashboard, 
  Users, 
  Dumbbell, 
  Layers, 
  Receipt, 
  BarChart3, 
  MessageSquare, 
  Settings,
  LogOut,
  Menu,
  X,
  Languages,
  Trophy,
  Building2,
  Package,
  GitBranch,
  Calculator,
  Bell,
  RefreshCcw,
  HardDrive,
  CheckCheck,
  Clock,
  AlertTriangle,
  ClipboardList,
  CalendarDays,
  QrCode,
  Star,
  Megaphone,
  Video,
  ExternalLink,
  Download,
  Smartphone,
  Camera,
  ChevronDown,
  Wallet,
  Radio,
  ShieldCheck,
  BookOpen,
  CalendarOff,
  MessageCircle,
  UserCog
} from 'lucide-react';

export const Sidebar = ({ isOpen, onClose }) => {
  const { t, language, toggleLanguage } = useLanguage();
  const { logout, user, selectedBranchId, switchBranch } = useAuth();
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [unassignedCount, setUnassignedCount] = useState(0);

  const isAdmin = user?.is_admin;
  const userPermissions = user?.permissions || [];

  useEffect(() => {
    if (isAdmin) {
      loadBranches();
    }
  }, [isAdmin]);

  useEffect(() => {
    const canSeeLevels = isAdmin || (user?.permissions || []).includes('levels');
    if (!canSeeLevels) return;
    const loadCount = async () => {
      try {
        const params = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
        const res = await levelsAPI.getUnassignedCount(params);
        setUnassignedCount(res.data?.count || 0);
      } catch (e) {
        // silent
      }
    };
    loadCount();
    const id = setInterval(loadCount, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(id);
  }, [isAdmin, user?.permissions, selectedBranchId]);

  const loadBranches = async () => {
    try {
      const res = await branchesAPI.getAll();
      setBranches(res.data || []);
    } catch (error) {
      console.error('Failed to load branches:', error);
    }
  };

  const location = useLocation();
  const [openGroups, setOpenGroups] = useState({});

  const navGroups = [
    {
      id: 'main',
      label_ar: 'الرئيسية',
      label_en: 'Main',
      icon: LayoutDashboard,
      single: true,
      items: [
        { to: '/admin/dashboard', icon: LayoutDashboard, label: 'dashboard', permission: 'dashboard' },
      ]
    },
    {
      id: 'invoices_quick',
      label_ar: 'الفواتير',
      label_en: 'Invoices',
      icon: Receipt,
      single: true,
      items: [
        { to: '/admin/invoices', icon: Receipt, label: 'invoices', permission: 'invoices' },
      ]
    },
    {
      id: 'members',
      label_ar: 'الأعضاء',
      label_en: 'Members',
      icon: Users,
      items: [
        { to: '/admin/members', icon: Users, label: 'members', permission: 'members' },
        { to: '/admin/renewals', icon: RefreshCcw, label: 'renewals', permission: 'renewals' },
        { to: '/admin/member-card', icon: QrCode, label: 'member_card', permission: 'member-card' },
        { to: '/admin/attendance', icon: ClipboardList, label: 'attendance', permission: 'attendance' },
        { to: '/admin/today-attendance', icon: CheckCheck, label: 'today_attendance', permission: 'attendance' },
      ]
    },
    {
      id: 'activities',
      label_ar: 'الأنشطة والتدريب',
      label_en: 'Activities & Training',
      icon: Dumbbell,
      items: [
        { to: '/admin/activities', icon: Dumbbell, label: 'activities', permission: 'activities' },
        { to: '/admin/levels', icon: Layers, label: 'levels', permission: 'levels' },
        { to: '/admin/schedule', icon: CalendarDays, label: 'schedule', permission: 'schedule' },
        { to: '/admin/coach-ratings', icon: Star, label: 'coach_ratings', permission: 'coach-ratings' },
        { to: '/admin/coach-attendance', icon: Clock, label: 'coach_attendance', permission: 'coach-attendance' },
        { to: '/admin/supervisors', icon: UserCog, label: 'supervisors', permission: 'coaches' },
        { to: '/admin/tournaments', icon: Trophy, label: 'tournaments', permission: 'tournaments' },
      ]
    },
    {
      id: 'finance',
      label_ar: 'المالية',
      label_en: 'Finance',
      icon: Wallet,
      items: [
        { to: '/admin/invoices', icon: Receipt, label: 'invoices', permission: 'invoices' },
        { to: '/admin/daily-ledger', icon: BookOpen, label: 'daily_ledger', permission: 'daily-ledger' },
        { to: '/admin/day-extensions', icon: CalendarOff, label: 'day_extensions', permission: 'day-extensions' },
        { to: '/admin/accounting', icon: Calculator, label: 'accounting', permission: 'accounting' },
        { to: '/admin/coach-salaries', icon: Wallet, label: 'coach_salaries', permission: 'salaries' },
        { to: '/admin/store', icon: Package, label: 'store', permission: 'store' },
      ]
    },
    {
      id: 'communication',
      label_ar: 'التواصل',
      label_en: 'Communication',
      icon: Radio,
      items: [
        { to: '/admin/whatsapp', icon: MessageCircle, label: 'messages', permission: 'messages' },
        { to: '/admin/whatsapp-bulk', icon: MessageCircle, label: 'whatsapp_bulk', permission: 'messages' },
        { to: '/admin/advertisements', icon: Megaphone, label: 'advertisements', permission: 'advertisements' },
        { to: '/admin/daily-videos', icon: Video, label: 'daily_videos', permission: 'daily-videos' },
        { to: '/admin/social-publisher', icon: Radio, label: 'social_publisher', permission: 'social-publisher' },
      ]
    },
    {
      id: 'extras',
      label_ar: 'المزيد',
      label_en: 'More',
      icon: Trophy,
      items: [
        { to: '/admin/loyalty', icon: Trophy, label: 'loyalty', permission: 'loyalty' },
        { to: '/admin/reports', icon: BarChart3, label: 'reports', permission: 'reports' },
      ]
    },
    {
      id: 'admin',
      label_ar: 'الإدارة',
      label_en: 'Administration',
      icon: ShieldCheck,
      items: [
        { to: '/admin/settings', icon: Settings, label: 'settings', permission: 'settings' },
        ...(isAdmin ? [{ to: '/admin/branches', icon: Building2, label: 'branches', permission: 'branches' }] : []),
        ...(isAdmin ? [{ to: '/admin/users', icon: Users, label: 'users', permission: 'users' }] : []),
        ...(isAdmin ? [{ to: '/admin/backup', icon: HardDrive, label: 'backup', permission: 'backup' }] : []),
        ...(isAdmin ? [{ to: '/admin/audit', icon: ShieldCheck, label: 'audit_log', permission: 'settings' }] : []),
        ...(isAdmin ? [{ to: '/admin/ops-alerts', icon: AlertTriangle, label: 'ops_alerts', permission: 'settings' }] : []),
        ...(isAdmin ? [{ to: '/admin/support', icon: MessageSquare, label: 'support', permission: 'settings' }] : []),
      ]
    },
  ];

  const filteredGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => isAdmin || userPermissions.includes(item.permission))
  })).filter(group => group.items.length > 0);

  useEffect(() => {
    const currentPath = location.pathname;
    const activeGroup = filteredGroups.find(g => g.items.some(item => currentPath.startsWith(item.to)));
    if (activeGroup && !activeGroup.single) {
      setOpenGroups(prev => ({ ...prev, [activeGroup.id]: true }));
    }
  }, [location.pathname]);

  const toggleGroup = (groupId) => {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const [brandingLogo, setBrandingLogo] = useState(getAcademyLogoUrl());
  const [brandingName, setBrandingName] = useState(getAcademyName());
  useEffect(() => {
    const h = () => {
      setBrandingLogo(getAcademyLogoUrl());
      setBrandingName(getAcademyName());
    };
    window.addEventListener('branding:updated', h);
    return () => window.removeEventListener('branding:updated', h);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center overflow-hidden">
              {brandingLogo ? (
                <img src={brandingLogo} alt="logo" className="w-full h-full object-contain" />
              ) : (
                <Trophy className="w-6 h-6 text-primary-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xs font-bold leading-tight line-clamp-2 break-words" data-testid="header-academy-name">
                {brandingName || t('academy_name_short')}
              </h1>
            </div>
          </div>
          <button 
            className="lg:hidden p-2 hover:bg-accent rounded-md"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {filteredGroups.map((group) => {
            if (group.single) {
              const item = group.items[0];
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={onClose}
                >
                  <item.icon className="nav-item-icon" />
                  <span>{t(item.label)}</span>
                </NavLink>
              );
            }

            const isOpen = openGroups[group.id] || false;
            const hasActiveChild = group.items.some(item => location.pathname.startsWith(item.to));

            return (
              <div key={group.id} className="nav-group">
                <button
                  className={`nav-group-header ${hasActiveChild ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(group.id)}
                >
                  <group.icon className="nav-item-icon" />
                  <span className="flex-1 text-start">{language === 'ar' ? group.label_ar : group.label_en}</span>
                  <ChevronDown className={`nav-group-chevron ${isOpen ? 'rotated' : ''}`} />
                </button>
                <div
                  className="nav-group-content"
                  style={{
                    maxHeight: isOpen ? `${(group.items.length * 44) + 8}px` : '0px',
                  }}
                >
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `nav-item nav-item-child ${isActive ? 'active' : ''}`}
                      onClick={onClose}
                    >
                      <item.icon className="nav-item-icon" />
                      <span className="flex-1">{t(item.label)}</span>
                      {item.to === '/admin/levels' && unassignedCount > 0 && (
                        <span
                          className="ms-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold"
                          title={language === 'ar' ? 'أعضاء بدون مستوى' : 'Members without level'}
                          data-testid="sidebar-unassigned-badge"
                        >
                          {unassignedCount > 99 ? '99+' : unassignedCount}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Branch Selector for Admin */}
        {isAdmin && branches.length > 0 && (
          <div className="px-3 py-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <GitBranch className="w-4 h-4" />
              <span>{language === 'ar' ? 'التنقل بين الفروع' : 'Switch Branch'}</span>
            </div>
            <Select value={selectedBranchId} onValueChange={switchBranch}>
              <SelectTrigger className="w-full h-9 text-sm" data-testid="branch-selector">
                <SelectValue placeholder={language === 'ar' ? 'اختر الفرع' : 'Select Branch'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="font-medium">{language === 'ar' ? '🏢 جميع الفروع' : '🏢 All Branches'}</span>
                </SelectItem>
                {branches.map(branch => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name_ar || branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Footer */}
        <div className="sidebar-footer space-y-3">

          {user && (
            <div className="flex items-center gap-3 p-2 bg-muted rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">
                  {user.name?.charAt(0) || 'A'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.username}</p>
              </div>
            </div>
          )}
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={toggleLanguage}
            >
              <Languages className="w-4 h-4 me-2" />
              {language === 'ar' ? 'EN' : 'AR'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-destructive hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 me-2" />
              {t('logout')}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};

export const TopHeader = ({ onMenuClick, title }) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [checkingRenewals, setCheckingRenewals] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  const isAdmin = user?.is_admin;
  const isDailyLedger = location.pathname === '/admin/daily-ledger';

  useEffect(() => {
    loadNotifications();
    // Refresh every 5 minutes
    const interval = setInterval(loadNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const loadNotifications = async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        notificationsAPI.getAll({ limit: 20 }),
        notificationsAPI.getUnreadCount()
      ]);
      setNotifications(notifRes.data || []);
      setUnreadCount(countRes.data?.count || 0);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  const handleCheckRenewals = async () => {
    setCheckingRenewals(true);
    try {
      const res = await notificationsAPI.checkRenewals();
      await loadNotifications();
      if (res.data?.count > 0) {
        alert(`تم إنشاء ${res.data.count} إشعار جديد`);
      } else {
        alert('لا توجد اشتراكات تحتاج تنبيه حالياً');
      }
    } catch (error) {
      console.error('Failed to check renewals:', error);
      alert('حدث خطأ');
    } finally {
      setCheckingRenewals(false);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      await notificationsAPI.markAsRead(notificationId);
      await loadNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsAPI.markAllAsRead();
      await loadNotifications();
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const handleNotificationClick = (notification) => {
    handleMarkAsRead(notification.id);
    if (notification.action_url) {
      navigate(notification.action_url);
    }
    setShowNotifications(false);
  };

  const getNotificationIcon = (type, daysRemaining) => {
    if (daysRemaining === 0) return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (daysRemaining === 1) return <AlertTriangle className="w-4 h-4 text-orange-500" />;
    return <Clock className="w-4 h-4 text-yellow-500" />;
  };

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallButton, setShowInstallButton] = useState(true);
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShowInstallButton(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowInstallButton(false);
      }
      setDeferredPrompt(null);
    } else {
      setShowInstallGuide(true);
    }
  };

  return (
    <>
    <header className="top-header">
      <div className="flex items-center gap-3 flex-1">
        <button 
          className="lg:hidden p-2 hover:bg-accent rounded-md"
          onClick={onMenuClick}
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold hidden sm:block whitespace-nowrap">{title || t('dashboard')}</h2>
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2">
        {showInstallButton && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleInstallClick}
            className="bg-gradient-to-r from-green-500 to-green-600 text-white border-0 hover:from-green-600 hover:to-green-700"
            title={language === 'ar' ? 'تثبيت لوحة التحكم' : 'Install Dashboard'}
          >
            <Download className="w-4 h-4 me-1" />
            <span className="hidden sm:inline">{language === 'ar' ? 'تثبيت لوحة التحكم' : 'Install Dashboard'}</span>
          </Button>
        )}


        {/* Camera QR Scanner Button */}
        {!isDailyLedger && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCameraScanner(true)}
            title={language === 'ar' ? 'مسح QR بالكاميرا' : 'Camera QR Scanner'}
            className="bg-blue-500 text-white border-0 hover:bg-blue-600"
          >
            <Camera className="w-4 h-4" />
          </Button>
        )}

        {/* Check Renewals Button (Admin only) */}
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckRenewals}
            disabled={checkingRenewals}
            title={language === 'ar' ? 'فحص الاشتراكات' : 'Check Renewals'}
          >
            <RefreshCcw className={`w-4 h-4 ${checkingRenewals ? 'animate-spin' : ''}`} />
          </Button>
        )}

        {/* Notifications Bell */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute left-0 top-full mt-2 w-96 max-h-[70vh] bg-white rounded-lg shadow-xl border overflow-hidden z-50" style={{ right: 'auto', left: language === 'ar' ? 'auto' : '0', [language === 'ar' ? 'left' : 'right']: '0' }}>
              <div className="p-3 border-b bg-gray-50 flex justify-between items-center">
                <h3 className="font-bold flex items-center gap-2">
                  <Bell className="w-4 h-4" />
                  {language === 'ar' ? 'الإشعارات' : 'Notifications'}
                </h3>
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleMarkAllAsRead}>
                    <CheckCheck className="w-4 h-4 me-1" />
                    {language === 'ar' ? 'قراءة الكل' : 'Mark all read'}
                  </Button>
                )}
              </div>
              
              <div className="overflow-y-auto max-h-96">
                {notifications.length > 0 ? (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`p-3 border-b hover:bg-gray-50 cursor-pointer transition-colors ${!notif.is_read ? 'bg-blue-50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          {getNotificationIcon(notif.notification_type, notif.days_before_expiry)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${!notif.is_read ? 'font-semibold' : ''}`}>
                            {(language === 'en' ? (notif.title_en || notif.title_ar) : (notif.title_ar || notif.title_en)) || notif.title}
                          </p>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {(language === 'en' ? (notif.message_en || notif.message_ar) : (notif.message_ar || notif.message_en)) || notif.message}
                          </p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                            <span>{notif.created_at?.split('T')[0]}</span>
                            {notif.member_phone && (
                              <span className="bg-gray-100 px-2 py-0.5 rounded">{notif.member_phone}</span>
                            )}
                          </div>
                        </div>
                        {!notif.is_read && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full mt-2"></span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>{language === 'ar' ? 'لا توجد إشعارات' : 'No notifications'}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>

    <CameraQRScanner
      open={showCameraScanner}
      onClose={() => setShowCameraScanner(false)}
      language={language}
    />

    {showInstallGuide && (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowInstallGuide(false)}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="text-center mb-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-3">
              <Download className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold">{language === 'ar' ? 'تثبيت لوحة التحكم' : 'Install Dashboard'}</h3>
          </div>
          <div className="space-y-4 text-sm" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg">
              <p className="font-bold text-blue-700 dark:text-blue-300 mb-2">Chrome / Edge:</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                <li>{language === 'ar' ? 'اضغط على ⋮ (القائمة) أعلى المتصفح' : 'Tap ⋮ (menu) at top of browser'}</li>
                <li>{language === 'ar' ? 'اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"' : 'Select "Install app" or "Add to Home screen"'}</li>
                <li>{language === 'ar' ? 'اضغط "تثبيت"' : 'Tap "Install"'}</li>
              </ol>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/30 p-3 rounded-lg">
              <p className="font-bold text-purple-700 dark:text-purple-300 mb-2">Samsung Internet:</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                <li>{language === 'ar' ? 'اضغط على ≡ (القائمة) أسفل المتصفح' : 'Tap ≡ (menu) at bottom of browser'}</li>
                <li>{language === 'ar' ? 'اختر "إضافة الصفحة إلى" ثم "الشاشة الرئيسية"' : 'Select "Add page to" then "Home screen"'}</li>
              </ol>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
              <p className="font-bold text-gray-700 dark:text-gray-300 mb-2">Safari (iOS):</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700 dark:text-gray-300">
                <li>{language === 'ar' ? 'اضغط على زر المشاركة ⬆' : 'Tap the share button ⬆'}</li>
                <li>{language === 'ar' ? 'اختر "إضافة إلى الشاشة الرئيسية"' : 'Select "Add to Home Screen"'}</li>
              </ol>
            </div>
          </div>
          <button
            onClick={() => setShowInstallGuide(false)}
            className="w-full mt-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl font-bold hover:from-green-600 hover:to-green-700"
          >
            {language === 'ar' ? 'فهمت' : 'Got it'}
          </button>
        </div>
      </div>
    )}
  </>
  );
};

export const Layout = ({ children, title }) => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const { language } = useLanguage();

  return (
    <div className="app-container">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-content">
        <TopHeader onMenuClick={() => setSidebarOpen(true)} title={title} />
        <SubscriptionBanner />
        <OnboardingGuard />
        <main className="page-content">
          {children}
        </main>
      </div>
      {/* Global QR Scanner - Works on all pages */}
      <GlobalScanner enabled={true} language={language} />
    </div>
  );
};

export default Layout;
