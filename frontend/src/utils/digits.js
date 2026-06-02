// Convert Arabic-Indic (٠-٩) and Persian/Extended (۰-۹) digits to ASCII.
// Hardware barcode scanners emulate a keyboard, so on an Arabic keyboard
// layout the scanned numbers arrive as Arabic-Indic digits which never
// match ASCII-stored member codes. Normalize before lookup/check-in.
const DIGIT_MAP = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export const toAsciiDigits = (value) => {
  if (value === null || value === undefined) return value;
  return String(value).replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] || d);
};

// Reverse the Arabic (101) keyboard layout. A hardware scanner is a keyboard
// wedge, so when the tablet input language is Arabic an ASCII member code like
// "DEFA-B7-0047" arrives mangled (letters become Arabic letters/brackets).
// These tables map each Arabic-layout output character back to the Latin letter
// on the same physical key so the original code can be recovered.
const AR_KB_LIGATURES = [
  ['لإ', 'T'], ['لأ', 'G'], ['لآ', 'B'], ['لا', 'B'],
];

const AR_KB_MAP = {
  'ض': 'Q', 'ص': 'W', 'ث': 'E', 'ق': 'R', 'ف': 'T', 'غ': 'Y',
  'ع': 'U', 'ه': 'I', 'خ': 'O', 'ح': 'P', 'ج': '[', 'د': ']',
  'ش': 'A', 'س': 'S', 'ي': 'D', 'ب': 'F', 'ل': 'G', 'ا': 'H',
  'ت': 'J', 'ن': 'K', 'م': 'L', 'ك': ';', 'ط': "'",
  'ئ': 'Z', 'ء': 'X', 'ؤ': 'C', 'ر': 'V', 'ى': 'N', 'ة': 'M',
  'و': ',', 'ز': '.', 'ظ': '/',
  'َ': 'Q', 'ً': 'W', 'ُ': 'E', 'ٌ': 'R', 'إ': 'Y', 'ِ': 'A',
  'ٍ': 'S', 'أ': 'H', 'ـ': 'J', '،': 'K', 'آ': 'N', 'ْ': 'X',
  '؛': 'P', '؟': '/',
  ']': 'D', '[': 'F', '}': 'C', '{': 'V', '`': 'U', '÷': 'I',
  '×': 'O', '~': 'Z',
};

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

export const deArabizeKeyboard = (value) => {
  if (value === null || value === undefined) return value;
  let text = String(value);
  if (!ARABIC_SCRIPT_RE.test(text)) return text;
  AR_KB_LIGATURES.forEach(([lig, latin]) => {
    text = text.split(lig).join(latin);
  });
  let out = '';
  for (const ch of text) out += (AR_KB_MAP[ch] !== undefined ? AR_KB_MAP[ch] : ch);
  return toAsciiDigits(out).toUpperCase().trim();
};

// Best-effort normalization for a scanned/typed member code: digit-normalize
// first; if the result still carries Arabic-script characters (mangled by an
// Arabic keyboard layout), reverse the layout to recover the Latin code.
export const normalizeScannedCode = (value) => {
  const digits = toAsciiDigits(value);
  if (typeof digits === 'string' && ARABIC_SCRIPT_RE.test(digits)) {
    return deArabizeKeyboard(digits);
  }
  return typeof digits === 'string' ? digits.trim() : digits;
};
