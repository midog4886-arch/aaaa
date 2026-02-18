import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/sonner';

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
import AdvertisementsPage from './pages/AdvertisementsPage';
import DailyVideosPage from './pages/DailyVideosPage';
import LoyaltyPage from './pages/LoyaltyPage';
import RenewalsPage from './pages/RenewalsPage';
import BackupPage from './pages/BackupPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';

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
  const routeOrder = ['schedule', 'attendance', 'dashboard', 'members', 'activities', 'levels', 'invoices', 'store', 'accounting', 'reports', 'messages', 'settings'];
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
      
      {/* Root shows admin login */}
      <Route path="/" element={
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      } />

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
        path="/admin/messages" 
        element={
          <ProtectedRoute permission="messages">
            <MessagesPage />
          </ProtectedRoute>
        } 
      />
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
          <ProtectedRoute permission="members">
            <RenewalsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/backup" 
        element={
          <ProtectedRoute permission="settings">
            <BackupPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/admin/member-card" 
        element={
          <ProtectedRoute permission="attendance">
            <MemberCardPage />
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
          <AppRoutes />
          <Toaster position="top-center" richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
