import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { PartyPopper, Users, Activity, UserPlus, ArrowRight } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { notificationsAPI } from '../services/api';

const STORAGE_KEY = 'onboarding_welcome_dismissed_at';

const ICONS = {
  '/admin/members': Users,
  '/admin/activities': Activity,
  '/admin/users': UserPlus,
};

const WelcomeOnboardingDialog = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { isAdmin, isAuthenticated } = useAuth();
  const isAr = language === 'ar';
  const [open, setOpen] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    if (checkedRef.current) return;
    const slug = (typeof window !== 'undefined' && localStorage.getItem('tenant_slug')) || 'default';
    if (slug === 'default') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await notificationsAPI.getAll({ is_read: false, tag: 'onboarding_welcome', limit: 5 });
        if (cancelled) return;
        checkedRef.current = true;
        const list = Array.isArray(res?.data) ? res.data : [];
        const hit = list[0];
        if (!hit) return;
        const dismissedId = localStorage.getItem(STORAGE_KEY);
        if (dismissedId && dismissedId === hit.id) return;
        setWelcome(hit);
        setOpen(true);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isAdmin]);

  const dismiss = async (alsoNavigateTo = null) => {
    setOpen(false);
    if (welcome?.id) {
      try { localStorage.setItem(STORAGE_KEY, welcome.id); } catch (e) {}
      try { await notificationsAPI.markAsRead(welcome.id); } catch (e) {}
    }
    if (alsoNavigateTo) navigate(alsoNavigateTo);
  };

  if (!welcome) return null;

  const actions = Array.isArray(welcome.actions) && welcome.actions.length > 0
    ? welcome.actions
    : [
        { label_ar: 'إضافة أعضاء', label_en: 'Add members', link: '/admin/members' },
        { label_ar: 'إعداد الأنشطة', label_en: 'Set up activities', link: '/admin/activities' },
        { label_ar: 'دعوة المستخدمين', label_en: 'Invite users', link: '/admin/users' },
      ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent
        dir={isAr ? 'rtl' : 'ltr'}
        className="sm:max-w-lg p-0 overflow-hidden border-0"
      >
        <div className="bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white px-6 py-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-3 animate-bounce">
            <PartyPopper className="w-9 h-9" />
          </div>
          <h2 className="text-2xl font-bold">
            {welcome.title || (isAr ? 'أهلاً بك في أكاديميتك!' : 'Welcome to your academy!')}
          </h2>
          <p className="mt-2 text-white/90 leading-relaxed text-sm">
            {welcome.message || (isAr ? 'اكتمل إعداد الأكاديمية بنجاح.' : 'Your academy setup is complete.')}
          </p>
        </div>

        <div className="px-6 py-5 bg-white">
          <div className="text-sm font-semibold text-slate-700 mb-3">
            {isAr ? 'الخطوات التالية المقترحة' : 'Suggested next steps'}
          </div>
          <div className="space-y-2">
            {actions.map((a, idx) => {
              const Icon = ICONS[a.link] || ArrowRight;
              const label = isAr ? (a.label_ar || a.label_en) : (a.label_en || a.label_ar);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => dismiss(a.link)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50 transition text-start"
                >
                  <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="font-medium text-slate-800 flex-1">{label}</span>
                  <ArrowRight className={`w-4 h-4 text-slate-400 ${isAr ? 'rotate-180' : ''}`} />
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex justify-end">
            <Button variant="ghost" onClick={() => dismiss()}>
              {isAr ? 'إغلاق' : 'Dismiss'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WelcomeOnboardingDialog;
