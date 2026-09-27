import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Phone, LogIn, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import API_URL, {
  getTenantSlug,
  getRememberedMemberPhone,
  getRememberedMemberPhoneForTenant,
  setRememberedMemberPhone,
  clearRememberedMemberPhone,
} from '../../config/api';
import { getAcademyLogoUrl, getAcademyName, loadBranding, useBrandColor } from '../../services/branding';
import { WEB_RELEASE } from '../../config/release';

const DEFAULT_LOGO = "/logo-new.png";

const resolveAcademyLogo = () => {
  const url = getAcademyLogoUrl();
  if (!url || url === '/images/academy-logo.png') return DEFAULT_LOGO;
  return url;
};

const SplashScreen = ({ onComplete, logo, academyName }) => {
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
          <h1 className="mt-8 text-3xl font-bold text-white drop-shadow-lg px-6">
            {academyName || 'بوابة الأعضاء'}
          </h1>
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
  const location = useLocation();
  const requestedTenant = (() => {
    const value = new URLSearchParams(location.search).get('tenant') || '';
    const clean = value.trim().toLowerCase();
    return /^[a-z0-9_-]{1,64}$/.test(clean) ? clean : '';
  })();
  // Do not fall back to the legacy unscoped phone when a tenant link is
  // explicit.  That phone may belong to another academy and would bypass the
  // isolation performed by the query-parameter effect below.
  const rememberedPhone = requestedTenant
    ? getRememberedMemberPhoneForTenant(requestedTenant)
    : getRememberedMemberPhone();
  const identityKey = `member_login_identity:${requestedTenant || getTenantSlug()}`;
  const rememberedIdentity = (() => {
    try { return JSON.parse(localStorage.getItem(identityKey) || 'null'); } catch { return null; }
  })();
  const [phone, setPhone] = useState(location.state?.verifiedPhone || rememberedIdentity?.phone || rememberedPhone);
  const [memberCode, setMemberCode] = useState(location.state?.verifiedMemberCode || rememberedIdentity?.code || '');
  const [rememberIdentity, setRememberIdentity] = useState(!!rememberedIdentity);
  const [loginError, setLoginError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [loading, setLoading] = useState(false);
  // A remembered phone alone cannot establish the member's academy. Never
  // auto-login on it; the exact member code must be supplied as well.
  const [showSplash, setShowSplash] = useState(!rememberedPhone && !location.state?.verifiedMemberCode);
  const [formVisible, setFormVisible] = useState(!!rememberedPhone || !!location.state?.verifiedMemberCode);
  const [logo, setLogo] = useState(resolveAcademyLogo());
  const [academyName, setAcademyName] = useState(getAcademyName());
  const primary = useBrandColor();
  const autoTriedRef = useRef(false);

  // Invoice/WhatsApp links can carry the tenant because the public app is
  // shared by academies.  Set it before any remembered-phone auto-login so a
  // link opened while another academy is cached cannot authenticate against
  // the wrong tenant.
  useEffect(() => {
    const tenant = new URLSearchParams(location.search).get('tenant');
    if (!tenant) return;
    try {
      const clean = tenant.trim().toLowerCase();
      if (/^[a-z0-9_-]{1,64}$/.test(clean)) {
        const previous = localStorage.getItem('tenant_slug');
        if (previous && previous !== clean) {
          localStorage.removeItem('member_token');
          localStorage.removeItem('member_data');
          localStorage.removeItem('member_language');
          localStorage.removeItem('member_dashboard_cache_v1');
        }
        localStorage.setItem('tenant_slug', clean);
        localStorage.setItem('academy_confirmed', '1');
      }
    } catch (e) {}
  }, [location.search]);

  useEffect(() => {
    const onUpdate = () => {
      setLogo(resolveAcademyLogo());
      setAcademyName(getAcademyName());
    };
    window.addEventListener('branding:updated', onUpdate);
    return () => window.removeEventListener('branding:updated', onUpdate);
  }, []);

  useEffect(() => {
    // Check if already logged in
    const token = localStorage.getItem('member_token');
    if (token && !requestedTenant) {
      navigate('/member-dashboard');
    }
  }, [navigate, requestedTenant]);

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

  const doLogin = async (phoneValue, codeValue, { silent = false } = {}) => {
    setLoginError('');
    const ph = (phoneValue || '').trim();
    const code = (codeValue || '').trim();
    if (!ph) {
      if (!silent) setLoginError('يرجى إدخال رقم الجوال');
      return false;
    }
    if (!code) {
      if (!silent) setLoginError('يرجى إدخال رقم العضوية');
      return false;
    }

    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/member-portal/login`, {
        phone: ph,
        member_code: code,
      }, {
        // The fixed native domain can't reveal the tenant via host, so bind
        // this request to the academy the member just confirmed.
        headers: { 'X-Tenant-Slug': getTenantSlug() },
        timeout: 15000,
      });

      localStorage.setItem('member_token', response.data.access_token);
      localStorage.setItem('member_data', JSON.stringify(response.data.member));
      const savedLang = response.data.member?.language;
      localStorage.setItem('member_language', savedLang === 'en' ? 'en' : 'ar');
      // Remember the phone (scoped to this tenant) for one-tap return logins.
      if (rememberIdentity) {
        setRememberedMemberPhone(ph);
        try { localStorage.setItem(identityKey, JSON.stringify({ code, phone: ph })); } catch {}
      } else {
        clearRememberedMemberPhone();
        try { localStorage.removeItem(identityKey); } catch {}
      }

      toast.success(`مرحباً ${response.data.member.name_ar}`);
      navigate('/member-dashboard');
      return true;
    } catch (error) {
      // A remembered phone can become invalid (member removed / phone changed).
      // Drop it so we don't keep retrying and let the member type a new one.
      if ([400, 401, 404].includes(error.response?.status)) {
        clearRememberedMemberPhone();
        if (!silent) setLoginError('رقم العضوية أو الجوال غير صحيح لهذه الأكاديمية. راجع البيانات أو اختر أكاديميتك من جديد.');
      } else if (!silent) {
        setLoginError(error.code === 'ECONNABORTED'
          ? 'استغرق الاتصال وقتًا طويلًا. تحقق من الإنترنت ثم حاول مرة أخرى.'
          : !error.response
            ? 'تعذّر الاتصال. تحقق من الإنترنت ثم حاول مرة أخرى.'
            : 'تعذّر تسجيل الدخول الآن. حاول مرة أخرى بعد قليل.');
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    // Native autofill can update the inputs without firing React onChange.
    const values = new FormData(e.currentTarget);
    const submittedPhone = String(values.get('phone') || '').trim();
    const submittedCode = String(values.get('member_code') || '').trim();
    setPhone(submittedPhone);
    setMemberCode(submittedCode);
    doLogin(submittedPhone, submittedCode);
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      if (!navigator.onLine) throw new Error('offline');
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.update();
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      toast.success('تم فحص التحديثات. أعد فتح التطبيق إذا استمرت المشكلة.');
    } catch {
      toast.error('تعذّر فحص التحديثات. تحقق من اتصال الإنترنت.');
    } finally { setCheckingUpdate(false); }
  };

  // The picker just verified both values against the selected academy.
  // Auto-login only for that one navigation, never from a remembered phone.
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (localStorage.getItem('member_token')) return;
    const verifiedCode = location.state?.verifiedMemberCode;
    const verifiedPhone = location.state?.verifiedPhone;
    if (!verifiedCode || !verifiedPhone) return;
    setFormVisible(true);
    doLogin(verifiedPhone, verifiedCode, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {showSplash && <SplashScreen onComplete={handleSplashComplete} logo={logo} academyName={academyName} />}
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
                    {academyName && (
                      <p className="text-white/80 mt-2 text-sm px-4">{academyName}</p>
                    )}
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
                      <label htmlFor="member-phone-login" className="text-sm font-medium text-white/90">رقم الجوال</label>
                      <div className="relative">
                        <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/50" />
                        <Input
                          type="tel"
                          id="member-phone-login"
                          name="phone"
                          autoComplete="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="05xxxxxxxx"
                          className="pr-10 text-lg h-14 text-center tracking-wider bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20 transition-colors"
                          dir="ltr"
                          data-testid="member-phone-input"
                        />
                      </div>
                      <p className="text-xs text-white/50 text-center">أدخل رقم الجوال المسجل في هذه الأكاديمية</p>
                    </motion.div>
                    <div className="space-y-2">
                      <label htmlFor="member-code-login" className="text-sm font-medium text-white/90">رقم العضوية</label>
                      <Input
                        id="member-code-login"
                        name="member_code"
                        type="text"
                        value={memberCode}
                        onChange={(e) => setMemberCode(e.target.value)}
                        placeholder="مثلاً: ABTL-042"
                        autoComplete="off"
                        className="text-lg h-14 text-center bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/20"
                        dir="ltr"
                        data-testid="member-code-input"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-white/80">
                      <input type="checkbox" checked={rememberIdentity} disabled={loading} onChange={(e) => {
                        setRememberIdentity(e.target.checked);
                        if (!e.target.checked) {
                          clearRememberedMemberPhone();
                          try { localStorage.removeItem(identityKey); } catch {}
                        }
                      }} />
                      تذكر رقم العضوية والجوال على هذا الجهاز
                    </label>
                    {loginError && <p role="alert" className="rounded-lg bg-red-950/70 p-3 text-sm text-red-100">{loginError}</p>}
                    
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
                  <button type="button" className="mt-5 w-full text-sm text-white/80 underline" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen}>
                    تواجه مشكلة في الدخول؟
                  </button>
                  {helpOpen && <div className="mt-3 space-y-3 rounded-lg bg-white/10 p-4 text-sm text-white/90">
                    <p>اكتب رقم العضوية كما يظهر في بطاقتك، واستخدم رقم الجوال المسجل لدى الأكاديمية.</p>
                    <button type="button" className="block underline" onClick={() => navigate('/academy-picker')}>اختيار الأكاديمية من جديد</button>
                    <button type="button" className="block underline" onClick={checkUpdate} disabled={checkingUpdate}>{checkingUpdate ? 'جارٍ فحص التحديثات…' : 'فحص تحديث التطبيق'}</button>
                    <a className="block underline" href={`https://adaa-alabtal.com/member-login?tenant=${encodeURIComponent(requestedTenant || getTenantSlug())}`} target="_blank" rel="noreferrer">فتح الدخول في المتصفح</a>
                    {(requestedTenant || getTenantSlug()) === 'default' && <a className="block underline" href="https://wa.me/966566238384" target="_blank" rel="noreferrer">التواصل مع خدمة العملاء</a>}
                  </div>}
                  <p className="mt-4 text-center text-xs text-white/50">إصدار الواجهة {WEB_RELEASE}</p>
                </CardContent>
              </Card>

              {/* Footer */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-center text-white/50 text-sm mt-6 px-4"
              >
                © 2026 {academyName || 'Member Portal'}
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MemberLogin;
