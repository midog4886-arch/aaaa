import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { branchesAPI, notificationsAPI } from '../services/api';
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
  Smartphone
} from 'lucide-react';

export const Sidebar = ({ isOpen, onClose }) => {
  const { t, language, toggleLanguage } = useLanguage();
  const { logout, user, selectedBranchId, switchBranch } = useAuth();
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);

  const isAdmin = user?.is_admin;

  useEffect(() => {
    if (isAdmin) {
      loadBranches();
    }
  }, [isAdmin]);

  const loadBranches = async () => {
    try {
      const res = await branchesAPI.getAll();
      setBranches(res.data || []);
    } catch (error) {
      console.error('Failed to load branches:', error);
    }
  };

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'dashboard', permission: 'dashboard' },
    { to: '/invoices', icon: Receipt, label: 'invoices', permission: 'invoices' },
    { to: '/members', icon: Users, label: 'members', permission: 'members' },
    { to: '/activities', icon: Dumbbell, label: 'activities', permission: 'activities' },
    { to: '/levels', icon: Layers, label: 'levels', permission: 'levels' },
    { to: '/schedule', icon: CalendarDays, label: 'schedule', permission: 'schedule' },
    { to: '/attendance', icon: ClipboardList, label: 'attendance', permission: 'attendance' },
    { to: '/member-card', icon: QrCode, label: 'member_card', permission: 'attendance' },
    { to: '/coach-ratings', icon: Star, label: 'coach_ratings', permission: 'coach-ratings' },
    { to: '/advertisements', icon: Megaphone, label: 'advertisements', permission: 'advertisements' },
    { to: '/daily-videos', icon: Video, label: 'daily_videos', permission: 'daily-videos' },
    { to: '/store', icon: Package, label: 'store', permission: 'store' },
    { to: '/accounting', icon: Calculator, label: 'accounting', permission: 'accounting' },
    { to: '/reports', icon: BarChart3, label: 'reports', permission: 'reports' },
    { to: '/messages', icon: MessageSquare, label: 'messages', permission: 'messages' },
    ...(isAdmin ? [{ to: '/branches', icon: Building2, label: 'branches', permission: 'branches' }] : []),
    ...(isAdmin ? [{ to: '/users', icon: Users, label: 'users', permission: 'users' }] : []),
    { to: '/settings', icon: Settings, label: 'settings', permission: 'settings' },
  ];

  // Filter nav items based on user permissions
  const userPermissions = user?.permissions || [];
  const filteredNavItems = navItems.filter(item => {
    // Admin has all permissions
    if (isAdmin) return true;
    // Check if user has permission for this page
    return userPermissions.includes(item.permission);
  });

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
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Trophy className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold truncate">
                {t('academy_name_short')}
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
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <item.icon className="nav-item-icon" />
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
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
          {/* Quick Navigation to Member Portal */}
          <a
            href="/portal/login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:from-orange-600 hover:to-orange-700 transition-all"
          >
            <Smartphone className="w-5 h-5" />
            <span className="flex-1 text-sm font-medium">
              {language === 'ar' ? 'بوابة الأعضاء' : 'Member Portal'}
            </span>
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>

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
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [checkingRenewals, setCheckingRenewals] = useState(false);

  const isAdmin = user?.is_admin;

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
  
  return (
    <header className="top-header">
      <div className="flex items-center gap-4">
        <button 
          className="lg:hidden p-2 hover:bg-accent rounded-md"
          onClick={onMenuClick}
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold">{title || t('dashboard')}</h2>
      </div>

      <div className="flex items-center gap-2">
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
                            {notif.title}
                          </p>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {notif.message}
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
  );
};

export const Layout = ({ children, title }) => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div className="app-container">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-content">
        <TopHeader onMenuClick={() => setSidebarOpen(true)} title={title} />
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
