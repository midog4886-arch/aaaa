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
      // Redirect to unauthorized page
      return <Navigate to="/unauthorized" replace />;
    }
  }
  
  return children;
};

// Get first allowed route based on user permissions
const getFirstAllowedRoute = (permissions) => {
  const routeOrder = ['schedule', 'attendance', 'dashboard', 'members', 'activities', 'levels', 'invoices', 'store', 'accounting', 'reports', 'messages', 'settings'];
  for (const route of routeOrder) {
    if (permissions.includes(route)) {
      return `/${route}`;
    }
  }
  return '/schedule'; // fallback
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
    return <Navigate to="/login" replace />;
  }
  
  // Admin goes to dashboard
  if (isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }
  
  // Non-admin goes to first allowed page
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
    // Admin goes to dashboard, others go to first allowed page
    if (isAdmin) {
      return <Navigate to="/dashboard" replace />;
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
      
      {/* Unauthorized Page */}
      <Route 
        path="/unauthorized" 
        element={
          <ProtectedRoute>
            <UnauthorizedPage />
          </ProtectedRoute>
        } 
      />
      
      {/* Protected Routes with permissions */}
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute permission="dashboard">
            <DashboardPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/members" 
        element={
          <ProtectedRoute permission="members">
            <MembersPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/activities" 
        element={
          <ProtectedRoute permission="activities">
            <ActivitiesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/levels" 
        element={
          <ProtectedRoute permission="levels">
            <LevelsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/invoices" 
        element={
          <ProtectedRoute permission="invoices">
            <InvoicesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/reports" 
        element={
          <ProtectedRoute permission="reports">
            <ReportsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/messages" 
        element={
          <ProtectedRoute permission="messages">
            <MessagesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/settings" 
        element={
          <ProtectedRoute permission="settings">
            <SettingsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/branches" 
        element={
          <ProtectedRoute permission="branches">
            <BranchesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/users" 
        element={
          <ProtectedRoute permission="users">
            <UsersPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/store" 
        element={
          <ProtectedRoute permission="store">
            <StorePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/accounting" 
        element={
          <ProtectedRoute permission="accounting">
            <AccountingPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/attendance" 
        element={
          <ProtectedRoute permission="attendance">
            <AttendancePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/schedule" 
        element={
          <ProtectedRoute permission="schedule">
            <SchedulePage />
          </ProtectedRoute>
        } 
      />
      
      {/* Smart Default Redirect based on permissions */}
      <Route path="/" element={<SmartRedirect />} />
      <Route path="*" element={<SmartRedirect />} />
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
