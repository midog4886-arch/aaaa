---
name: Public self-registration
description: How the public per-branch parent registration link works and why it is separate from registration_forms
---

# Public self-registration link

Parents open a public, unauthenticated link and submit (child name, phone, requested
activity, preferred days/time, notes).

## Two link shapes (both route to PublicRegistrationPage)
- **Branch-locked:** `/register/<tenant>/<branch_id>` — branch is FIXED to the link and
  shown read-only; the visitor cannot change it (requirement: "each link belongs to its
  branch only"). Branch is derived straight from the URL param, no local state.
- **All-branches (social-media ad):** short alias `/join/<tenant>` (preferred, cleaner for
  social sharing) — legacy `/register/<tenant>?src=social` still works unchanged. NO branch in
  the path, so the page fetches `/api/public/branches` and shows a required branch `<select>`
  the visitor picks. Source is sent as `source`: the page detects the `/join/` pathname and
  implicitly sets `source='social'` (no `?src` needed); the legacy link still passes `?src=social`.
  Backend stores `source='social_ad'` (whitelisted: only `social`/`social_ad` map to it, else
  `public_link`). The admin RegistrationRequestsPage generates the `/join/<tenant>` link
  (copy + QR) and shows an "إعلان سوشيال ميديا" badge on requests where `source==='social_ad'`.
  - **Why:** App.js needs ALL routes declared explicitly (`/register/:tenant`,
    `/register/:tenant/:branchId`, AND `/join/:tenant`); params are NOT optional in
    react-router here, so each shape must be its own `<Route>` or it 404s. `/join` must also
    be in `ACADEMY_BYPASS_PREFIXES` (like `/register`) so the academy picker guard doesn't grab it.

## Key design decisions
- Submissions land in collection `registration_requests` with `status=pending`. They are
  **NEVER auto-converted into members**. A supervisor reviews the queue and completes each
  one through the normal invoice flow.
  - **Why:** unreviewed public data must never silently become a real member.
- This is intentionally **separate** from the existing `registration_forms` flow, which DOES
  auto-create a member. Do not merge the two.
- The public page uses its **own axios instance** that sets `X-Tenant-Slug` from the URL's
  tenant slug. It must NOT clobber `localStorage.tenant_slug` (shared with admin session).
- `/register` is added to `ACADEMY_BYPASS_PREFIXES` so the academy picker guard does not
  intercept the public route.

## Process flow
- Supervisor "process" action writes a `prefill_registration` payload to `sessionStorage`,
  marks the request `processed` (so it leaves the pending queue), then navigates to
  `/admin/invoices`. InvoicesPage reads + clears the sessionStorage on mount and opens the
  registration-form dialog prefilled with name/phone/notes.

## Branding on the public page (logo + academy name)
- **Logo:** `<img src="/api/tenant/branding/logo?slug=<tenant>">` with `onError` → `/logo-new.png`.
  That logo endpoint is purpose-built for unauthenticated assets (resolves tenant by `slug`
  query param, serves tenant logo or shared fallback) — safe to call from the public page.
- **Academy name:** comes from the public registration responses (`/api/public/branches` and
  `/api/public/registration/<branch_id>` both return `academy_name`), NOT from
  `/api/tenant/branding`.
  - **Why:** `/api/tenant/branding` is unauthenticated and returns far more than the name
    (tax number, commercial reg, subscription metadata). Calling it from a fully public page
    leaks that to anonymous visitors. Expose only the display name via the existing public
    endpoints; reuse `get_current_tenant().name` server-side.

## Gotchas
- Keep the sidebar nav `permission` and the App route `ProtectedRoute permission` in lockstep
  (both `invoices`), or staff see a menu item that the route denies.
- `update_registration_request` validates status against `{pending, processed, rejected}`.
- Admin list/update/delete are branch-scoped (`resolve_branch_filter` / `require_branch_scope`).

## Activity chips are the branch's real activities
The public form's "النشاط المطلوب" chips come from GET /public/registration/{branch_id}
(branch-own activities shadow shared/global ones, is_active filter, names only —
no fees on the unauthenticated response). A small hardcoded list survives ONLY as
a fallback when a branch has no activities / fetch fails; "أخرى" always appended.
**How to apply:** don't re-hardcode activity choices on public pages; extend the
public endpoint instead, and keep it exposure-minimal (id/name/name_ar only).
