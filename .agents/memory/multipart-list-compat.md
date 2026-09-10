---
name: Multipart file-list compatibility
description: Production FastAPI optional-file-list parsing differs from development.
---

Use `List[UploadFile] = File(default=[])` for optional multiple-file fields, not `Optional[List[UploadFile]] = File(None)`.

**Why:** The production requirements used FastAPI 0.110.1 while development used a newer version. The older sequence detector does not unwrap Optional, so it reads a single multipart value instead of getlist, causing “Input should be a valid list.” Direct endpoint unit tests and the newer runtime did not reveal the issue.

**How to apply:** Test actual multipart parsing for zero/one/multiple files, plus compatibility with the production detector. Do not upgrade the whole framework merely to resolve this field-level issue.