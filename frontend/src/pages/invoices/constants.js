/**
 * Constants for Invoice pages
 */

// Card print dimensions
export const CARD_WIDTH = 90; // mm
export const CARD_HEIGHT = 60; // mm
export const TOP_MARGIN = 30; // mm
export const RIGHT_MARGIN = 15; // mm
export const GAP = 5; // mm

// Company info
export const COMPANY_TAX_NUMBER = "312655637900003";
export const COMPANY_COMMERCIAL_REG = "7043630230";
export const VAT_RATE = 0.15; // 15%

// Company info object
export const COMPANY_INFO = {
  name_ar: "أكاديمية أداء الأبطال",
  name_en: "Global Champions Sports Performance",
  tax_number: COMPANY_TAX_NUMBER,
  commercial_reg: COMPANY_COMMERCIAL_REG,
  vat_rate: VAT_RATE
};

// Payment methods
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدي', labelEn: 'Cash' },
  { value: 'card', label: 'بطاقة', labelEn: 'Card' },
  { value: 'transfer', label: 'تحويل', labelEn: 'Transfer' },
  { value: 'stripe', label: 'أونلاين', labelEn: 'Online' }
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
export const INVOICE_TERMS = [
  "الاشتراك محدد البداية والنهاية ولا يتم تعويض حصص غياب المشترك",
  "المبلغ المدفوع لا يسترد بعد مرور أسبوع من الاشتراك",
  "يجب إحضار بطاقة العضوية عند كل زيارة",
  "الالتزام بمواعيد الحصص المحددة"
];
