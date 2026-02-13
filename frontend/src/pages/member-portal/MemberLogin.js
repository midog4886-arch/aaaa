import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Phone, LogIn, Trophy, Loader2, Star, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

// Splash Screen Component
const SplashScreen = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 overflow-hidden"
    >
      {/* Animated background particles */}
      <div className="absolute inset-0">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 100 }}
            animate={{ 
              opacity: [0, 0.6, 0],
              y: [-20, -200],
              x: Math.sin(i) * 50,
            }}
            transition={{
              duration: 3,
              delay: i * 0.1,
              repeat: Infinity,
            }}
            className="absolute w-2 h-2 bg-white rounded-full"
            style={{
              left: `${(i * 3.3) % 100}%`,
              bottom: '0%',
            }}
          />
        ))}
      </div>

      <div className="relative text-center z-10">
        {/* Logo with bounce */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 15,
          }}
          className="relative inline-block"
        >
          <motion.div 
            className="w-36 h-36 bg-white rounded-3xl shadow-2xl flex items-center justify-center mx-auto"
            animate={{ 
              boxShadow: [
                "0 0 30px rgba(255,255,255,0.3)",
                "0 0 60px rgba(255,255,255,0.5)",
                "0 0 30px rgba(255,255,255,0.3)",
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Trophy className="w-20 h-20 text-yellow-500" />
          </motion.div>
          
          {/* Orbiting stars */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            className="absolute inset-[-20px]"
          >
            <Star className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-6 text-yellow-400 fill-yellow-400" />
            <Star className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-5 text-yellow-300 fill-yellow-300" />
            <Star className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-200 fill-yellow-200" />
            <Star className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 text-yellow-300 fill-yellow-300" />
          </motion.div>
        </motion.div>

        {/* Title with fade in */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h1 className="mt-8 text-4xl font-bold text-white drop-shadow-lg">
            أكاديمية أداء الأبطال
          </h1>
          <p className="mt-3 text-xl text-white/80">
            Global Champions Sports Performance
          </p>
        </motion.div>

        {/* Loading dots */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-10 flex justify-center gap-3"
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.3, 1, 0.3],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                delay: i * 0.15,
              }}
              className="w-4 h-4 bg-white rounded-full"
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

  useEffect(() => {
    // Check if already logged in
    const token = localStorage.getItem('member_token');
    if (token) {
      navigate('/portal/dashboard');
    }
  }, [navigate]);

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
      
      toast.success(`مرحباً ${response.data.member.name_ar}`);
      navigate('/portal/dashboard');
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
      {/* Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-purple-900">
        {/* Floating orbs */}
        <motion.div
          animate={{
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 20, repeat: Infinity }}
          className="absolute top-20 right-20 w-72 h-72 bg-blue-500/30 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -80, 0],
            y: [0, 80, 0],
          }}
          transition={{ duration: 15, repeat: Infinity }}
          className="absolute bottom-20 left-20 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
          }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-3xl"
        />
      </div>

      {/* Splash Screen */}
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
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
              <Card className="relative overflow-hidden border-0 bg-white/10 backdrop-blur-xl shadow-2xl">
                {/* Gradient border effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                
                <CardHeader className="relative text-center pb-2">
                  {/* Logo */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring" }}
                    className="mx-auto relative"
                  >
                    <div className="w-24 h-24 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-xl">
                      <Trophy className="w-12 h-12 text-white" />
                    </div>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      className="absolute -inset-4"
                    >
                      <Sparkles className="absolute top-0 right-0 w-5 h-5 text-yellow-300" />
                      <Sparkles className="absolute bottom-0 left-0 w-4 h-4 text-yellow-200" />
                    </motion.div>
                  </motion.div>
                  
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                  >
                    <CardTitle className="text-2xl font-bold text-white mt-4">
                      بوابة الأعضاء
                    </CardTitle>
                    <p className="text-white/70 mt-2">أكاديمية أداء الأبطال العالمية</p>
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
                        className="w-full h-14 text-lg bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-white font-bold gap-2 shadow-lg shadow-orange-500/30 transition-all hover:shadow-xl hover:shadow-orange-500/40"
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
                className="text-center text-white/40 text-sm mt-6"
              >
                © 2026 أكاديمية أداء الأبطال
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MemberLogin;
