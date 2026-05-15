import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Phone, LogIn, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import API_URL from '../../config/api';
import { getAcademyLogoUrl, loadBranding, useBrandColor } from '../../services/branding';

// Default member-portal logo if no tenant branding logo is set
const DEFAULT_LOGO = "/logo-new.png";

const resolveAcademyLogo = () => {
  const url = getAcademyLogoUrl();
  // branding service returns '/images/academy-logo.png' as global fallback;
  // prefer the member-portal default in that case so existing visuals stay.
  if (!url || url === '/images/academy-logo.png') return DEFAULT_LOGO;
  return url;
};

// Splash Screen Component
const SplashScreen = ({ onComplete, logo }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-gray-900 via-yellow-900 to-gray-900 overflow-hidden"
    >
      {/* Animated water waves background */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{
            y: [0, -20, 0],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-yellow-700/30 to-transparent"
        />
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            animate={{
              x: ['-100%', '100%'],
            }}
            transition={{
              duration: 8 + i * 2,
              repeat: Infinity,
              ease: "linear",
              delay: i * 0.5,
            }}
            className="absolute h-1 bg-amber-400/20 rounded-full"
            style={{
              width: `${100 + i * 50}px`,
              top: `${30 + i * 15}%`,
            }}
          />
        ))}
      </div>

      <div className="relative text-center z-10">
        {/* Logo with bounce */}
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 15,
          }}
          className="relative inline-block"
        >
          <motion.div 
            className="w-44 h-44 bg-white rounded-3xl shadow-2xl flex items-center justify-center mx-auto p-4 overflow-hidden"
            animate={{ 
              boxShadow: [
                "0 0 30px rgba(255,255,255,0.3)",
                "0 0 60px rgba(255,255,255,0.5)",
                "0 0 30px rgba(255,255,255,0.3)",
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <img 
              src={logo} 
              alt="Academy logo" 
              className="w-full h-full object-contain"
            />
          </motion.div>
        </motion.div>

        {/* Title with fade in */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h1 className="mt-8 text-3xl font-bold text-white drop-shadow-lg">
            شركة اداء الابطال العالمية للرياضة
          </h1>
          <p className="mt-3 text-xl text-white/90 font-medium tracking-wide">
            Global Champions Sports Performance
          </p>
        </motion.div>

        {/* Loading wave animation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-10 flex justify-center items-end gap-1"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              animate={{
                height: ['12px', '24px', '12px'],
              }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.1,
              }}
              className="w-2 bg-white rounded-full"
              style={{ height: '12px' }}
            />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
};

const MemberLogin = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [logo, setLogo] = useState(resolveAcademyLogo());
  const primary = useBrandColor();

  useEffect(() => {
    // Check if already logged in
    const token = localStorage.getItem('member_token');
    if (token) {
      navigate('/member-dashboard');
    }
  }, [navigate]);

  // Pull tenant branding (logo). Re-render on color changes via useBrandColor()
  // also refreshes the logo from the cached branding payload.
  useEffect(() => {
    let cancelled = false;
    loadBranding().then(() => {
      if (cancelled) return;
      setLogo(resolveAcademyLogo());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setLogo(resolveAcademyLogo());
  }, [primary]);

  const handleSplashComplete = () => {
    setShowSplash(false);
    setTimeout(() => setFormVisible(true), 100);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!phone.trim()) {
      toast.error('يرجى إدخال رقم الجوال');
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await axios.post(`${API_URL}/api/member-portal/login`, {
        phone: phone.trim()
      });
      
      localStorage.setItem('member_token', response.data.access_token);
      localStorage.setItem('member_data', JSON.stringify(response.data.member));
      const savedLang = response.data.member?.language;
      localStorage.setItem('member_language', savedLang === 'en' ? 'en' : 'ar');

      toast.success(`مرحباً ${response.data.member.name_ar}`);
      navigate('/member-dashboard');
    } catch (error) {
      if (error.response?.status === 404) {
        toast.error('رقم الجوال غير مسجل في النظام');
      } else {
        toast.error('حدث خطأ في تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden" dir="rtl">
      {/* Animated Background - Water/Swimming theme */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        {/* Golden particles */}
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 100, x: Math.random() * 100 }}
            animate={{ 
              opacity: [0, 0.5, 0],
              y: -200,
            }}
            transition={{
              duration: 4 + Math.random() * 3,
              delay: i * 0.3,
              repeat: Infinity,
            }}
            className="absolute w-2 h-2 bg-amber-400/40 rounded-full"
            style={{
              left: `${(i * 7) % 100}%`,
              bottom: '10%',
            }}
          />
        ))}
        
        {/* Golden glow at bottom */}
        <motion.div
          animate={{ y: [0, -15, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-amber-700/20 to-transparent"
        />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-3xl" />
      </div>

      {/* Splash Screen */}
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={handleSplashComplete} logo={logo} />}
      </AnimatePresence>

      {/* Login Form */}
      <AnimatePresence>
        {formVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative z-10 min-h-screen flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md"
            >
              {/* Glassmorphism Card */}
              <Card className="relative overflow-hidden border-0 bg-white/10 backdrop-blur-xl shadow-2xl border border-amber-500/20">
                {/* Gradient border effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent pointer-events-none rounded-lg" />
                
                <CardHeader className="relative text-center pb-2">
                  {/* Logo */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="mx-auto relative"
                  >
                    <div className="w-28 h-28 bg-white rounded-2xl flex items-center justify-center shadow-xl p-2 overflow-hidden">
                      <img 
                        src={logo} 
                        alt="Academy logo" 
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </motion.div>
                  
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                  >
                    <CardTitle className="text-2xl font-bold text-white mt-4">
                      بوابة الأعضاء
                    </CardTitle>
                    <p className="text-white/80 mt-2 text-sm">Global Champions Sports Performance</p>
                  </motion.div>
                </CardHeader>
                
                <CardContent className="relative pt-6">
                  <form onSubmit={handleLogin} className="space-y-6">
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 }}
                      className="space-y-2"
                    >
                      <label className="text-sm font-medium text-white/90">رقم الجوال</label>
                      <div className="relative">
                        <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50" />
                        <Input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="05xxxxxxxx"
                          className="pr-10 text-lg h-14 text-center tracking-wider bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 transition-colors"
                          dir="ltr"
                          data-testid="member-phone-input"
                        />
                      </div>
                      <p className="text-xs text-white/50 text-center">أدخل رقم الجوال المسجل في النظام</p>
                    </motion.div>
                    
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                    >
                      <Button 
                        type="submit" 
                        className={`w-full h-14 text-lg font-bold gap-2 shadow-lg transition-all hover:shadow-xl ${primary ? 'text-white' : 'bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-gray-900 shadow-amber-500/30 hover:shadow-amber-500/40'}`}
                        style={primary ? { background: primary, color: 'hsl(var(--primary-foreground))' } : undefined}
                        disabled={loading}
                        data-testid="member-login-btn"
                      >
                        {loading ? (
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          >
                            <Loader2 className="w-6 h-6" />
                          </motion.div>
                        ) : (
                          <>
                            <LogIn className="w-5 h-5" />
                            دخول
                          </>
                        )}
                      </Button>
                    </motion.div>
                  </form>
                </CardContent>
              </Card>

              {/* Footer */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-center text-white/50 text-sm mt-6"
              >
                © 2026 Global Champions Sports Performance
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MemberLogin;
