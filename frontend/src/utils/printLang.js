const KEY = 'print_language';

export const getPrintLang = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
};

export const setPrintLang = (lang) => {
  try {
    localStorage.setItem(KEY, lang === 'en' ? 'en' : 'ar');
  } catch {}
};

export const PRINT_LABELS = {
  ar: {
    name: 'الاسم',
    member_id: 'رقم العضوية',
    employee_id: 'رقم الموظف',
    phone: 'رقم الجوال',
    phone_short: 'الجوال',
    coach: 'المدرب',
    coach_label: 'المدرب:',
    specialization: 'التخصص',
    activities: 'الأنشطة المسجلة',
    from: 'من:',
    to: 'إلى:',
    checkin_out: 'حضور / انصراف',
    print_btn: '🖨️ طباعة الكارت',
    company_name: 'شركة اداء الابطال العالمية للرياضة',
    company_sub: 'Global Champions Sports Performance',
    dir: 'rtl',
    align: 'right',
  },
  en: {
    name: 'Name',
    member_id: 'Member ID',
    employee_id: 'Employee ID',
    phone: 'Phone',
    phone_short: 'Phone',
    coach: 'Coach',
    coach_label: 'Coach:',
    specialization: 'Specialization',
    activities: 'Registered Activities',
    from: 'From:',
    to: 'To:',
    checkin_out: 'Check-in / Check-out',
    print_btn: '🖨️ Print Card',
    company_name: 'Global Champions Sports Performance',
    company_sub: 'شركة اداء الابطال العالمية للرياضة',
    dir: 'ltr',
    align: 'left',
  },
};
