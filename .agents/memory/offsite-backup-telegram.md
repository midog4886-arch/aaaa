---
name: Offsite backups via Telegram
description: Contracts and platform limits for the offsite (Telegram) backup delivery layer
---

# Offsite backup delivery (Telegram)

- Nightly per-tenant backups are pushed offsite via Telegram bot (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`); when unconfigured everything degrades gracefully (status `unconfigured`, no nightly alert spam).
- Send helper returns a status dict (`sent/failed/skipped/unconfigured` + message_id/error); nightly aggregation emits ops alert `backup.offsite_failure` for failed/skipped only when creds are configured.
- Sent auto backups are registered in control DB collection `offsite_backups` (per tenant, with Telegram message_id).

**Why the retention design is asymmetric:** Telegram's Bot API hard-refuses `deleteMessage` for messages older than 48h — a strict N-copy offsite prune is IMPOSSIBLE there. Copies older than the window (or repeatedly refused) are kept and their registry rows marked `retained` (never dropped), so the registry always mirrors what actually exists offsite. The 7-copy policy is fully enforced on local disk only.

**How to apply:** never claim/implement offsite pruning of aged Telegram messages; if true lifecycle deletion is required, switch to an object-storage provider. Files >49MB are gzipped; still-too-big returns `skipped` (alerted).
