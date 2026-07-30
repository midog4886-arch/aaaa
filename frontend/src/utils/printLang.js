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

const AR_DAYS_MAP = {
  'الأحد': 'Sun', 'الاحد': 'Sun',
  'الإثنين': 'Mon', 'الاثنين': 'Mon',
  'الثلاثاء': 'Tue',
  'الأربعاء': 'Wed', 'الاربعاء': 'Wed',
  'الخميس': 'Thu',
  'الجمعة': 'Fri',
  'السبت': 'Sat',
};

export const translateSchedule = (text, lang) => {
  if (!text || lang !== 'en') return text || '';
  let out = String(text);
  Object.keys(AR_DAYS_MAP)
    .sort((a, b) => b.length - a.length)
    .forEach((ar) => {
      out = out.split(ar).join(AR_DAYS_MAP[ar]);
    });
  out = out
    .replace(/\s+و\s+/g, ' and ')
    .replace(/(^|[\s,،])من(?=[\s,،]|$)/g, '$1from')
    .replace(/(^|[\s,،])(?:إلى|الى)(?=[\s,،]|$)/g, '$1to')
    .replace(/(\d)\s*م(?![\u0600-\u06FF])/g, '$1 PM')
    .replace(/(\d)\s*ص(?![\u0600-\u06FF])/g, '$1 AM')
    .replace(/،/g, ',');
  return out;
};

// Members can carry duplicate copies of the same activity in
// member.activities (legacy $push writes, renewals against a re-created
// activity id). Cards must list each activity ONCE — keep, per normalized
// name, the copy with the latest end_date (tie → the one marked active).
export const dedupeCardActivities = (activities) => {
  const list = Array.isArray(activities) ? activities : [];
  const parseEnd = (a) => {
    if (!a || !a.end_date) return 0;
    const t = new Date(a.end_date).getTime();
    return isNaN(t) ? 0 : t;
  };
  const out = [];
  const byKey = new Map();
  list.forEach((act) => {
    const key = String(act?.activity_name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) {
      out.push(act);
      return;
    }
    if (!byKey.has(key)) {
      byKey.set(key, out.length);
      out.push(act);
      return;
    }
    const idx = byKey.get(key);
    const prev = out[idx];
    const better =
      parseEnd(act) > parseEnd(prev) ||
      (parseEnd(act) === parseEnd(prev) && act?.status === 'active' && prev?.status !== 'active');
    if (better) out[idx] = act;
  });
  return out;
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
