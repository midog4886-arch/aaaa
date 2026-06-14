---
name: Auth user object shape (login vs me)
description: The frontend user object differs between /auth/login and /auth/me — matters for permission-gated UI
---

# Auth user object: /auth/login vs /auth/me

`AuthContext` populates `user` from TWO different backend shapes:
- `POST /auth/login` (server.py) returns a HAND-PICKED user dict.
- `GET /auth/me` (server.py) returns the FULL user doc (minus password).

**The trap:** any field present in `/auth/me` but NOT explicitly added to the
`/auth/login` response is `undefined` immediately after a fresh login, and only
appears after a page refresh (which triggers `checkAuth` → `/auth/me`).

`permissions` was one such field. Frontend UI gated on
`user.permissions.includes(<key>)` therefore failed for non-admins right after
login until refresh.

**How to apply:** when gating UI on a user field, make sure that field is
returned by BOTH `/auth/login` and `/auth/me`. The login response must include
`permissions` (and any new per-user flag) explicitly.

**Permission keys live in 3 places — keep in sync:** the `ALL_PERMISSIONS` list
in `backend/routes/users.py` (admin grant-all + valid set), the `ALL_PERMISSIONS`
array in `frontend/src/pages/UsersPage.js` (the per-user toggle UI), and the
actual enforcement via `await require_permission(current_user, key)` on the route
(admins bypass via is_admin). Adding a permission requires editing all three.
Keys use hyphen style (e.g. `members-create`, `internal-expenses-create`).
