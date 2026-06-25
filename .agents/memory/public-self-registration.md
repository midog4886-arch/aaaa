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
- **All-branches (social-media ad):** `/register/<tenant>?src=social` — NO branch in the
  path, so the page fetches `/api/public/branches` and shows a required branch `<select>`
  the visitor picks. `?src=social` is sent as `source` and the backend stores
  `source='social_ad'` (whitelisted: only `social`/`social_ad` map to it, else `public_link`).
  The admin RegistrationRequestsPage generates this link (copy + QR) and shows an "إعلان
  سوشيال ميديا" badge on requests where `source==='social_ad'`.
  - **Why:** App.js needs BOTH routes (`/register/:tenant` AND `/register/:tenant/:branchId`);
    the branchId param is NOT optional in react-router here, so the bare-tenant route must be
    declared explicitly or the social link 404s.

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

## Gotchas
- Keep the sidebar nav `permission` and the App route `ProtectedRoute permission` in lockstep
  (both `invoices`), or staff see a menu item that the route denies.
- `update_registration_request` validates status against `{pending, processed, rejected}`.
- Admin list/update/delete are branch-scoped (`resolve_branch_filter` / `require_branch_scope`).
