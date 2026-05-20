import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';
import { loadBranding } from './services/branding';

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

// Pages — lazy-loaded so each route ships in its own JS chunk
// (initial load only downloads the bundle for the page being visited).
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage'));
const LevelsPage = lazy(() => import('./pages/LevelsPage'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
// MessagesPage import retained (used as fallback redirect target previously)
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const OperationPasswordsPage = lazy(() => import('./pages/OperationPasswordsPage'));
const BranchesPage = lazy(() => import('./pages/BranchesPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const StorePage = lazy(() => import('./pages/StorePage'));
const AccountingPage = lazy(() => import('./pages/AccountingPage'));
const MyExpensesPage = lazy(() => import('./pages/MyExpensesPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const TodayAttendancePage = lazy(() => import('./pages/TodayAttendancePage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const UnauthorizedPage = lazy(() => import('./pages/UnauthorizedPage'));
const MemberCardPage = lazy(() => import('./pages/MemberCardPage'));
const CoachRatingsPage = lazy(() => import('./pages/CoachRatingsPage'));
const CoachAttendancePage = lazy(() => import('./pages/CoachAttendancePage'));
const CoachSalariesPage = lazy(() => import('./pages/CoachSalariesPage'));
const SupervisorsPage = lazy(() => import('./pages/SupervisorsPage'));
const AdvertisementsPage = lazy(() => import('./pages/AdvertisementsPage'));
const DailyVideosPage = lazy(() => import('./pages/DailyVideosPage'));
const LoyaltyPage = lazy(() => import('./pages/LoyaltyPage'));
const RenewalsPage = lazy(() => import('./pages/RenewalsPage'));
const RenewalsHistoryPage = lazy(() => import('./pages/RenewalsHistoryPage'));
const BackupPage = lazy(() => import('./pages/BackupPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const DailyLedgerPage = lazy(() => import('./pages/DailyLedgerPage'));
const DayExtensionsPage = lazy(() => import('./pages/DayExtensionsPage'));
const WhatsAppPage = lazy(() => import('./pages/WhatsAppPage'));
const WhatsAppBulkPage = lazy(() => import('./pages/WhatsAppBulkPage'));
const TournamentsPage = lazy(() => import('./pages/TournamentsPage'));
const SocialPublisherPage = lazy(() => import('./pages/SocialPublisherPage'));
const SuperLogin = lazy(() => import('./pages/SuperLogin'));
const SuperTenants = lazy(() => import('./pages/SuperTenants'));
const SuperEmails = lazy(() => import('./pages/SuperEmails'));
const SuperPayment = lazy(() => import('./pages/SuperPayment'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const RefundPolicyPage = lazy(() => import('./pages/RefundPolicyPage'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const OpsAlertsPage = lazy(() => import('./pages/OpsAlertsPage'));
import ExpiredTenantGuard from './components/ExpiredTenantGuard';

const SuperGuard = ({ children }) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('super_token') : null;
  if (!token) {
    window.location.replace('/super/login');
    return null;
  }
  return children;
};

// Member Portal Pages
const MemberLogin = lazy(() => import('./pages/member-portal/MemberLogin'));
const MemberDashboard = lazy(() => import('./pages/member-portal/MemberDashboard'));
const MemberSubscriptions = lazy(() => import('./pages/member-portal/MemberSubscriptions'));
const MemberSchedule = lazy(() => import('./pages/member-portal/MemberSchedule'));
const MemberQRCard = lazy(() => import('./pages/member-portal/MemberQRCard'));
const MemberNotifications = lazy(() => import('./pages/member-portal/MemberNotifications'));
const MemberAttendance = lazy(() => import('./pages/member-portal/MemberAttendance'));
const MemberRateCoach = lazy(() => import('./pages/member-portal/MemberRateCoach'));
const MemberDailyVideos = lazy(() => import('./pages/member-portal/MemberDailyVideos'));
const MemberLoyalty = lazy(() => import('./pages/member-portal/MemberLoyalty'));
const MemberSupport = lazy(() => import('./pages/member-portal/MemberSupport'));
const MemberTournaments = lazy(() => import('./pages/member-portal/MemberTournaments'));
const CoachProfile = lazy(() => import('./pages/member-portal/CoachProfile'));
const MemberProfile = lazy(() => import('./pages/member-portal/MemberProfile'));
const CoachQRPage = lazy(() => import('./pages/CoachQRPage'));
const AcademyPickerPage = lazy(() => import('./pages/AcademyPickerPage'));

// Lightweight fallback shown while a page chunk is being fetched
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="spinner" />
  </div>
);

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
  
  // Check permission if specified (string or array of accepted permissions)
  if (permission && !isAdmin) {
    const userPermissions = user?.permissions || [];
    const required = Array.isArray(permission) ? permission : [permission];
    if (!required.some(p => userPermissions.includes(p))) {
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
    const memberToken = localStorage.getItem('member_token');
    if (memberToken) {
      return <Navigate to="/member-dashboard" replace />;
    }
    const isNativeApp = !!(window.Capacitor?.isNativePlatform?.());
    if (isNativeApp) {
      return <Navigate to="/member-login" replace />;
    }
    return <LandingPage />;
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

const ACADEMY_BYPASS_PREFIXES = ['/academy-picker', '/super', '/admin', '/login', '/privacy', '/terms', '/refund-policy', '/signup', '/coach-qr'];

const AcademyGuard = ({ children }) => {
  const location = useLocation();
  const path = location.pathname || '/';
  const confirmed = typeof window !== 'undefined' && localStorage.getItem('academy_confirmed') === '1';
  const hasAdminToken = typeof window !== 'undefined' && !!(localStorage.getItem('token') || localStorage.getItem('super_token'));
  const isBypassed = ACADEMY_BYPASS_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
  if (!confirmed && !isBypassed && !hasAdminToken) {
    const next = encodeURIComponent(path + (location.search || ''));
    return <Navigate to={`/academy-picker?next=${next}`} replace />;
  }
  return children;
};

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
    <AcademyGuard>
    <Routes>
      <Route path="/academy-picker" element={<AcademyPickerPage />} />
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
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/refund-policy" element={<RefundPolicyPage />} />

      {/* Public self-signup */}
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/coach-qr/:coachId" element={<CoachQRPage />} />

      {/* Super-Admin (control plane) — outside main auth/permissions */}
      <Route path="/super" element={<Navigate to="/super/tenants" replace />} />
      <Route path="/super/login" element={<SuperLogin />} />
      <Route path="/super/tenants" element={<SuperGuard><SuperTenants /></SuperGuard>} />
      <Route path="/super/emails" element={<SuperGuard><SuperEmails /></SuperGuard>} />
      <Route path="/super/payment" element={<SuperGuard><SuperPayment /></SuperGuard>} />
      
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
      <Route path="/member-profile" element={<MemberProfile />} />
      
      {/* Onboarding wizard — admin only, no Layout chrome */}
      <Route
        path="/admin/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />

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
        path="/admin/audit"
        element={
          <ProtectedRoute permission="settings">
            <AuditLogPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/operation-passwords"
        element={
          <ProtectedRoute permission="settings">
            <OperationPasswordsPage />
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
          <ProtectedRoute permission={["accounting", "internal-expenses-approve"]}>
            <AccountingPage />
          </ProtectedRoute>
        } 
      />
      <Route
        path="/admin/my-expenses"
        element={
          <ProtectedRoute permission="internal-expenses-create">
            <MyExpensesPage />
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
        path="/admin/today-attendance" 
        element={
          <ProtectedRoute permission="attendance">
            <TodayAttendancePage />
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
        path="/admin/coach-salaries" 
        element={
          <ProtectedRoute permission="salaries">
            <CoachSalariesPage />
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
        path="/admin/renewals/history"
        element={
          <ProtectedRoute permission="renewals">
            <RenewalsHistoryPage />
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
      <Route
        path="/admin/support"
        element={
          <ProtectedRoute permission="settings">
            <SupportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/ops-alerts"
        element={
          <ProtectedRoute permission="settings">
            <OpsAlertsPage />
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
        path="/admin/whatsapp-bulk" 
        element={
          <ProtectedRoute permission="messages">
            <WhatsAppBulkPage />
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
      
      {/* Catch-all → landing/smart redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </AcademyGuard>
    </Suspense>
  );
}

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <ManifestSwitcher />
          <ErrorBoundary>
            <ExpiredTenantGuard>
              <AppRoutes />
            </ExpiredTenantGuard>
          </ErrorBoundary>
          <Toaster position="top-center" richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;

try { loadBranding(); } catch (e) {}
try {
  setInterval(() => { try { loadBranding(); } catch (e) {} }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try { loadBranding(); } catch (e) {}
    }
  });
} catch (e) {}
