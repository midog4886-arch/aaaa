import React, { createContext, useContext, useState, useEffect } from 'react';

const translations = {
  ar: {
    // General
    academy_name: 'شركة اداء الابطال العالمية للرياضة',
    academy_name_short: 'شركة الابطال للرياضة',
    login: 'تسجيل الدخول',
    logout: 'تسجيل الخروج',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    search: 'بحث',
    filter: 'تصفية',
    print: 'طباعة',
    export: 'تصدير',
    close: 'إغلاق',
    confirm: 'تأكيد',
    loading: 'جاري التحميل...',
    no_data: 'لا توجد بيانات',
    success: 'تمت العملية بنجاح',
    error: 'حدث خطأ',
    
    // Navigation
    dashboard: 'لوحة التحكم',
    members: 'الأعضاء',
    activities: 'الأنشطة',
    coaches: 'المدربين',
    invoices: 'الفواتير',
    store: 'المخزن',
    accounting: 'المحاسبة',
    reports: 'التقارير',
    messages: 'الرسائل',
    settings: 'الإعدادات',
    branches: 'الفروع',
    users: 'المستخدمين',
    
    // Dashboard
    total_members: 'إجمالي الأعضاء',
    active_subscriptions: 'الاشتراكات النشطة',
    monthly_revenue: 'إيرادات الشهر',
    expiring_soon: 'ينتهي قريباً',
    recent_invoices: 'أحدث الفواتير',
    members_by_activity: 'الأعضاء حسب النشاط',
    expiring_subscriptions: 'الاشتراكات المنتهية قريباً',
    
    // Members
    add_member: 'إضافة عضو',
    edit_member: 'تعديل العضو',
    member_name: 'اسم العضو',
    guardian_name: 'اسم ولي الأمر',
    phone: 'رقم الجوال',
    email: 'البريد الإلكتروني',
    age: 'العمر',
    notes: 'ملاحظات',
    member_activities: 'أنشطة العضو',
    add_activity: 'إضافة نشاط',
    
    // Activities
    activity_name: 'اسم النشاط',
    monthly_fee: 'الرسوم الشهرية',
    description: 'الوصف',
    color: 'اللون',
    swimming: 'السباحة',
    football: 'كرة القدم',
    karate: 'الكاراتيه',
    gymnastics: 'الجمباز',
    
    // Subscriptions
    subscription_status: 'حالة الاشتراك',
    start_date: 'تاريخ البداية',
    end_date: 'تاريخ النهاية',
    status_active: 'ساري',
    status_expired: 'منتهي',
    status_frozen: 'مجمّد',
    status_pending: 'معلق',
    renew: 'تجديد',
    freeze: 'تجميد',
    
    // Invoices
    create_invoice: 'إنشاء فاتورة',
    invoice_number: 'رقم الفاتورة',
    invoice_date: 'تاريخ الفاتورة',
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    total: 'الإجمالي',
    payment_method: 'طريقة الدفع',
    cash: 'نقداً',
    card: 'بطاقة',
    transfer: 'تحويل',
    online: 'دفع إلكتروني',
    pay_now: 'ادفع الآن',
    mark_paid: 'تم الدفع',
    invoice_status: 'حالة الفاتورة',
    paid: 'مدفوعة',
    unpaid: 'غير مدفوعة',
    cancelled: 'ملغاة',
    
    // Reports
    financial_report: 'التقرير المالي',
    daily: 'يومي',
    monthly: 'شهري',
    yearly: 'سنوي',
    total_revenue: 'إجمالي الإيرادات',
    by_activity: 'حسب النشاط',
    by_coach: 'حسب المدرب',
    date_range: 'الفترة الزمنية',
    from: 'من',
    to: 'إلى',
    
    // Coaches
    add_coach: 'إضافة مدرب',
    coach_name: 'اسم المدرب',
    coach_activities: 'أنشطة المدرب',
    
    // Messages
    send_message: 'إرسال رسالة',
    select_recipients: 'اختر المستلمين',
    message_type: 'نوع الرسالة',
    payment_reminder: 'تذكير بالدفع',
    expiry_alert: 'تنبيه انتهاء الاشتراك',
    promotion: 'عرض ترويجي',
    custom: 'رسالة مخصصة',
    
    // Settings
    language: 'اللغة',
    arabic: 'العربية',
    english: 'English',
    theme: 'المظهر',
    light: 'فاتح',
    dark: 'داكن',
    
    // Currency
    sar: 'ر.س',
    currency: 'ريال سعودي',
    
    // Validation
    required_field: 'هذا الحقل مطلوب',
    invalid_phone: 'رقم الجوال غير صحيح',
    invalid_email: 'البريد الإلكتروني غير صحيح',
    
    // Auth
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    login_welcome: 'مرحباً بك في',
    login_subtitle: 'سجّل الدخول للوصول إلى لوحة التحكم',
    invalid_credentials: 'اسم المستخدم أو كلمة المرور غير صحيحة',
    
    // Days
    days: 'أيام',
    days_remaining: 'يوم متبقي',
  },
  en: {
    // General
    academy_name: 'Champions Performance Academy',
    academy_name_short: 'Champions Academy',
    login: 'Login',
    logout: 'Logout',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    search: 'Search',
    filter: 'Filter',
    print: 'Print',
    export: 'Export',
    close: 'Close',
    confirm: 'Confirm',
    loading: 'Loading...',
    no_data: 'No data available',
    success: 'Operation successful',
    error: 'An error occurred',
    
    // Navigation
    dashboard: 'Dashboard',
    members: 'Members',
    activities: 'Activities',
    coaches: 'Coaches',
    invoices: 'Invoices',
    reports: 'Reports',
    messages: 'Messages',
    settings: 'Settings',
    branches: 'Branches',
    users: 'Users',
    
    // Dashboard
    total_members: 'Total Members',
    active_subscriptions: 'Active Subscriptions',
    monthly_revenue: 'Monthly Revenue',
    expiring_soon: 'Expiring Soon',
    recent_invoices: 'Recent Invoices',
    members_by_activity: 'Members by Activity',
    expiring_subscriptions: 'Expiring Subscriptions',
    
    // Members
    add_member: 'Add Member',
    edit_member: 'Edit Member',
    member_name: 'Member Name',
    guardian_name: 'Guardian Name',
    phone: 'Phone',
    email: 'Email',
    age: 'Age',
    notes: 'Notes',
    member_activities: 'Member Activities',
    add_activity: 'Add Activity',
    
    // Activities
    activity_name: 'Activity Name',
    monthly_fee: 'Monthly Fee',
    description: 'Description',
    color: 'Color',
    swimming: 'Swimming',
    football: 'Football',
    karate: 'Karate',
    gymnastics: 'Gymnastics',
    
    // Subscriptions
    subscription_status: 'Subscription Status',
    start_date: 'Start Date',
    end_date: 'End Date',
    status_active: 'Active',
    status_expired: 'Expired',
    status_frozen: 'Frozen',
    status_pending: 'Pending',
    renew: 'Renew',
    freeze: 'Freeze',
    
    // Invoices
    create_invoice: 'Create Invoice',
    invoice_number: 'Invoice Number',
    invoice_date: 'Invoice Date',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: 'Total',
    payment_method: 'Payment Method',
    cash: 'Cash',
    card: 'Card',
    transfer: 'Transfer',
    online: 'Online Payment',
    pay_now: 'Pay Now',
    mark_paid: 'Mark as Paid',
    invoice_status: 'Invoice Status',
    paid: 'Paid',
    unpaid: 'Unpaid',
    cancelled: 'Cancelled',
    
    // Reports
    financial_report: 'Financial Report',
    daily: 'Daily',
    monthly: 'Monthly',
    yearly: 'Yearly',
    total_revenue: 'Total Revenue',
    by_activity: 'By Activity',
    by_coach: 'By Coach',
    date_range: 'Date Range',
    from: 'From',
    to: 'To',
    
    // Coaches
    add_coach: 'Add Coach',
    coach_name: 'Coach Name',
    coach_activities: 'Coach Activities',
    
    // Messages
    send_message: 'Send Message',
    select_recipients: 'Select Recipients',
    message_type: 'Message Type',
    payment_reminder: 'Payment Reminder',
    expiry_alert: 'Expiry Alert',
    promotion: 'Promotion',
    custom: 'Custom Message',
    
    // Settings
    language: 'Language',
    arabic: 'العربية',
    english: 'English',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    
    // Currency
    sar: 'SAR',
    currency: 'Saudi Riyal',
    
    // Validation
    required_field: 'This field is required',
    invalid_phone: 'Invalid phone number',
    invalid_email: 'Invalid email address',
    
    // Auth
    username: 'Username',
    password: 'Password',
    login_welcome: 'Welcome to',
    login_subtitle: 'Login to access the dashboard',
    invalid_credentials: 'Invalid username or password',
    
    // Days
    days: 'days',
    days_remaining: 'days remaining',
  }
};

const LanguageContext = createContext();

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem('language') || 'ar';
  });
  
  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);
  
  const t = (key) => {
    return translations[language][key] || key;
  };
  
  const toggleLanguage = () => {
    setLanguage(prev => prev === 'ar' ? 'en' : 'ar');
  };
  
  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

export default LanguageContext;
