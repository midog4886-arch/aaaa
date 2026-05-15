import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { tenantAPI } from '../services/api';

const OnboardingGuard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isAuthenticated } = useAuth();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    if (checkedRef.current) return;
    if (location.pathname === '/admin/onboarding') return;
    const slug = (typeof window !== 'undefined' && localStorage.getItem('tenant_slug')) || 'default';
    if (slug === 'default') return;
    checkedRef.current = true;
    (async () => {
      try {
        const res = await tenantAPI.getOnboardingStatus();
        if (res?.data && res.data.completed === false) {
          navigate('/admin/onboarding', { replace: true });
        }
      } catch (e) {}
    })();
  }, [isAuthenticated, isAdmin, location.pathname, navigate, user?.id]);

  return null;
};

export default OnboardingGuard;
