# Champions Academy — Production Runbook

This runbook covers the operational concerns introduced in **Phase 3** of the
SaaS launch: audit log, tenant data export & deletion, error monitoring
(Sentry), uptime monitoring, and ops alerts on failed background jobs.

---

## 1. Health & Uptime Monitoring

Two endpoints are exposed:

| Endpoint        | Purpose                          | Touches DB | Behaviour                                                       |
|-----------------|----------------------------------|-----------|-----------------------------------------------------------------|
| `GET /health`   | Kubernetes liveness probe        | No        | Always `200 {"status":"ok"}` while the process is alive.       |
| `GET /api/health` | UptimeRobot / dashboards monitor | Yes (4 s timeout) | `200` when DB ping succeeds, `503` when DB ping fails. |

### UptimeRobot setup

1. **Type:** HTTP(s)
2. **URL:** `https://<your-deploy>/api/health`
3. **Interval:** 5 minutes
4. **Keyword (optional):** `"status":"ok"` (alerts when keyword is missing)
5. **Alert contacts:** add the on-call email + WhatsApp/Telegram contact.

The endpoint returns:

```json
{
  "status": "ok|degraded",
  "db": "ok|down",
  "db_latency_ms": 42,
  "uptime_seconds": 12345,
  "timestamp": "2026-05-15T08:00:00+00:00"
}
```

---

## 2. Sentry (Error Monitoring)

Sentry is **optional**. Backend init runs at startup *only* when `SENTRY_DSN`
is set, so a missing dependency or DSN never breaks the boot.

### Backend env vars

| Variable                     | Default       | Notes                                  |
|------------------------------|---------------|----------------------------------------|
| `SENTRY_DSN`                 | _(empty)_     | Set to enable.                         |
| `SENTRY_ENVIRONMENT`         | `production`  | Sentry project environment tag.        |
| `SENTRY_RELEASE`             | _(none)_      | Optional release marker.               |
| `SENTRY_TRACES_SAMPLE_RATE`  | `0.05`        | 5 % perf sampling.                     |

The SDK is loaded lazily — no install needed when DSN is empty. To enable in
prod:

```bash
pip install sentry-sdk
export SENTRY_DSN=https://xxx@o0.ingest.sentry.io/0
```

### Frontend (CRA)

Initialisation is **already wired in `frontend/src/index.js`** and is
gated on `REACT_APP_SENTRY_DSN`. To enable in a deployment:

```bash
npm --prefix frontend i @sentry/react
# then in the deployment env:
REACT_APP_SENTRY_DSN=https://xxx@o0.ingest.sentry.io/0
REACT_APP_SENTRY_ENV=production
REACT_APP_SENTRY_RELEASE=$(git rev-parse --short HEAD)   # optional
REACT_APP_SENTRY_TRACES_RATE=0.05                        # optional
```

The dynamic `import('@sentry/react')` is wrapped in a `.catch`, so the
build still works if the package is absent — the page just logs a warning
and continues without monitoring.

---

## 3. Audit Log

Every sensitive operation writes one row to **`audit_logs`** in the
**current tenant's** database (so each academy sees only its own audit
trail). Helper: `backend/utils/audit.py` → `await log_audit(...)`.

### Instrumented operations

| Action                         | Source                                             |
|--------------------------------|----------------------------------------------------|
| `auth.login.success`           | `server.login`                                     |
| `auth.login.failure`           | `server.login`                                     |
| `member.update`                | `routes/members.update_member`                     |
| `member.delete`                | `routes/members.delete_member`                     |
| `subscription.add`             | `routes/members.add_member_activity`               |
| `invoice.cancel`               | `routes/invoices.cancel_invoice`                   |
| `invoice.delete`               | `routes/invoices.delete_invoice`                   |
| `user.update`                  | `routes/users.update_user`                         |
| `user.permissions.update`      | `routes/users.update_user` (perms/admin changed)   |
| `user.delete`                  | `routes/users.delete_user`                         |
| `settings.daily_checks.update` | `routes/notifications.update_daily_checks_settings` |
| `tenant.data.export`           | `routes/data_export.export_tenant_data`            |
| `invoice.pay`                  | `routes/invoices.pay_invoice`                      |
| `subscription.update`          | `routes/members.update_member_activity`            |
| `coach_attendance.update`      | `routes/coach_attendance.update_record`            |
| `coach_attendance.delete`      | `routes/coach_attendance.delete_record`            |
| `freeze.create`                | `routes/freezes.create_freeze`                     |
| `freeze.cancel`                | `routes/freezes.cancel_freeze`                     |
| `day_extension.apply`          | `routes/day_extensions.apply_extension`            |
| `day_extension.manual`         | `routes/day_extensions.manual_extension`           |

### Admin UI

Sidebar → **الإدارة → سجل التدقيق** (`/admin/audit`). Filters: action,
actor, entity type, date range, free-text search. **CSV export** uses the
same filters.

### Schema (`audit_logs`)

```jsonc
{
  "id": "uuid",
  "action": "member.delete",
  "entity_type": "member",
  "entity_id": "...",
  "entity_name": "أحمد علي",
  "actor_id": "u-123",
  "actor_username": "manager1",
  "actor_is_admin": true,
  "branch_id": "br-1",
  "diff": { "name_ar": { "before": "...", "after": "..." } },
  "extra": {},
  "created_at": "2026-05-15T08:00:00+00:00"
}
```

### Adding new audit points

```python
from utils.audit import log_audit

await log_audit(
    actor=current_user,
    action="my_module.delete",
    entity_type="thing",
    entity_id=thing_id,
    entity_name=thing.get("name", ""),
    before=before_doc,   # optional
    after=after_doc,     # optional
)
```

The helper never raises — auditing must never break the underlying op.

---

## 4. Tenant Data Export

**Endpoint:** `GET /api/tenant/export-data?token=<jwt>` (admin only)
**UI:** Audit Log page → "تنزيل بيانات الأكاديمية (ZIP)".

Streams a ZIP with one `<collection>.json` per collection plus a
`_summary.json`. `users.password` is stripped before export.

---

## 5. Tenant Deletion (Super-Admin)

Hard-delete is gated behind a **7-day grace period** + slug confirmation +
optional override.

### Schedule deletion (soft)

```
POST /super/tenants/{tenant_id}/schedule-delete
{
  "confirm_slug": "acme",
  "reason": "Customer requested closure on 2026-05-15"
}
```

Sets `status = pending_delete`, `deletion_scheduled_at`,
`deletion_purge_at` (now + 7 days). The tenant DB is **not** dropped yet.

### Cancel scheduled deletion

```
POST /super/tenants/{tenant_id}/cancel-delete
```

### Permanently delete (drops Mongo DB)

```
DELETE /super/tenants/{tenant_id}?confirm_slug=acme
```

Refuses unless **either**:

* the tenant is `pending_delete` and `deletion_purge_at` is in the past, OR
* `&force=true` is appended (emergency override; use only after offline
  customer confirmation).

After success: `status = deleted`, `db_dropped = true`, the per-tenant
Mongo database is irreversibly dropped. **Take a backup first.**

### Auto-purge scheduler (runs daily at 02:00 Riyadh)

A background loop (`tenant_purge_scheduler_loop` in `backend/server.py`)
walks `control_db.tenants` once per day looking for `pending_delete`
tenants whose `deletion_purge_at` is in the past:

1. **First detection** — emits a `tenant.auto_purge_pending` ops alert
   (severity `warning`) and stamps `final_purge_alert_sent_at` on the
   tenant doc. The actual drop is **deferred until the next tick (~24 h)**
   so super-admins have one last chance to call
   `POST /super/tenants/{id}/cancel-delete`.
2. **Next detection (still elapsed, already warned)** — drops the
   per-tenant Mongo DB via `_raw_client.drop_database(db_name)` and sets
   `status = deleted`, `deleted_at`, `db_dropped = true`,
   `deleted_by = "auto_purge_scheduler"`.
3. **On drop failure** — records `deletion_last_error[_at]`, emits a
   `tenant.auto_purge_failed` ops alert, and leaves the tenant in
   `pending_delete` so the next tick retries.

The default tenant is always skipped. To cancel an auto-purge once the
warning alert has fired but before the actual drop, call
`POST /super/tenants/{id}/cancel-delete` — `cancel-delete` already clears
`deletion_purge_at`, so the next scheduler tick treats the tenant as a
no-op.

---

## 6. Backup & Daily-Check Failure Alerts

Both background jobs now emit an **ops alert** on failure:

* `backup.failure` — auto-backup raised an exception.
* `backup.partial_failure` — more than half the collections were skipped.
* `daily_checks.failure` — the daily renewal/ads scan returned errors.

Each alert:

1. Inserts a row into `db.ops_alerts` (machine-readable, with delivery
   bookkeeping fields: `attempts`, `next_attempt_at`, `delivered_email`,
   `delivered_whatsapp`, `last_error`, `delivery_status`).
2. Inserts an admin notification into `db.notifications` (so admins see it
   on next dashboard load).
3. Logs `OPS ALERT [<kind>]: ...` to stdout (picked up by Sentry / log
   aggregator).

Outbound delivery is performed asynchronously by the **ops-alerts
delivery worker** (`ops_alerts_delivery_loop` in `backend/server.py`,
started at app startup). The worker:

* Wakes every 30 s and selects unacknowledged rows whose
  `next_attempt_at` is due.
* Attempts each enabled, configured channel; a channel that is disabled
  (per-tenant toggle) or unconfigured (env var missing) is treated as
  satisfied so the row can settle.
* On full success → sets `acknowledged: true`, `delivery_status: "delivered"`.
* On partial/failure → increments `attempts`, schedules the next try
  using exponential backoff (60 s → 5 m → 30 m → 2 h → 6 h).
* After 6 failed attempts (the 5 backoff slots above plus the initial
  try) → sets `acknowledged: true`,
  `delivery_status: "exhausted"` so the row stops cycling. The in-app
  notification + `ops_alerts` row remain for manual investigation.

### Per-tenant opt-in / opt-out

`db.notifications_settings` (key=`ops_alerts_delivery`) holds two
booleans, both defaulting to **enabled** so existing deployments are
unaffected:

| Field              | Default | Effect when `false`                              |
|--------------------|---------|--------------------------------------------------|
| `email_enabled`    | `true`  | Worker skips SMTP send for this tenant.          |
| `whatsapp_enabled` | `true`  | Worker skips Baileys send for this tenant.       |

Endpoints (admin only):

* `GET  /api/notifications/ops-alerts-settings`
* `PUT  /api/notifications/ops-alerts-settings` — body
  `{ "email_enabled": bool, "whatsapp_enabled": bool }` (either field
  optional).

Disabling a channel takes effect on the worker's next tick, including
for alerts that are already mid-retry.

### Email transport (optional)

Set every variable to enable; missing any one disables the email transport
without erroring:

| Variable               | Notes                                           |
|------------------------|-------------------------------------------------|
| `SMTP_HOST`            | e.g. `smtp.sendgrid.net`                        |
| `SMTP_PORT`            | Default `587`                                   |
| `SMTP_USER` / `SMTP_PASSWORD` | Optional (anon SMTP allowed)             |
| `SMTP_FROM`            | Defaults to `SMTP_USER`                         |
| `SMTP_TLS`             | `false` to skip STARTTLS (defaults `true`)      |
| `OPS_ALERT_EMAIL_TO`   | Recipient — required to enable                  |

### WhatsApp transport (optional)

| Variable                  | Notes                                              |
|---------------------------|----------------------------------------------------|
| `OPS_ALERT_WHATSAPP_TO`   | E.164 phone (e.g. `9665XXXXXXXX`) — required       |
| `WHATSAPP_SERVICE_URL`    | Defaults to `http://127.0.0.1:3001`                |

The side-car must be paired (QR scanned) for sends to succeed; outbound
errors are swallowed so the alert pipeline never blocks the failing job.

---

## 7. Common Production Tasks

### Restore a tenant backup

1. Locate the latest `auto_backup_YYYYMMDD.json` in `backups/`.
2. Use the existing `POST /api/backup/restore` endpoint (see
   `frontend/src/pages/BackupPage.js` for UI).
3. Verify with `GET /api/health` and a quick smoke test on
   `/admin/dashboard`.

### Investigate a suspected unauthorized change

1. Open `/admin/audit`.
2. Filter by `member.delete` / `invoice.delete` / `user.permissions.update`.
3. Cross-reference `actor_username`, time, and `diff`.
4. Export CSV for incident records.

### Production app is down

1. `curl https://<deploy>/api/health` — note `db` field and HTTP code.
2. If `db: down`, check MongoDB Atlas dashboard / IP allowlist.
3. Check Sentry for unhandled exceptions in the last hour.
4. If the process is dead, Replit Deployments will auto-restart; verify
   via `/health`.

### Rolling Sentry releases

Set `SENTRY_RELEASE=$(git rev-parse --short HEAD)` in the deployment
environment so each deploy is tagged distinctly.

---

## 8. Out-of-Scope (Tracked Separately)

* ISO / SOC 2 compliance.
* MFA / 2FA for admin login.
* Append-only / cryptographically chained audit trail.
* Auto-purge worker that hard-deletes tenants once their grace period
  elapses (currently a super-admin still finalises the deletion manually
  from `/super`).
