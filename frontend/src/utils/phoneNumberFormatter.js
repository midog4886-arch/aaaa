// Extract mobile numbers from free text without retaining names or other text.
// Keep the same Saudi/Egypt normalization used by the campaign recipient list.
const arabicDigits = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
export const normalizeDigits = value => String(value || '').replace(/[٠-٩۰-۹]/g, digit => arabicDigits[digit] ?? String(digit.charCodeAt(0) - 1776));

export const filterPhoneNumbers = (numbers, query) => {
  if (!query.trim()) return numbers;
  const terms = normalizeDigits(query).split(/[,،;؛\n\r\t]+/).map(part => part.replace(/\D/g, '')).filter(Boolean);
  if (!terms.length) return [];
  return numbers.filter(phone => {
    const local = phone.startsWith('9665') ? `0${phone.slice(3)}` : phone.startsWith('201') ? `0${phone.slice(2)}` : phone;
    return terms.some(term => {
      const international = term.startsWith('00') ? term.slice(2) : term;
      return phone.includes(international) || local.includes(international) ||
        (international.startsWith('0') && phone.includes(international.slice(1)));
    });
  });
};
const candidatePattern = /(?:\+|00)?966(?:[\s().-]*\d){9}|(?:\+|00)?20(?:[\s().-]*\d){10}|05(?:[\s().-]*\d){8}|01(?:[\s().-]*\d){9}|\+\d{9,15}/g;

export const extractPhoneNumbers = input => {
  const source = normalizeDigits(input);
  const numbers = [];
  const seen = new Set();
  let duplicates = 0;
  let invalid = 0;
  let unmatched = source;
  for (const match of source.matchAll(candidatePattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if ((start > 0 && /\d/.test(source[start - 1])) || (end < source.length && /\d/.test(source[end]))) {
      invalid += 1;
      continue;
    }
    let digits = match[0].replace(/\D/g, '');
    if (digits.startsWith('00966')) digits = digits.slice(2);
    else if (digits.startsWith('0020')) digits = digits.slice(2);
    if (digits.startsWith('05') && digits.length === 10) digits = `966${digits.slice(1)}`;
    else if (digits.startsWith('01') && digits.length === 11) digits = `20${digits.slice(1)}`;
    if (digits.length < 9 || digits.length > 15) {
      invalid += 1;
      continue;
    }
    unmatched = `${unmatched.slice(0, start)}${' '.repeat(match[0].length)}${unmatched.slice(end)}`;
    if (seen.has(digits)) duplicates += 1;
    else { seen.add(digits); numbers.push(digits); }
  }
  invalid += (unmatched.match(/\+?\d[\d().-]{5,}/g) || []).length;
  return { numbers, duplicates, invalid };
};

export const displayPhone = digits => {
  if (/^9665\d{8}$/.test(digits)) return `+966 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  if (/^201\d{9}$/.test(digits)) return `+20 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return `+${digits}`;
};
