import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [selectedBranchId, setSelectedBranchId] = useState(() => localStorage.getItem('selectedBranchId') || 'all');
  const [disabledFeatures, setDisabledFeatures] = useState([]);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(`${API}/tenant/features`);
        if (!cancelled) setDisabledFeatures(Array.isArray(r.data?.disabled_features) ? r.data.disabled_features : []);
      } catch (_) {
        if (!cancelled) setDisabledFeatures([]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const isFeatureEnabled = (key) => !key || !disabledFeatures.includes(key);

  // Resolve the list of branches a non-admin user is allowed to view, falling
  // back to the legacy single branch_id. Admins are not branch scoped.
  const getAllowedBranchIds = (userData) => {
    if (!userData || userData.is_admin === true) return [];
    const ids = Array.isArray(userData.branch_ids) ? userData.branch_ids.filter(Boolean) : [];
    if (ids.length) return ids;
    return userData.branch_id ? [userData.branch_id] : [];
  };

  // Pick the active branch for a non-admin: keep the persisted choice if it's
  // still one of their branches, otherwise default to the first allowed branch.
  const applyBranchDefault = (userData) => {
    const ids = getAllowedBranchIds(userData);
    if (ids.length === 0) return;
    const stored = localStorage.getItem('selectedBranchId');
    const next = stored && ids.includes(stored) ? stored : ids[0];
    setSelectedBranchId(next);
    localStorage.setItem('selectedBranchId', next);
  };

  const fetchUser = async () => {
    try {
      const response = await axios.get(`${API}/auth/me`);
      const userData = response.data;
      setUser(userData);
      applyBranchDefault(userData);
    } catch (error) {
      console.error('Failed to fetch user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      const response = await axios.post(`${API}/auth/login`, { username, password });
      const { access_token, user: userData } = response.data;
      
      localStorage.setItem('token', access_token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      
      setToken(access_token);
      setUser(userData);
      applyBranchDefault(userData);
      return { success: true };
    } catch (error) {
      console.error('Login failed:', error);
      return {
        success: false,
        error: error.response?.data?.detail || 'Login failed',
        detail: error.response?.data?.detail || '',
        tenant_status: error.response?.data?.tenant_status || '',
        status: error.response?.status,
      };
    }
  };

  const logout = () => {
    // Fire-and-forget audit ping. We must send it *before* clearing the
    // Authorization header, but we don't await it — the user should see
    // the logout happen instantly even if the network is slow/offline.
    try {
      if (axios.defaults.headers.common['Authorization']) {
        axios.post(`${API}/auth/logout`).catch(() => {});
      }
    } catch (_) {
      // ignore — logout must always succeed client-side
    }
    localStorage.removeItem('token');
    localStorage.removeItem('selectedBranchId');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
    setSelectedBranchId('all');
  };

  const switchBranch = (branchId) => {
    setSelectedBranchId(branchId);
    localStorage.setItem('selectedBranchId', branchId);
  };

  const isAuthenticated = !!token && !!user;
  const isAdmin = user?.is_admin === true;
  const allowedBranchIds = getAllowedBranchIds(user);
  const isMultiBranch = !isAdmin && allowedBranchIds.length > 1;

  return (
    <AuthContext.Provider value={{ 
      user, 
      token, 
      login, 
      logout, 
      loading, 
      isAuthenticated,
      isAdmin,
      selectedBranchId,
      switchBranch,
      allowedBranchIds,
      isMultiBranch,
      disabledFeatures,
      isFeatureEnabled
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export default AuthContext;
