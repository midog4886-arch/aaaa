import axios from 'axios';

// Backend API URL - Points to Emergent backend
const API_URL = 'https://champions-sports.preview.emergentagent.com';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('member_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Member Portal APIs
export const memberAPI = {
  login: (phone) => api.post('/api/member/login', { phone }),
  verifyOTP: (phone, otp) => api.post('/api/member/verify-otp', { phone, otp }),
  getProfile: () => api.get('/api/member/profile'),
  getDashboard: () => api.get('/api/member/dashboard'),
  getSubscriptions: () => api.get('/api/member/subscriptions'),
  getAttendance: () => api.get('/api/member/attendance'),
  getInvoices: () => api.get('/api/member/invoices'),
  getSchedule: () => api.get('/api/member/schedule'),
  getNotifications: () => api.get('/api/member/notifications'),
  markNotificationRead: (id) => api.put(`/api/member/notifications/${id}/read`),
  getAds: () => api.get('/api/member/ads'),
  getDailyVideos: () => api.get('/api/member/daily-videos'),
  getLoyalty: () => api.get('/api/member/loyalty'),
  getRegistrationForms: () => api.get('/api/member/registration-forms'),
  rateCoach: (data) => api.post('/api/member/rate-coach', data),
  getQRCard: () => api.get('/api/member/qr-card'),
};

// Public APIs (no auth required)
export const publicAPI = {
  getMemberCard: (code) => api.get(`/api/public/member-card/${code}`),
};

export default api;
