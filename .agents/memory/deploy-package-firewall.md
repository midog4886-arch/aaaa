---
name: Deployment package-firewall 403 on pinned deps
description: Why a deploy build can suddenly 403 on a dependency that worked earlier, and how to fix it.
---

# Deployment pip build: package-firewall 403 on a pinned version

The publish/build step installs Python deps through `package-firewall.replit.local`. It can return **HTTP 403 Forbidden** for a *specific pinned version* of a package — typically a known-CVE version that gets quarantined. Symptom: build fails in the "Installing/Starting Build" pip phase with `403 Client Error: Forbidden for url: .../<pkg>-<ver>...whl.metadata`.

**Key gotcha:** the same pin can build fine one hour and 403 the next (policy update or wheel-cache expiry). A 403 (not a 5xx/timeout) means policy block, not transient infra — don't just retry.

**Fix:** bump the pin to a firewall-allowed (CVE-fixed) version. Verify with `python -m pip download <pkg>==<ver> --no-deps -d /tmp/x` against the same firewall before re-publishing.

**This repo has TWO dependency sources** that both run at build time: `pyproject.toml` (uv sync) and `backend/requirements.txt` (pip install). Keep versions aligned across both — a stale pin in `requirements.txt` can 403 even when `pyproject.toml` already specifies an allowed version.

**Why:** first real incident — `python-jose==3.3.0` (algorithm-confusion + JWT-bomb CVEs) was blocked; it was also dead code (app uses `pyjwt`, never imports `jose`). Aligned `requirements.txt` to `pyproject.toml`'s `>=3.5.0`.
