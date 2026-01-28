import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { branchesAPI } from '../services/api';
import { 
  LayoutDashboard, 
  Users, 
  Dumbbell, 
  UserCog, 
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
  Calculator
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
    { to: '/dashboard', icon: LayoutDashboard, label: 'dashboard' },
    { to: '/members', icon: Users, label: 'members' },
    { to: '/activities', icon: Dumbbell, label: 'activities' },
    { to: '/coaches', icon: UserCog, label: 'coaches' },
    { to: '/invoices', icon: Receipt, label: 'invoices' },
    { to: '/store', icon: Package, label: 'store' },
    { to: '/reports', icon: BarChart3, label: 'reports' },
    { to: '/messages', icon: MessageSquare, label: 'messages' },
    ...(isAdmin ? [{ to: '/branches', icon: Building2, label: 'branches' }] : []),
    ...(isAdmin ? [{ to: '/users', icon: Users, label: 'users' }] : []),
    { to: '/settings', icon: Settings, label: 'settings' },
  ];

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
          {navItems.map((item) => (
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
  const { t } = useLanguage();
  
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
