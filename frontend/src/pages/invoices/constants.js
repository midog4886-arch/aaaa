import { getTaxNumber, getCommercialReg, getAcademyName } from '../../services/branding';

export const CARD_WIDTH = 90;
export const CARD_HEIGHT = 60;
export const TOP_MARGIN = 30;
export const RIGHT_MARGIN = 15;
export const GAP = 5;

export const COMPANY_TAX_NUMBER = "312655637900003";
export const COMPANY_COMMERCIAL_REG = "7043630230";
export const VAT_RATE = 15;

// Main activities for level selector
export const MAIN_ACTIVITIES_FOR_LEVELS = [
  { id: 'swimming', name_ar: 'السباحة', name_en: 'Swimming', icon: '🏊', color: 'bg-blue-500' },
  { id: 'football', name_ar: 'كرة القدم', name_en: 'Football', icon: '⚽', color: 'bg-green-500' },
  { id: 'karate', name_ar: 'الكاراتيه', name_en: 'Karate', icon: '🥋', color: 'bg-red-500' },
];

const COMPANY_INFO_DEFAULTS = {
  name_ar: "شركة اداء الابطال العالمية للرياضة",
  name_en: "Global Champions Sports Performance",
  tax_number: COMPANY_TAX_NUMBER,
  commercial_reg: COMPANY_COMMERCIAL_REG,
  vat_rate: VAT_RATE,
};

export const COMPANY_INFO = new Proxy(COMPANY_INFO_DEFAULTS, {
  get(target, prop) {
    if (prop === 'name_ar' || prop === 'name_en') {
      const dyn = getAcademyName();
      if (dyn) return dyn;
      return target[prop];
    }
    if (prop === 'tax_number') {
      const dyn = getTaxNumber();
      return dyn || target.tax_number;
    }
    if (prop === 'commercial_reg') {
      const dyn = getCommercialReg();
      return dyn || target.commercial_reg;
    }
    return target[prop];
  },
});

// Payment methods
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدي', labelEn: 'Cash', fee: 0 },
  { value: 'card', label: 'بطاقة', labelEn: 'Card', fee: 0 },
  { value: 'تابي', label: 'تابي', labelEn: 'Tabby', fee: 7.5 },
  { value: 'تمارة', label: 'تمارا', labelEn: 'Tamara', fee: 7.5 }
];

// Invoice statuses
export const INVOICE_STATUSES = [
  { value: 'pending', label: 'معلق', labelEn: 'Pending', color: 'yellow' },
  { value: 'paid', label: 'مدفوع', labelEn: 'Paid', color: 'green' },
  { value: 'cancelled', label: 'ملغي', labelEn: 'Cancelled', color: 'red' },
  { value: 'partial', label: 'جزئي', labelEn: 'Partial', color: 'orange' }
];

// Subscription periods
export const SUBSCRIPTION_PERIODS = [
  { value: 'monthly', label: 'شهري', labelEn: 'Monthly' },
  { value: 'quarterly', label: 'ربع سنوي', labelEn: 'Quarterly' },
  { value: 'biannual', label: 'نصف سنوي', labelEn: 'Biannual' },
  { value: 'annual', label: 'سنوي', labelEn: 'Annual' },
  { value: 'custom', label: 'مخصص', labelEn: 'Custom' }
];

// Arabic days of week
export const DAYS_OF_WEEK = [
  { value: 'sunday', label: 'الأحد', labelEn: 'Sunday' },
  { value: 'monday', label: 'الإثنين', labelEn: 'Monday' },
  { value: 'tuesday', label: 'الثلاثاء', labelEn: 'Tuesday' },
  { value: 'wednesday', label: 'الأربعاء', labelEn: 'Wednesday' },
  { value: 'thursday', label: 'الخميس', labelEn: 'Thursday' },
  { value: 'friday', label: 'الجمعة', labelEn: 'Friday' },
  { value: 'saturday', label: 'السبت', labelEn: 'Saturday' }
];

// Invoice terms
export const INVOICE_TERMS = {
  ar: [
    "الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك",
    "المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك",
    "يجب إحضار بطاقة العضوية عند كل زيارة",
    "الالتزام بمواعيد الحصص المحددة"
  ],
  en: [
    "Subscription has a fixed start and end date. Missed sessions will not be compensated",
    "Paid amount is non-refundable after one week from subscription",
    "Membership card must be presented at each visit",
    "Commitment to scheduled session times is required"
  ]
};

/**
 * Get status information (color, label)
 */
export const getStatusInfo = (status, language = 'ar') => {
  const statusMap = {
    pending: { color: 'yellow', label: language === 'ar' ? 'معلق' : 'Pending' },
    paid: { color: 'green', label: language === 'ar' ? 'مدفوع' : 'Paid' },
    cancelled: { color: 'red', label: language === 'ar' ? 'ملغي' : 'Cancelled' },
    partial: { color: 'orange', label: language === 'ar' ? 'جزئي' : 'Partial' },
    active: { color: 'green', label: language === 'ar' ? 'ساري' : 'Active' },
    expired: { color: 'red', label: language === 'ar' ? 'منتهي' : 'Expired' }
  };
  return statusMap[status] || { color: 'gray', label: status };
};

/**
 * Get payment method label
 */
export const getPaymentMethodLabel = (method, language = 'ar') => {
  const methodMap = {
    cash: { ar: 'نقدي', en: 'Cash' },
    card: { ar: 'بطاقة', en: 'Card' },
    'شبكة': { ar: 'شبكة', en: 'Network' },
    'مدى': { ar: 'مدى', en: 'Mada' },
    'فيزا': { ar: 'فيزا', en: 'Visa' },
    transfer: { ar: 'تحويل', en: 'Transfer' },
    'تابي': { ar: 'تابي', en: 'Tabby' },
    'تمارة': { ar: 'تمارة', en: 'Tamara' },
    stripe: { ar: 'أونلاين', en: 'Online' }
  };
  return methodMap[method]?.[language] || method;
};

/**
 * Get payment method fee percentage
 */
export const getPaymentMethodFee = (method) => {
  const feeMap = {
    'تابي': 7.5,
    'تمارة': 7.5
  };
  return feeMap[method] || 0;
};

/**
 * Calculate net amount after payment method fees
 */
export const calculateNetAmount = (amount, paymentMethod) => {
  const fee = getPaymentMethodFee(paymentMethod);
  if (fee > 0) {
    const feeAmount = (amount * fee) / 100;
    return {
      grossAmount: amount,
      feePercent: fee,
      feeAmount: feeAmount,
      netAmount: amount - feeAmount
    };
  }
  return {
    grossAmount: amount,
    feePercent: 0,
    feeAmount: 0,
    netAmount: amount
  };
};

/**
 * Format schedule for display
 */
export const formatSchedule = (schedule) => {
  if (!schedule) return '';
  return schedule;
};
