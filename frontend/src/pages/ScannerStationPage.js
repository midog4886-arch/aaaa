/**
 * Scanner Station Page — محطة المسح (تابلت)
 * A locked, full-screen kiosk for a dedicated scanner user/tablet.
 * Reuses GlobalScanner (USB/Bluetooth keyboard-wedge listener + check-in dialog)
 * so the supervisor's own screen stays free for invoices.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import GlobalScanner from '../components/GlobalScanner';
import { ScanLine, LogOut } from 'lucide-react';

const ScannerStationPage = () => {
  const { user, logout } = useAuth();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const origin = window.location.origin;
  const branchName = user?.branch_name || '';
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center text-center px-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #1d4ed8 100%)' }}
    >
      {/* Logout (corner) */}
      <button
        onClick={logout}
        className="absolute top-4 left-4 flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white/90 px-4 py-2 rounded-xl backdrop-blur-sm transition-colors"
        title="تسجيل الخروج"
      >
        <LogOut className="w-4 h-4" />
        <span className="text-sm font-medium">خروج</span>
      </button>

      {/* Clock */}
      <div className="absolute top-4 right-4 text-right text-white/80">
        <div className="text-2xl font-bold tabular-nums">{timeStr}</div>
        <div className="text-xs opacity-80">{dateStr}</div>
      </div>

      {/* Logo */}
      <img
        src={`${origin}/images/academy-logo.png`}
        alt="logo"
        className="w-28 h-28 object-contain mb-6 rounded-full bg-white/95 p-2 shadow-2xl"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />

      {/* Animated scan icon */}
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-full bg-green-400/30 animate-ping" />
        <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-2xl">
          <ScanLine className="w-12 h-12 text-white" />
        </div>
      </div>

      <h1 className="text-4xl font-extrabold text-white mb-3">امسح كارت العضوية</h1>
      <p className="text-lg text-white/80 mb-2">قرّب الباركود من الماسح لتسجيل الحضور</p>
      {branchName && (
        <p className="text-white/60 text-base">الفرع: <span className="font-bold text-white/90">{branchName}</span></p>
      )}

      <div className="absolute bottom-6 text-white/40 text-xs">
        محطة المسح — Champions Academy
      </div>

      {/* Always-on USB/Bluetooth scanner listener + check-in dialog */}
      <GlobalScanner enabled={true} language="ar" />
    </div>
  );
};

export default ScannerStationPage;
