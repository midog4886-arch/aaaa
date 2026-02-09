// Company Information
export const COMPANY_INFO = {
  name_ar: "شركة اداء الابطال العالمية للرياضة",
  name_en: "Global Champions Sports Performance",
  tax_number: "312655637900003",
  commercial_reg: "7043630230",
  vat_rate: 15
};

// Invoice Terms
export const INVOICE_TERMS = {
  ar: [
    "الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك",
    "المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك"
  ],
  en: [
    "Subscription has fixed start and end dates. Missed sessions will not be compensated",
    "Paid amount is non-refundable after one week from subscription date"
  ]
};

// Payment Methods
export const PAYMENT_METHODS = [
  { value: 'cash', label_ar: 'نقداً', label_en: 'Cash' },
  { value: 'card', label_ar: 'بطاقة ائتمان', label_en: 'Credit Card' },
  { value: 'transfer', label_ar: 'تحويل بنكي', label_en: 'Bank Transfer' },
  { value: 'tabby', label_ar: 'تابي', label_en: 'Tabby' },
  { value: 'tamara', label_ar: 'تمارا', label_en: 'Tamara' }
];

// Invoice Statuses
export const INVOICE_STATUSES = {
  pending: { label_ar: 'غير مدفوعة', label_en: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  paid: { label_ar: 'مدفوعة', label_en: 'Paid', color: 'bg-green-100 text-green-800' },
  cancelled: { label_ar: 'ملغاة', label_en: 'Cancelled', color: 'bg-red-100 text-red-800' },
  refunded: { label_ar: 'مسترجعة', label_en: 'Refunded', color: 'bg-purple-100 text-purple-800' },
  partially_refunded: { label_ar: 'مسترجعة جزئياً', label_en: 'Partially Refunded', color: 'bg-orange-100 text-orange-800' }
};

// Days of the week
export const DAYS_OF_WEEK = [
  { value: 'الأحد', label: 'الأحد' },
  { value: 'الإثنين', label: 'الإثنين' },
  { value: 'الثلاثاء', label: 'الثلاثاء' },
  { value: 'الأربعاء', label: 'الأربعاء' },
  { value: 'الخميس', label: 'الخميس' },
  { value: 'الجمعة', label: 'الجمعة' },
  { value: 'السبت', label: 'السبت' }
];

// Helper function to get status info
export const getStatusInfo = (status, language = 'ar') => {
  const statusInfo = INVOICE_STATUSES[status] || INVOICE_STATUSES.pending;
  return {
    label: language === 'ar' ? statusInfo.label_ar : statusInfo.label_en,
    color: statusInfo.color
  };
};

// Helper function to get payment method label
export const getPaymentMethodLabel = (method, language = 'ar') => {
  const paymentMethod = PAYMENT_METHODS.find(p => p.value === method);
  if (!paymentMethod) return method;
  return language === 'ar' ? paymentMethod.label_ar : paymentMethod.label_en;
};

// Calculate invoice totals
export const calculateTotals = (items, couponDiscount = 0) => {
  const subtotal = items.reduce((sum, item) => sum + (item.fee || 0), 0);
  const vatAmount = Math.round(subtotal * (COMPANY_INFO.vat_rate / 100) * 100) / 100;
  const totalBeforeDiscount = Math.round((subtotal + vatAmount) * 100) / 100;
  const totalDiscount = couponDiscount;
  const total = Math.max(Math.round((totalBeforeDiscount - totalDiscount) * 100) / 100, 0);
  return { subtotal, vatAmount, totalBeforeDiscount, totalDiscount, total };
};

// Format schedule from days and time
export const formatSchedule = (days, time) => {
  if (!days || days.length === 0) return '';
  
  const sortedDays = [...days].sort((a, b) => {
    const order = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return order.indexOf(a) - order.indexOf(b);
  });
  
  let daysText = '';
  if (sortedDays.length === 1) {
    daysText = sortedDays[0];
  } else if (sortedDays.length === 2) {
    daysText = `${sortedDays[0]} و ${sortedDays[1]}`;
  } else {
    daysText = sortedDays.slice(0, -1).join('، ') + ' و ' + sortedDays[sortedDays.length - 1];
  }
  
  return time ? `${daysText} - ${time}` : daysText;
};
