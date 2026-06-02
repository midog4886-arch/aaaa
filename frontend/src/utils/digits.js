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
