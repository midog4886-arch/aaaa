import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { LanguageProvider } from './contexts/LanguageContext';

// Member Portal Pages
import MemberLogin from './pages/member-portal/MemberLogin';
import MemberLayout from './pages/member-portal/MemberLayout';
import MemberDashboard from './pages/member-portal/MemberDashboard';
import MemberSubscriptions from './pages/member-portal/MemberSubscriptions';
import MemberAttendance from './pages/member-portal/MemberAttendance';
import MemberInvoices from './pages/member-portal/MemberInvoices';
import MemberSchedule from './pages/member-portal/MemberSchedule';
import MemberNotifications from './pages/member-portal/MemberNotifications';
import MemberAds from './pages/member-portal/MemberAds';
import MemberDailyVideos from './pages/member-portal/MemberDailyVideos';
import MemberLoyalty from './pages/member-portal/MemberLoyalty';
import MemberRegistrationForms from './pages/member-portal/MemberRegistrationForms';
import MemberRateCoach from './pages/member-portal/MemberRateCoach';
import MemberQRCard from './pages/member-portal/MemberQRCard';

import './index.css';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('member_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  return (
    <LanguageProvider>
      <HashRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<MemberLogin />} />
          
          {/* Protected Routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <MemberLayout />
            </ProtectedRoute>
          }>
            <Route index element={<MemberDashboard />} />
            <Route path="subscriptions" element={<MemberSubscriptions />} />
            <Route path="attendance" element={<MemberAttendance />} />
            <Route path="invoices" element={<MemberInvoices />} />
            <Route path="schedule" element={<MemberSchedule />} />
            <Route path="notifications" element={<MemberNotifications />} />
            <Route path="ads" element={<MemberAds />} />
            <Route path="videos" element={<MemberDailyVideos />} />
            <Route path="loyalty" element={<MemberLoyalty />} />
            <Route path="forms" element={<MemberRegistrationForms />} />
            <Route path="rate-coach" element={<MemberRateCoach />} />
            <Route path="qr-card" element={<MemberQRCard />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-center" richColors />
      </HashRouter>
    </LanguageProvider>
  );
}

export default App;
