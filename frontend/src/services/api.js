import axios from 'axios';

const API = '/api';

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
  getMemberCounts: () => axios.get(`${API}/activities/member-counts`),
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

// Levels API
export const levelsAPI = {
  getAll: (params = {}) => axios.get(`${API}/levels`, { params }),
  create: (data) => axios.post(`${API}/levels`, data),
  update: (id, data) => axios.put(`${API}/levels/${id}`, data),
  delete: (id) => axios.delete(`${API}/levels/${id}`),
  addMember: (levelId, memberId) => axios.post(`${API}/levels/${levelId}/members/${memberId}`),
  removeMember: (levelId, memberId) => axios.delete(`${API}/levels/${levelId}/members/${memberId}`),
  getMemberCount: (levelId) => axios.get(`${API}/levels/${levelId}/count`),
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
  toggleCheck: (id) => axios.post(`${API}/invoices/${id}/toggle-check`),
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
  toggleCheck: (id) => axios.post(`${API}/registration-forms/${id}/toggle-check`),
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
  getSettings: () => axios.get(`${API}/dashboard/settings`),
  saveSettings: (data) => axios.put(`${API}/dashboard/settings`, data),
};

// Global Search API
export const globalSearchAPI = {
  search: (q) => axios.get(`${API}/global-search`, { params: { q } }),
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
  membersPdf: (params = {}) => `${API}/export/members-pdf?${new URLSearchParams(params).toString()}`,
  invoices: (params = {}) => `${API}/export/invoices?format=xlsx&${new URLSearchParams(params).toString()}`,
  invoicesPdf: (params = {}) => `${API}/export/invoices-pdf?${new URLSearchParams(params).toString()}`,
  reports: (params = {}) => `${API}/export/reports?format=xlsx&${new URLSearchParams(params).toString()}`,
  allData: () => `${API}/export/all-data`,
};

// Backup API
export const backupAPI = {
  create: () => axios.post(`${API}/backup/create?token=${localStorage.getItem('token')}`),
  list: () => axios.get(`${API}/backup/list?token=${localStorage.getItem('token')}`),
  download: (filename) => `${API}/backup/download/${filename}?token=${localStorage.getItem('token')}`,
  restore: (filename) => axios.post(`${API}/backup/restore/${filename}?token=${localStorage.getItem('token')}`),
  delete: (filename) => axios.delete(`${API}/backup/${filename}?token=${localStorage.getItem('token')}`),
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/backup/upload?token=${localStorage.getItem('token')}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
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
  internalExpenses: (params = {}) => `${API}/export/internal-expenses?${new URLSearchParams(params).toString()}`,
};

// Notifications API
export const notificationsAPI = {
  getAll: (params = {}) => axios.get(`${API}/notifications`, { params }),
  getUnreadCount: () => axios.get(`${API}/notifications/unread-count`),
  markAsRead: (id) => axios.put(`${API}/notifications/${id}/read`),
  markAllAsRead: () => axios.put(`${API}/notifications/mark-all-read`),
  delete: (id) => axios.delete(`${API}/notifications/${id}`),
  checkRenewals: () => axios.post(`${API}/notifications/check-renewals`),
  getExpiringSubscriptions: (params = {}) => axios.get(`${API}/notifications/expiring-subscriptions`, { params }),
  checkAdsExpiry: () => axios.post(`${API}/notifications/check-ads-expiry`),
  getAdsStatus: () => axios.get(`${API}/notifications/ads-status`)
};

// Internal Expenses (Petty Cash) API
export const internalExpensesAPI = {
  getAll: (params = {}) => axios.get(`${API}/internal-expenses`, { params }),
  getSummary: (params = {}) => axios.get(`${API}/internal-expenses/summary`, { params }),
  getTypes: () => axios.get(`${API}/internal-expenses/types`),
  create: (formData) => axios.post(`${API}/internal-expenses`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update: (id, formData) => axios.put(`${API}/internal-expenses/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  updateStatus: (id, status) => axios.put(`${API}/internal-expenses/${id}/status`, null, { params: { status } }),
  postToAccounting: (data) => axios.post(`${API}/internal-expenses/post-to-accounting`, data),
  delete: (id) => axios.delete(`${API}/internal-expenses/${id}`),
};

// Internal Expense Payments API (مدفوعات المصروفات الداخلية)
export const internalExpensePaymentsAPI = {
  getAll: (params = {}) => axios.get(`${API}/internal-expense-payments`, { params }),
  getSummary: (params = {}) => axios.get(`${API}/internal-expense-payments/summary`, { params }),
  create: (formData) => axios.post(`${API}/internal-expense-payments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update: (id, formData) => axios.put(`${API}/internal-expense-payments/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  delete: (id) => axios.delete(`${API}/internal-expense-payments/${id}`),
};

// Attendance API
export const attendanceAPI = {
  getAll: (params = {}) => axios.get(`${API}/attendance`, { params }),
  getByActivity: (activityId, date) => axios.get(`${API}/attendance/by-activity/${activityId}`, { params: { date } }),
  record: (data) => axios.post(`${API}/attendance`, data),
  recordBulk: (data) => axios.post(`${API}/attendance/bulk`, data),
  quickSearch: (searchTerm) => axios.get(`${API}/attendance/quick-search/${encodeURIComponent(searchTerm)}`),
  quickSearchMulti: (searchTerm) => axios.get(`${API}/attendance/quick-search-multi/${encodeURIComponent(searchTerm)}`),
  quickAttendance: (memberCode, activityId) => axios.post(`${API}/attendance/quick?member_code=${memberCode}&activity_id=${activityId}`),
  qrCheckin: (memberCode, activityId, force = false) => {
    let url = `${API}/attendance/qr-checkin?member_code=${encodeURIComponent(memberCode)}`;
    if (activityId) url += `&activity_id=${encodeURIComponent(activityId)}`;
    if (force) url += `&force=true`;
    return axios.post(url);
  },
  getMemberReport: (memberId, params = {}) => axios.get(`${API}/attendance/member/${memberId}/report`, { params }),
  getActivityReport: (activityId, params = {}) => axios.get(`${API}/attendance/activity/${activityId}/report`, { params }),
  getSessionQuota: (memberId, activityId) => {
    let url = `${API}/attendance/session-quota/${memberId}`;
    if (activityId) url += `?activity_id=${encodeURIComponent(activityId)}`;
    return axios.get(url);
  },
  getSessionQuotaAlerts: (branchFilter) => axios.get(`${API}/attendance/session-quota-alerts`, { params: { branch_filter: branchFilter } }),
  delete: (id) => axios.delete(`${API}/attendance/${id}`),
  export: (params = {}) => {
    const token = localStorage.getItem('token');
    const queryParams = new URLSearchParams({ token, ...params }).toString();
    return `${API}/export/attendance?${queryParams}`;
  },
  exportSummary: (params = {}) => {
    const token = localStorage.getItem('token');
    const queryParams = new URLSearchParams({ token, ...params }).toString();
    return `${API}/export/attendance?${queryParams}`;
  }
};

// Schedule/Timetable API
export const schedulesAPI = {
  getAll: (params = {}) => axios.get(`${API}/schedules`, { params }),
  getWeekly: (params = {}) => axios.get(`${API}/schedules/weekly`, { params }),
  getActivitiesWithMembers: (params = {}) => axios.get(`${API}/schedules/activities-with-members`, { params }),
  getByActivity: (activityId) => axios.get(`${API}/schedules/by-activity/${activityId}`)
};

// Activity Notes API
export const activityNotesAPI = {
  create: (data) => axios.post(`${API}/activity-notes`, data),
  getByActivity: (activityId) => axios.get(`${API}/activity-notes/${activityId}`),
  getCounts: () => axios.get(`${API}/activity-notes/counts/all`),
  getRecent: (limit = 10) => axios.get(`${API}/activity-notes/recent`, { params: { limit } }),
  delete: (noteId) => axios.delete(`${API}/activity-notes/${noteId}`)
};

// Bank Reports API
export const bankReportsAPI = {
  getAll: (params = {}) => axios.get(`${API}/bank-reports`, { params }),
  getByMonth: (month, year, branchId) => axios.get(`${API}/bank-reports/${month}/${year}`, { params: { branch_id: branchId } }),
  save: (data) => axios.post(`${API}/bank-reports`, data),
  delete: (id) => axios.delete(`${API}/bank-reports/${id}`)
};

// Advertisements API
export const advertisementsAPI = {
  getAll: (params = {}) => axios.get(`${API}/advertisements`, { params }),
  getPublic: (params = {}) => axios.get(`${API}/advertisements/public`, { params }),
  getById: (id) => axios.get(`${API}/advertisements/${id}`),
  create: (data) => axios.post(`${API}/advertisements`, data),
  update: (id, data) => axios.put(`${API}/advertisements/${id}`, data),
  delete: (id) => axios.delete(`${API}/advertisements/${id}`),
  uploadBanner: (formData) => axios.post(`${API}/advertisements/upload-banner`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  recordView: (id) => axios.post(`${API}/advertisements/${id}/view`),
  recordClick: (id) => axios.post(`${API}/advertisements/${id}/click`),
  toggle: (id) => axios.put(`${API}/advertisements/${id}/toggle`),
  getStats: (params = {}) => axios.get(`${API}/advertisements/stats/summary`, { params })
};

// Daily Videos API
export const dailyVideosAPI = {
  getAll: (params = {}) => axios.get(`${API}/daily-videos`, { params }),
  getById: (id) => axios.get(`${API}/daily-videos/${id}`),
  create: (data) => axios.post(`${API}/daily-videos`, data),
  update: (id, data) => axios.put(`${API}/daily-videos/${id}`, data),
  delete: (id) => axios.delete(`${API}/daily-videos/${id}`),
  getToday: (params = {}) => axios.get(`${API}/daily-videos/today`, { params }),
  getWeek: (params = {}) => axios.get(`${API}/daily-videos/week`, { params }),
  getByDate: (date, params = {}) => axios.get(`${API}/daily-videos/by-date/${date}`, { params }),
  getCalendar: (year, month, params = {}) => axios.get(`${API}/daily-videos/calendar/${year}/${month}`, { params }),
  getByActivity: (activityId, limit = 10) => axios.get(`${API}/daily-videos/activity/${activityId}/videos`, { params: { limit } }),
  recordView: (id) => axios.post(`${API}/daily-videos/${id}/view`),
  getStats: (params = {}) => axios.get(`${API}/daily-videos/stats/summary`, { params })
};

export const pushNotificationsAPI = {
  getSubscribersCount: () => axios.get(`${API}/push-notifications/subscribers-count`),
  getSubscribersList: () => axios.get(`${API}/push-notifications/subscribers-list`),
  broadcast: (data) => axios.post(`${API}/push-notifications/broadcast`, data),
  createMemberNotification: (data) => axios.post(`${API}/member-notifications`, data),
};

export const messagesAPI = {
  send: (data) => axios.post(`${API}/messages`, data),
  getAll: (params = {}) => axios.get(`${API}/messages`, { params }),
  getConversations: () => axios.get(`${API}/messages/conversations`),
  getThread: (memberId) => axios.get(`${API}/messages/thread/${memberId}`),
  reply: (memberId, data) => axios.post(`${API}/messages/thread/${memberId}/reply`, data),
  getUnreadCount: () => axios.get(`${API}/messages/unread-count`),
  delete: (id) => axios.delete(`${API}/messages/${id}`),
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
  notifications: notificationsAPI,
  messages: messagesAPI,
  dailyLedger: {
    getSummary: (date, branchFilter) => axios.get(`${API}/daily-ledger/summary`, { params: { date, branch_filter: branchFilter } }),
    getComparison: (date, branchFilter) => axios.get(`${API}/daily-ledger/comparison`, { params: { date, branch_filter: branchFilter } }),
    getCalendar: (month, branchFilter) => axios.get(`${API}/daily-ledger/calendar`, { params: { month, branch_filter: branchFilter } }),
    getExpenses: (params) => axios.get(`${API}/daily-ledger/expenses`, { params }),
    createExpense: (data) => axios.post(`${API}/daily-ledger/expenses`, data),
    updateExpense: (id, data) => axios.put(`${API}/daily-ledger/expenses/${id}`, data),
    deleteExpense: (id) => axios.delete(`${API}/daily-ledger/expenses/${id}`),
    getCategories: () => axios.get(`${API}/daily-ledger/categories`),
  },
  dayExtensions: {
    getClosures: () => axios.get(`${API}/day-extensions/closures`),
    createClosure: (data) => axios.post(`${API}/day-extensions/closures`, data),
    deleteClosure: (id) => axios.delete(`${API}/day-extensions/closures/${id}`),
    applyExtension: (data) => axios.post(`${API}/day-extensions/apply`, data),
    manualExtension: (data) => axios.post(`${API}/day-extensions/manual`, data),
    getLogs: () => axios.get(`${API}/day-extensions/logs`),
    getAvailableTimes: () => axios.get(`${API}/day-extensions/available-times`),
  },
  get: (url) => axios.get(`${API}${url}`),
  post: (url, data) => axios.post(`${API}${url}`, data),
  put: (url, data) => axios.put(`${API}${url}`, data),
  delete: (url) => axios.delete(`${API}${url}`),
};

export const freezesAPI = {
  create: (data) => axios.post(`${API}/freezes`, data),
  cancel: (freezeId) => axios.post(`${API}/freezes/${freezeId}/cancel`),
  getMemberFreezes: (memberId) => axios.get(`${API}/freezes/member/${memberId}`),
  getActiveFreezes: () => axios.get(`${API}/freezes/active`),
  getMemberStats: (memberId) => axios.get(`${API}/freezes/member/${memberId}/stats`),
};

export const paymentVouchersAPI = {
  getAll: (params = {}) => axios.get(`${API}/payment-vouchers`, { params }),
  getBeneficiaries: (params = {}) => axios.get(`${API}/payment-vouchers/beneficiaries`, { params }),
  create: (data) => axios.post(`${API}/payment-vouchers`, data),
  update: (id, data) => axios.put(`${API}/payment-vouchers/${id}`, data),
  updateStatus: (id, status) => axios.put(`${API}/payment-vouchers/${id}`, { status }),
  delete: (id) => axios.delete(`${API}/payment-vouchers/${id}`),
};

export const whatsappAPI = {
  getStatus: () => axios.get(`${API}/whatsapp/status`),
  getSettings: () => axios.get(`${API}/whatsapp/settings`),
  updateSettings: (data) => axios.put(`${API}/whatsapp/settings`, data),
  sendTest: (phone, message) => axios.post(`${API}/whatsapp/test`, { phone, message }),
  sendNow: () => axios.post(`${API}/whatsapp/send-now`),
  disconnect: () => axios.post(`${API}/whatsapp/disconnect`),
  getLogs: (limit = 50) => axios.get(`${API}/whatsapp/logs?limit=${limit}`),
  getTargetCount: () => axios.get(`${API}/whatsapp/target-count`),
};
