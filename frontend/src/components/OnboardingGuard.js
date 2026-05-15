import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { tenantAPI } from '../services/api';

const OnboardingGuard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isAuthenticated } = useAuth();
  const confirmedCompletedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    if (location.pathname === '/admin/onboarding') return;
    if (confirmedCompletedRef.current) return;
    const slug = (typeof window !== 'undefined' && localStorage.getItem('tenant_slug')) || 'default';
    if (slug === 'default') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await tenantAPI.getOnboardingStatus();
        if (cancelled) return;
        if (res?.data && res.data.completed === false) {
          navigate('/admin/onboarding', { replace: true });
        } else if (res?.data?.completed === true) {
          confirmedCompletedRef.current = true;
        }
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isAdmin, location.pathname, navigate, user?.id]);

  return null;
};

export default OnboardingGuard;
