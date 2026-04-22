import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';

const ManifestSwitcher = () => {
  const location = useLocation();
  useEffect(() => {
    const isAdmin = location.pathname.startsWith('/admin');
    const link = document.querySelector('link[rel="manifest"]');
    if (link) {
      link.href = isAdmin ? '/admin-manifest.json' : '/manifest.json';
    }
  }, [location.pathname]);
  return null;
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, direction: 'rtl', textAlign: 'center' }}>
          <h2 style={{ color: 'red' }}>حدث خطأ في تحميل الصفحة</h2>
          <p style={{ color: '#666', marginTop: 10 }}>{this.state.error?.message || 'Unknown error'}</p>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} style={{ marginTop: 20, padding: '10px 20px', background: '#f97316', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            إعادة تحميل
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Pages
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MembersPage from './pages/MembersPage';
import ActivitiesPage from './pages/ActivitiesPage';
import LevelsPage from './pages/LevelsPage';
import InvoicesPage from './pages/InvoicesPage';
import ReportsPage from './pages/ReportsPage';
import MessagesPage from './pages/MessagesPage';
import SettingsPage from './pages/SettingsPage';
import BranchesPage from './pages/BranchesPage';
import UsersPage from './pages/UsersPage';
import StorePage from './pages/StorePage';
import AccountingPage from './pages/AccountingPage';
import AttendancePage from './pages/AttendancePage';
import SchedulePage from './pages/SchedulePage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import MemberCardPage from './pages/MemberCardPage';
import CoachRatingsPage from './pages/CoachRatingsPage';
import CoachAttendancePage from './pages/CoachAttendancePage';
import SupervisorsPage from './pages/SupervisorsPage';
import AdvertisementsPage from './pages/AdvertisementsPage';
import DailyVideosPage from './pages/DailyVideosPage';
import LoyaltyPage from './pages/LoyaltyPage';
import RenewalsPage from './pages/RenewalsPage';
import BackupPage from './pages/BackupPage';
import PushNotificationsPage from './pages/PushNotificationsPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import DailyLedgerPage from './pages/DailyLedgerPage';
import DayExtensionsPage from './pages/DayExtensionsPage';
import WhatsAppPage from './pages/WhatsAppPage';
import TournamentsPage from './pages/TournamentsPage';
import SocialPublisherPage from './pages/SocialPublisherPage';

// Member Portal Pages
import MemberLogin from './pages/member-portal/MemberLogin';
import MemberDashboard from './pages/member-portal/MemberDashboard';
import MemberSubscriptions from './pages/member-portal/MemberSubscriptions';
import MemberSchedule from './pages/member-portal/MemberSchedule';
import MemberQRCard from './pages/member-portal/MemberQRCard';
import MemberNotifications from './pages/member-portal/MemberNotifications';
import MemberAttendance from './pages/member-portal/MemberAttendance';
import MemberRateCoach from './pages/member-portal/MemberRateCoach';
import MemberDailyVideos from './pages/member-portal/MemberDailyVideos';
import MemberLoyalty from './pages/member-portal/MemberLoyalty';
import MemberSupport from './pages/member-portal/MemberSupport';
import MemberTournaments from './pages/member-portal/MemberTournaments';
import CoachProfile from './pages/member-portal/CoachProfile';
import CoachQRPage from './pages/CoachQRPage';

import './App.css';

// Protected Route Component
const ProtectedRoute = ({ children, permission }) => {
  const { isAuthenticated, loading, user, isAdmin } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="spinner" />
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  // Check permission if specified
  if (permission && !isAdmin) {
    const userPermissions = user?.permissions || [];
    if (!userPermissions.includes(permission)) {
      return <Navigate to="/admin/unauthorized" replace />;
    }
  }
  
  return children;
};

// Get first allowed route based on user permissions
const getFirstAllowedRoute = (permissions) => {
  const routeOrder = ['dashboard', 'schedule', 'attendance', 'coach-attendance', 'members', 'activities', 'levels', 'tournaments', 'invoices', 'store', 'accounting', 'reports', 'messages', 'settings'];
  for (const route of routeOrder) {
    if (permissions.includes(route)) {
      return `/admin/${route}`;
    }
  }
  return '/admin/schedule';
};

// Smart Redirect Component - redirects to appropriate page based on permissions
const SmartRedirect = () => {
  const { isAuthenticated, loading, user, isAdmin } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="spinner" />
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/member-login" replace />;
  }
  
  if (isAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  
  const userPermissions = user?.permissions || [];
  return <Navigate to={getFirstAllowedRoute(userPermissions)} replace />;
};

// Public Route Component (redirect if authenticated)
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading, user, isAdmin } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="spinner" />
      </div>
    );
  }
  
  if (isAuthenticated) {
    if (isAdmin) {
      return <Navigate to="/admin/dashboard" replace />;
    }
    const userPermissions = user?.permissions || [];
    return <Navigate to={getFirstAllowedRoute(userPermissions)} replace />;
  }
  
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route 
        path="/login" 
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        } 
      />
      
      {/* Privacy Policy - Public page */}
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/coach-qr/:coachId" element={<CoachQRPage />} />
      
      {/* Root - smart redirect based on user role */}
      <Route path="/" element={<SmartRedirect />} />

      {/* Member Portal Routes */}
      <Route path="/member-login" element={<MemberLogin />} />
      <Route path="/member-dashboard" element={<MemberDashboard />} />
      <Route path="/subscriptions" element={<MemberSubscriptions />} />
      <Route path="/member-schedule" element={<MemberSchedule />} />
      <Route path="/card" element={<MemberQRCard />} />
      <Route path="/notifications" element={<MemberNotifications />} />
      <Route path="/member-attendance" element={<MemberAttendance />} />
      <Route path="/rate-coach" element={<MemberRateCoach />} />
      <Route path="/videos" element={<MemberDailyVideos />} />
      <Route path="/loyalty-points" element={<MemberLoyalty />} />
      <Route path="/support" element={<MemberSupport />} />
      <Route path="/member-messages" element={<MemberNotifications />} />
      <Route path="/my-tournaments" element={<MemberTournaments />} />
      <Route path="/coach-profile/:coachId" element={<CoachProfile />} />
      
      {/* Admin Protected Routes - under /admin prefix */}
      <Route 
        path="/admin/unauthorized" 
        element={
          <ProtectedRoute>
            <UnauthorizedPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/dashboard" 
        element={
          <ProtectedRoute permission="dashboard">
            <DashboardPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/members" 
        element={
          <ProtectedRoute permission="members">
            <MembersPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/activities" 
        element={
          <ProtectedRoute permission="activities">
            <ActivitiesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/levels" 
        element={
          <ProtectedRoute permission="levels">
            <LevelsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/invoices" 
        element={
          <ProtectedRoute permission="invoices">
            <InvoicesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/reports" 
        element={
          <ProtectedRoute permission="reports">
            <ReportsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/daily-ledger" 
        element={
          <ProtectedRoute permission="daily-ledger">
            <DailyLedgerPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/day-extensions" 
        element={
          <ProtectedRoute permission="day-extensions">
            <DayExtensionsPage />
          </ProtectedRoute>
        } 
      />
      <Route path="/admin/messages" element={<Navigate to="/admin/whatsapp" replace />} />
      <Route 
        path="/admin/settings" 
        element={
          <ProtectedRoute permission="settings">
            <SettingsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/branches" 
        element={
          <ProtectedRoute permission="branches">
            <BranchesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/users" 
        element={
          <ProtectedRoute permission="users">
            <UsersPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/store" 
        element={
          <ProtectedRoute permission="store">
            <StorePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/accounting" 
        element={
          <ProtectedRoute permission="accounting">
            <AccountingPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/attendance" 
        element={
          <ProtectedRoute permission="attendance">
            <AttendancePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/schedule" 
        element={
          <ProtectedRoute permission="schedule">
            <SchedulePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/coach-ratings" 
        element={
          <ProtectedRoute permission="coach-ratings">
            <CoachRatingsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/coach-attendance" 
        element={
          <ProtectedRoute permission="coach-attendance">
            <CoachAttendancePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/supervisors" 
        element={
          <ProtectedRoute permission="coaches">
            <SupervisorsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/advertisements" 
        element={
          <ProtectedRoute permission="advertisements">
            <AdvertisementsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/daily-videos" 
        element={
          <ProtectedRoute permission="daily-videos">
            <DailyVideosPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/loyalty" 
        element={
          <ProtectedRoute permission="loyalty">
            <LoyaltyPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/renewals" 
        element={
          <ProtectedRoute permission="renewals">
            <RenewalsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/backup" 
        element={
          <ProtectedRoute permission="backup">
            <BackupPage />
          </ProtectedRoute>
        } 
      />
      <Route path="/admin/push-notifications" element={<Navigate to="/admin/whatsapp" replace />} />
      <Route 
        path="/admin/member-card" 
        element={
          <ProtectedRoute permission="member-card">
            <MemberCardPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/whatsapp" 
        element={
          <ProtectedRoute permission="messages">
            <WhatsAppPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/tournaments" 
        element={
          <ProtectedRoute permission="tournaments">
            <TournamentsPage />
          </ProtectedRoute>
        } 
      />
      <Route
        path="/admin/social-publisher"
        element={
          <ProtectedRoute permission="social-publisher">
            <SocialPublisherPage />
          </ProtectedRoute>
        }
      />
      
      {/* Catch-all redirect to member login */}
      <Route path="*" element={<Navigate to="/member-login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <ManifestSwitcher />
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
          <Toaster position="top-center" richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
