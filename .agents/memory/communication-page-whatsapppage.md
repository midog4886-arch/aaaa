---
name: التواصل page is WhatsAppPage, MessagesPage is dead
description: Which component actually serves the admin communication/internal-messages UI
---

# التواصل page = WhatsAppPage.js

The admin communication hub (واتساب / إرسال يدوي / إشعار النشاط / إشعارات الأعضاء / رسائل داخلية / إشعارات Push tabs) is `frontend/src/pages/WhatsAppPage.js`, served at `/admin/whatsapp`. `/admin/messages` redirects there.

**`frontend/src/pages/MessagesPage.js` is DEAD CODE** — no route renders it (App.js only keeps a comment about it). It contains a near-identical internal-messages UI; editing it changes nothing visible.

**How to apply:** any change to the internal-messages list/thread UI (رسائل داخلية) must go into WhatsAppPage's `activeTab === 'internal'` section. Verify by grepping App.js routes before editing lookalike pages (same lesson as the invoices page).

Related: member-sent messages (portal reply + profile-change request in `backend/routes/member_portal.py`) now notify admins via a `member_message` bell notification (needs `action_url` for the bell click to navigate) + `send_push_to_admins`; push is skipped (fail closed) when the member has no branch_id to avoid cross-branch preview leaks.
