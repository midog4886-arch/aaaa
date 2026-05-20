const DAY_MAP = {
  'الأحد': 'Sun', 'الاحد': 'Sun',
  'الإثنين': 'Mon', 'الاثنين': 'Mon',
  'الثلاثاء': 'Tue',
  'الأربعاء': 'Wed', 'الاربعاء': 'Wed',
  'الخميس': 'Thu',
  'الجمعة': 'Fri',
  'السبت': 'Sat',
};

const ACTIVITY_TOKENS = [
  [/كرة\s*القدم/g, 'Football'],
  [/كرة\s*السلة/g, 'Basketball'],
  [/كرة\s*الطائرة/g, 'Volleyball'],
  [/تنس\s*الطاولة/g, 'Table Tennis'],
  [/التنس|تنس/g, 'Tennis'],
  [/الكاراتيه|كاراتيه/g, 'Karate'],
  [/التايكوندو|تايكوندو/g, 'Taekwondo'],
  [/الجودو|جودو/g, 'Judo'],
  [/الجمباز|جمباز/g, 'Gymnastics'],
  [/السباحة|سباحة/g, 'Swimming'],
  [/الملاكمة|ملاكمة/g, 'Boxing'],
  [/المصارعة|مصارعة/g, 'Wrestling'],
  [/اليوغا|يوغا/g, 'Yoga'],
  [/اللياقة\s*البدنية|اللياقة|لياقة/g, 'Fitness'],
  [/الرماية|رماية/g, 'Shooting'],
  [/الفروسية|فروسية/g, 'Equestrian'],
  [/الجري|جري/g, 'Running'],
  [/ألعاب\s*القوى/g, 'Athletics'],
  [/الشطرنج|شطرنج/g, 'Chess'],
  [/الرقص|رقص/g, 'Dance'],
  [/يوم\s+واحد\s+في\s+الأ?سبوع|يوم\s+في\s+الأ?سبوع/g, '1 day/week'],
  [/يومين\s+في\s+الأ?سبوع/g, '2 days/week'],
  [/(\d+)\s*أيام\s+في\s+الأ?سبوع|(\d+)\s*ايام\s+في\s+الأ?سبوع/g, (_, a, b) => `${a || b} days/week`],
  [/(\d+)\s*مرات\s+في\s+الأ?سبوع/g, '$1 times/week'],
  [/يومياً|يوميا/g, 'Daily'],
  [/شهرياً|شهريا/g, 'Monthly'],
  [/أسبوعياً|اسبوعيا/g, 'Weekly'],
];

const PERIOD_TOKENS = [
  [/(\d+)\s*أشهر|(\d+)\s*اشهر/g, (_, a, b) => `${a || b} months`],
  [/شهرين/g, '2 months'],
  [/شهر\s+واحد|شهر/g, '1 month'],
  [/(\d+)\s*سنوات/g, '$1 years'],
  [/سنتين/g, '2 years'],
  [/سنة\s+واحدة|سنة/g, '1 year'],
  [/(\d+)\s*أسابيع|(\d+)\s*اسابيع/g, (_, a, b) => `${a || b} weeks`],
  [/أسبوعين|اسبوعين/g, '2 weeks'],
  [/أسبوع\s+واحد|أسبوع|اسبوع/g, '1 week'],
  [/(\d+)\s*أيام|(\d+)\s*ايام/g, (_, a, b) => `${a || b} days`],
  [/يومين/g, '2 days'],
  [/يوم\s+واحد|يوم/g, '1 day'],
  [/إلى|الى/g, 'to'],
];

export const translateSchedule = (value, lang) => {
  if (!value || lang !== 'en') return value || '';
  let out = String(value);
  Object.entries(DAY_MAP).forEach(([ar, en]) => {
    out = out.split(ar).join(en);
  });
  out = out.replace(/\s+و\s+/g, ' & ').replace(/،/g, ',');
  out = out.replace(/(\d{1,2}:\d{2})\s*م\b/g, '$1 PM');
  out = out.replace(/(\d{1,2}:\d{2})\s*ص\b/g, '$1 AM');
  out = out.replace(/الساعة/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
};

export const translateActivityName = (value, lang) => {
  if (!value || lang !== 'en') return value || '';
  let out = String(value);
  ACTIVITY_TOKENS.forEach(([re, repl]) => {
    out = out.replace(re, repl);
  });
  out = out.replace(/\s+/g, ' ').trim();
  return out;
};

export const translatePeriod = (value, lang) => {
  if (!value || lang !== 'en') return value || '';
  let out = String(value);
  PERIOD_TOKENS.forEach(([re, repl]) => {
    out = out.replace(re, repl);
  });
  return out.replace(/\s+/g, ' ').trim();
};
