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
  getAll: (params = {}) => axios.get(`${API}/activities`, { params }),
  create: (data) => axios.post(`${API}/activities`, data),
  update: (id, data) => axios.put(`${API}/activities/${id}`, data),
  delete: (id) => axios.delete(`${API}/activities/${id}`),
};

// Coaches API
export const coachesAPI = {
  getAll: (params = {}) => axios.get(`${API}/coaches`, { params }),
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
  getAll: (params = {}) => axios.get(`${API}/products`, { params }),
  create: (data) => axios.post(`${API}/products`, data),
  update: (id, data) => axios.put(`${API}/products/${id}`, data),
  delete: (id) => axios.delete(`${API}/products/${id}`),
  updateStock: (id, quantity) => axios.put(`${API}/products/${id}/stock`, null, { params: { quantity_change: quantity } }),
  getLowStock: () => axios.get(`${API}/products/low-stock`),
};

// Discounts/Coupons API
export const discountsAPI = {
  getAll: (params = {}) => axios.get(`${API}/discounts`, { params }),
  create: (data) => axios.post(`${API}/discounts`, data),
  update: (id, data) => axios.put(`${API}/discounts/${id}`, data),
  delete: (id) => axios.delete(`${API}/discounts/${id}`),
  validate: (code, subtotal) => axios.post(`${API}/discounts/validate`, null, { params: { code, subtotal } }),
};

// Product Invoices API (Store Sales)
export const productInvoicesAPI = {
  getAll: (params = {}) => axios.get(`${API}/product-invoices`, { params }),
  create: (data) => axios.post(`${API}/product-invoices`, data),
  update: (id, data) => axios.put(`${API}/product-invoices/${id}`, data),
  delete: (id) => axios.delete(`${API}/product-invoices/${id}`),
};

// Registration Forms API
export const registrationFormsAPI = {
  getAll: (params = {}) => axios.get(`${API}/registration-forms`, { params }),
  getById: (id) => axios.get(`${API}/registration-forms/${id}`),
  create: (data) => axios.post(`${API}/registration-forms`, data),
  update: (id, data) => axios.put(`${API}/registration-forms/${id}`, data),
  convert: (id) => axios.put(`${API}/registration-forms/${id}/convert`),
  delete: (id) => axios.delete(`${API}/registration-forms/${id}`),
};

// Credit Notes (Refund Invoices) API
export const creditNotesAPI = {
  getAll: (params = {}) => axios.get(`${API}/credit-notes`, { params }),
  getById: (id) => axios.get(`${API}/credit-notes/${id}`),
  getQR: (id) => axios.get(`${API}/credit-notes/${id}/qr`),
  delete: (id) => axios.delete(`${API}/credit-notes/${id}`),
};

// Payments API
export const paymentsAPI = {
  createCheckout: (invoiceId) => axios.post(`${API}/payments/checkout?invoice_id=${invoiceId}`),
  getStatus: (sessionId) => axios.get(`${API}/payments/status/${sessionId}`),
};

// Reports API
export const reportsAPI = {
  getFinancial: (params = {}) => axios.get(`${API}/reports/financial`, { params }),
  getExpiringSubscriptions: (days = 7, branchFilter = null) => {
    const params = { days };
    if (branchFilter && branchFilter !== 'all') params.branch_filter = branchFilter;
    return axios.get(`${API}/reports/expiring-subscriptions`, { params });
  },
};

// Dashboard API
export const dashboardAPI = {
  getStats: (params = {}) => axios.get(`${API}/dashboard/stats`, { params }),
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

// Chart of Accounts API
export const accountsAPI = {
  getAll: (params = {}) => axios.get(`${API}/accounts`, { params }),
  create: (data) => axios.post(`${API}/accounts`, data),
  update: (id, data) => axios.put(`${API}/accounts/${id}`, data),
  delete: (id) => axios.delete(`${API}/accounts/${id}`),
  seedDefault: () => axios.post(`${API}/accounts/seed-default`),
};

// Suppliers API
export const suppliersAPI = {
  getAll: (params = {}) => axios.get(`${API}/suppliers`, { params }),
  getById: (id) => axios.get(`${API}/suppliers/${id}`),
  create: (data) => axios.post(`${API}/suppliers`, data),
  update: (id, data) => axios.put(`${API}/suppliers/${id}`, data),
  delete: (id) => axios.delete(`${API}/suppliers/${id}`),
  getStatement: (id, params = {}) => axios.get(`${API}/suppliers/${id}/statement`, { params }),
};

// Purchase Invoices API
export const purchaseInvoicesAPI = {
  getAll: (params = {}) => axios.get(`${API}/purchase-invoices`, { params }),
  getById: (id) => axios.get(`${API}/purchase-invoices/${id}`),
  create: (data) => axios.post(`${API}/purchase-invoices`, data),
  update: (id, data) => axios.put(`${API}/purchase-invoices/${id}`, data),
  delete: (id) => axios.delete(`${API}/purchase-invoices/${id}`),
};

// Supplier Payments API
export const supplierPaymentsAPI = {
  getAll: (params = {}) => axios.get(`${API}/supplier-payments`, { params }),
  create: (data) => axios.post(`${API}/supplier-payments`, data),
};

// Journal Entries API
export const journalEntriesAPI = {
  getAll: (params = {}) => axios.get(`${API}/journal-entries`, { params }),
  getById: (id) => axios.get(`${API}/journal-entries/${id}`),
  create: (data) => axios.post(`${API}/journal-entries`, data),
  update: (id, data) => axios.put(`${API}/journal-entries/${id}`, data),
  delete: (id) => axios.delete(`${API}/journal-entries/${id}`),
};

// Accounting Reports API
export const accountingReportsAPI = {
  getJournalEntriesReport: (params = {}) => axios.get(`${API}/reports/journal-entries`, { params }),
  getSuppliersBalance: (params = {}) => axios.get(`${API}/reports/suppliers-balance`, { params }),
  getPurchasesReport: (params = {}) => axios.get(`${API}/reports/purchases`, { params }),
  getSalesReport: (params = {}) => axios.get(`${API}/reports/sales`, { params }),
  getVatReport: (params = {}) => axios.get(`${API}/reports/vat`, { params }),
};

// Export Accounting API
export const exportAccountingAPI = {
  sales: (params = {}) => `${API}/export/sales?${new URLSearchParams(params).toString()}`,
  purchases: (params = {}) => `${API}/export/purchases?${new URLSearchParams(params).toString()}`,
  vat: (params = {}) => `${API}/export/vat?${new URLSearchParams(params).toString()}`,
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
  accounts: accountsAPI,
  suppliers: suppliersAPI,
  purchaseInvoices: purchaseInvoicesAPI,
  supplierPayments: supplierPaymentsAPI,
  journalEntries: journalEntriesAPI,
  accountingReports: accountingReportsAPI,
  exportAccounting: exportAccountingAPI,
  get: (url) => axios.get(`${API}${url}`),
  post: (url, data) => axios.post(`${API}${url}`, data),
  put: (url, data) => axios.put(`${API}${url}`, data),
  delete: (url) => axios.delete(`${API}${url}`),
};
