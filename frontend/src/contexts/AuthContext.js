import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [selectedBranchId, setSelectedBranchId] = useState(() => localStorage.getItem('selectedBranchId') || 'all');

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchUser = async () => {
    try {
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
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
      switchBranch
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
