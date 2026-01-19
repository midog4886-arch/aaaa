import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Set up axios interceptor to add token
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth API
export const authAPI = {
  login: (username, password) => axios.post(`${API}/auth/login`, { username, password }),
  register: (data) => axios.post(`${API}/auth/register`, data),
  getMe: () => axios.get(`${API}/auth/me`),
};

// Activities API
export const activitiesAPI = {
  getAll: () => axios.get(`${API}/activities`),
  create: (data) => axios.post(`${API}/activities`, data),
  update: (id, data) => axios.put(`${API}/activities/${id}`, data),
  delete: (id) => axios.delete(`${API}/activities/${id}`),
};

// Coaches API
export const coachesAPI = {
  getAll: () => axios.get(`${API}/coaches`),
  create: (data) => axios.post(`${API}/coaches`, data),
  update: (id, data) => axios.put(`${API}/coaches/${id}`, data),
  delete: (id) => axios.delete(`${API}/coaches/${id}`),
};

// Members API
export const membersAPI = {
  getAll: (params = {}) => axios.get(`${API}/members`, { params }),
  getById: (id) => axios.get(`${API}/members/${id}`),
  create: (data) => axios.post(`${API}/members`, data),
  update: (id, data) => axios.put(`${API}/members/${id}`, data),
  delete: (id) => axios.delete(`${API}/members/${id}`),
  addActivity: (memberId, activity) => axios.post(`${API}/members/${memberId}/activities`, activity),
  updateActivity: (memberId, activityId, activity) => axios.put(`${API}/members/${memberId}/activities/${activityId}`, activity),
};

// Invoices API
export const invoicesAPI = {
  getAll: (params = {}) => axios.get(`${API}/invoices`, { params }),
  getById: (id) => axios.get(`${API}/invoices/${id}`),
  create: (data) => axios.post(`${API}/invoices`, data),
  update: (id, data) => axios.put(`${API}/invoices/${id}`, data),
  pay: (id) => axios.put(`${API}/invoices/${id}/pay`),
  cancel: (id) => axios.put(`${API}/invoices/${id}/cancel`),
  restore: (id) => axios.put(`${API}/invoices/${id}/restore`),
  refund: (id, data) => axios.post(`${API}/invoices/${id}/refund`, data),
  delete: (id) => axios.delete(`${API}/invoices/${id}`),
  search: (params = {}) => axios.get(`${API}/invoices/search`, { params }),
  getQR: (id) => axios.get(`${API}/invoices/${id}/qr`),
};

// Products/Inventory API
export const productsAPI = {
  getAll: () => axios.get(`${API}/products`),
  create: (data) => axios.post(`${API}/products`, data),
  update: (id, data) => axios.put(`${API}/products/${id}`, data),
  delete: (id) => axios.delete(`${API}/products/${id}`),
  updateStock: (id, quantity) => axios.put(`${API}/products/${id}/stock`, null, { params: { quantity_change: quantity } }),
  getLowStock: () => axios.get(`${API}/products/low-stock`),
};

// Discounts/Coupons API
export const discountsAPI = {
  getAll: () => axios.get(`${API}/discounts`),
  create: (data) => axios.post(`${API}/discounts`, data),
  update: (id, data) => axios.put(`${API}/discounts/${id}`, data),
  delete: (id) => axios.delete(`${API}/discounts/${id}`),
  validate: (code, subtotal) => axios.post(`${API}/discounts/validate`, null, { params: { code, subtotal } }),
};

// Payments API
export const paymentsAPI = {
  createCheckout: (invoiceId) => axios.post(`${API}/payments/checkout?invoice_id=${invoiceId}`),
  getStatus: (sessionId) => axios.get(`${API}/payments/status/${sessionId}`),
};

// Reports API
export const reportsAPI = {
  getFinancial: (params = {}) => axios.get(`${API}/reports/financial`, { params }),
  getExpiringSubscriptions: (days = 7) => axios.get(`${API}/reports/expiring-subscriptions`, { params: { days } }),
};

// Dashboard API
export const dashboardAPI = {
  getStats: () => axios.get(`${API}/dashboard/stats`),
};

// Seed API
export const seedAPI = {
  seed: () => axios.post(`${API}/seed`),
};

// Branches API
export const branchesAPI = {
  getAll: () => axios.get(`${API}/branches`),
  getById: (id) => axios.get(`${API}/branches/${id}`),
  create: (data) => axios.post(`${API}/branches`, data),
  update: (id, data) => axios.put(`${API}/branches/${id}`, data),
  delete: (id) => axios.delete(`${API}/branches/${id}`),
};

// Export API
export const exportAPI = {
  members: (params = {}) => `${API}/export/members?format=xlsx&${new URLSearchParams(params).toString()}`,
  invoices: (params = {}) => `${API}/export/invoices?format=xlsx&${new URLSearchParams(params).toString()}`,
  reports: (params = {}) => `${API}/export/reports?format=xlsx&${new URLSearchParams(params).toString()}`,
  allData: () => `${API}/export/all-data`,
};

export default {
  auth: authAPI,
  activities: activitiesAPI,
  coaches: coachesAPI,
  members: membersAPI,
  invoices: invoicesAPI,
  payments: paymentsAPI,
  reports: reportsAPI,
  dashboard: dashboardAPI,
  seed: seedAPI,
  branches: branchesAPI,
  export: exportAPI,
  get: (url) => axios.get(`${API}${url}`),
  post: (url, data) => axios.post(`${API}${url}`, data),
  put: (url, data) => axios.put(`${API}${url}`, data),
  delete: (url) => axios.delete(`${API}${url}`),
};
