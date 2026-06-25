---
name: members route has its own MemberCreate model
description: Adding a field to the member-create payload requires editing the route-level model, not just models/member.py
---

`backend/routes/members.py` defines its OWN `MemberCreate(BaseModel)` (around the top of the file), which is SEPARATE from the `MemberCreate` in `backend/models/member.py`. Both `POST /members` and `POST /members/quick-create` use the route-level one via `_create_member_core` (which does `member.model_dump()` and spreads into the member doc).

**Why:** pydantic BaseModel ignores unknown fields by default, so any new field sent in the create payload (e.g. `marketer_id`) is silently dropped unless it is declared on the route-level model. Editing only `models/member.py` has NO effect on the create flow and the field never persists.

**How to apply:** When adding any field that must be stored on member creation (from the Members page or the invoice quick-create flow), add it to `backend/routes/members.py` `MemberCreate`. `_create_member_core` then stores it automatically. Keep `models/member.py` in sync only if something else imports it.
