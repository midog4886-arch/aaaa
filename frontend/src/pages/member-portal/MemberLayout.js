import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { 
  Trophy, Home, CreditCard, Calendar, FileText, QrCode, Bell, 
  LogOut, Menu, X, User, Clock, CheckCircle, AlertTriangle,
  ChevronLeft
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

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

  useEffect(() => {
    const memberData = getMemberData();
    if (!memberData) {
      navigate('/portal/login');
      return;
    }
    setMember(memberData);
    fetchNotifications();
  }, [navigate]);

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
    { to: '/portal/dashboard', icon: Home, label: 'الرئيسية' },
    { to: '/portal/subscriptions', icon: CreditCard, label: 'اشتراكاتي' },
    { to: '/portal/schedule', icon: Calendar, label: 'جدول التدريبات' },
    { to: '/portal/invoices', icon: FileText, label: 'فواتيري' },
    { to: '/portal/card', icon: QrCode, label: 'بطاقة العضوية' },
    { to: '/portal/notifications', icon: Bell, label: 'الإشعارات', badge: notifications.unread_count },
  ];

  if (!member) return null;

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 text-white sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-500 rounded-full flex items-center justify-center">
                <Trophy className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <p className="font-bold">بوابة الأعضاء</p>
                <p className="text-xs text-gray-300">أكاديمية أداء الأبطال</p>
              </div>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-1">
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
                  <span className="text-sm">{item.label}</span>
                  {item.badge > 0 && (
                    <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </nav>

            {/* User Menu */}
            <div className="flex items-center gap-3">
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
                className="md:hidden text-gray-300"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav className="md:hidden bg-slate-800 border-t border-slate-700 px-4 py-3 space-y-1">
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
                  <span>{item.label}</span>
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
      <footer className="bg-white border-t py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>أكاديمية أداء الأبطال العالمية © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default MemberLayout;
