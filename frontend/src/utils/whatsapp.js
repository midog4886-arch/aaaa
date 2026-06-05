// Normalize a stored phone number into a WhatsApp-ready international number
// (digits only, including the country code). Defaults to Saudi Arabia (966)
// for local-format numbers, but preserves explicit international numbers.
export const toWhatsAppNumber = (raw) => {
  if (!raw) return '';
  const p = String(raw).trim();
  const digits = p.replace(/\D/g, '');
  if (!digits) return '';
  if (p.startsWith('+')) return digits;                 // explicit international (+20, +91...)
  if (digits.startsWith('00')) return digits.slice(2);  // 00 international prefix
  if (digits.startsWith('966')) return digits;          // already Saudi country code
  if (digits.startsWith('0')) return '966' + digits.slice(1); // 05xxxxxxxx -> 9665xxxxxxxx
  if (digits.length === 9 && digits.startsWith('5')) return '966' + digits; // bare 5xxxxxxxx
  return '966' + digits;                                 // fallback: assume Saudi
};

// Build a wa.me chat URL that opens the member's WhatsApp conversation directly.
export const whatsappChatUrl = (raw, text) => {
  const num = toWhatsAppNumber(raw);
  if (!num) return '';
  const base = `https://wa.me/${num}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
};
