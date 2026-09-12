import { toAsciiDigits } from './digits';

// Keep WhatsApp/member lookup normalization aligned with backend/utils/phone.py.
// The API still normalizes authoritatively; this helper avoids sending a
// visibly equivalent Saudi/Egyptian number in a surprising format.
export const normalizePhone = (value) => {
  if (value === null || value === undefined) return '';
  let digits = String(toAsciiDigits(value)).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('05') && digits.length === 10) {
    digits = `966${digits.slice(1)}`;
  } else if (digits.startsWith('5') && digits.length === 9) {
    digits = `966${digits}`;
  } else if (digits.startsWith('01') && digits.length === 11) {
    digits = `20${digits.slice(1)}`;
  } else if (digits.startsWith('1') && digits.length === 10) {
    digits = `20${digits}`;
  }
  if (digits.length < 9 || digits.length > 15 || digits.startsWith('0')) return '';
  return digits;
};