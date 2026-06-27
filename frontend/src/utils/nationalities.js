// Shared nationality options used by every nationality picker (member create/edit,
// public registration, invoice add-member). The stored value is the Arabic word
// so existing data and the reports grouping stay consistent; the English label is
// only for display when the UI is in English.
export const NATIONALITY_OPTIONS = [
  { value: 'سعودي', en: 'Saudi' },
  { value: 'مصري', en: 'Egyptian' },
  { value: 'عربي', en: 'Arab' },
  { value: 'هندي', en: 'Indian' },
];

export const nationalityLabel = (value, language) => {
  const opt = NATIONALITY_OPTIONS.find((o) => o.value === value);
  if (!opt) return value || '';
  return language === 'en' ? opt.en : opt.value;
};
