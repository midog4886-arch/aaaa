---
name: Manager WhatsApp alerts
description: Forwarding new admin bell notifications to the manager's WhatsApp — cursor + authz rules
---
A background loop in the WhatsApp routes (started with the reminder scheduler) polls every 60s per active tenant and forwards NEW `db.notifications` rows to `admin_alert_phone` via the local WA bot (localhost:3001, needs QR link).

Rules:
- Cursor `admin_alert_last_ts` lives on the `whatsapp_settings` doc; advance with `$max` (monotonic, ISO strings compare lexicographically). Enabling the toggle resets the baseline to "now" so history is never replayed.
- Only up to 5 items sent per cycle; older backlog is dropped (cursor jumps past it) to avoid floods after reconnect. WA disconnected → skip WITHOUT advancing.
- **Why:** at-least-once with bounded flood beats exactly-once complexity for a single-process app.
- Changing `admin_alert_enabled`/`admin_alert_phone` is admin-only server-side (the alerts carry member-message content — a staffer redirecting them to their own number is data exfiltration). Non-admin saves that echo stored values back are tolerated because the settings form always sends the whole object.
