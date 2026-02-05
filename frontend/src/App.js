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
      // Redirect to first allowed page
      return <Navigate to={getFirstAllowedRoute(userPermissions)} replace />;
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
      
      {/* Protected Routes */}
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/members" 
        element={
          <ProtectedRoute>
            <MembersPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/activities" 
        element={
          <ProtectedRoute>
            <ActivitiesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/levels" 
        element={
          <ProtectedRoute>
            <LevelsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/invoices" 
        element={
          <ProtectedRoute>
            <InvoicesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/reports" 
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/messages" 
        element={
          <ProtectedRoute>
            <MessagesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/settings" 
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/branches" 
        element={
          <ProtectedRoute>
            <BranchesPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/users" 
        element={
          <ProtectedRoute>
            <UsersPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/store" 
        element={
          <ProtectedRoute>
            <StorePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/accounting" 
        element={
          <ProtectedRoute>
            <AccountingPage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/attendance" 
        element={
          <ProtectedRoute>
            <AttendancePage />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/schedule" 
        element={
          <ProtectedRoute>
            <SchedulePage />
          </ProtectedRoute>
        } 
      />
      
      {/* Default Redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
