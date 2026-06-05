---
name: WhatsApp direct chat vs OS share sheet
description: Why opening a member's WhatsApp chat must use a wa.me link, not navigator.share, and how member phone numbers are stored.
---

## Direct chat vs share sheet
- To open a member's WhatsApp **conversation directly**, use a `wa.me/<intl-number>` link (`window.open`) — NOT `navigator.share`.
- `navigator.share` (Web Share API) on Android tablets opens the OS share sheet (Quick Share / Honor Share), which lets the user pick any app and does NOT land on the contact's chat. Users perceive this as "it doesn't open the chat".
- The QR-card "send" flow intentionally keeps `navigator.share` for sharing the QR **image**; the direct-chat link is a separate action.

## Phone number storage (champions_default audit)
- Stored phones are mostly Saudi local `05xxxxxxxx` (~275/283). For wa.me they must become `9665xxxxxxxx`.
- Edge cases that break naive `replace(/^0/,'966')`: `00`-international (e.g. Qatar `00974...`), `+`-international (e.g. India `+91...`), bare 9-digit `5xxxxxxxx` (no leading 0), and short malformed numbers.

**Why:** centralized normalizer `frontend/src/utils/whatsapp.js` (`toWhatsAppNumber` / `whatsappChatUrl`) handles all these; default country code is 966.
**How to apply:** for ANY new WhatsApp link/feature, import from `utils/whatsapp.js` instead of hand-rolling `wa.me/966${phone...}` strings.
