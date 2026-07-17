---
name: server.py local pydantic models shadow models/
description: Discount/coupon (and other) routes in server.py use their OWN local pydantic models, not backend/models/*
---

The rule: `backend/server.py` defines its own local pydantic models (e.g. `DiscountCreate`/`Discount` near the "DISCOUNT/COUPON MODELS" section) and its route handlers use those — NOT the same-named classes in `backend/models/*.py`. Adding a field only to `backend/models/discount.py` is a silent no-op until the route 500s with `AttributeError: 'DiscountCreate' object has no attribute ...`.

**Why:** During the activity-scoped offer-coupon work, `activity_ids` was added to `models/discount.py` first; coupon create then crashed with AttributeError because `create_discount` reads the server.py-local `DiscountCreate`. Same pattern as the known `routes/members.py` duplicate `MemberCreate`.

**How to apply:** When adding a field consumed by a route in server.py, grep for `class <ModelName>` across the whole backend and add the field to the copy the route actually imports/uses (usually the server.py-local one). Keep both copies in sync if the models/ version exists.
