---
name: Mongo send-response test realism
description: Why outbound messaging tests must exercise Mongo insert mutation and HTTP JSON serialization.
---

Outbound-message regression tests must model Motor adding a real BSON ObjectId to the dictionary passed to insert_one, and must exercise HTTP response serialization, not merely await a route handler.

**Why:** A provider can send successfully and the database can persist the message, yet FastAPI can fail serializing the mutated dictionary. The composer then retains the draft, misleading staff into sending it again. Simplified database mocks and direct route-return assertions missed this failure.

**How to apply:** Keep internal Mongo fields outside public response payloads. Verify successful sends return JSON success once, while genuine send failures remain errors. Never resolve a post-send response failure by automatically resending.

Motor methods can also return asyncio Futures rather than native coroutine objects. Concurrency wrappers must accept either; test a synchronous fake method returning a real Future, not only async-def mocks. Otherwise create_task-based wrappers may pass tests and fail against the real driver.