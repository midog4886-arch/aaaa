---
name: frontend build & deploy to backend/static
description: How the React (CRA/craco) frontend is built and served, and how to verify edits landed in the bundle
---

# Frontend build & deploy

The React frontend is PRE-BUILT and served by the FastAPI backend from `backend/static/`. `backend/main.py` reads `backend/static/index.html` into memory at startup, so a frontend source edit is NOT live until you: rebuild, copy build output into `backend/static/`, and restart the `Start application` workflow.

**Rebuild steps (from project root):**
1. `cd frontend && DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=4096 yarn build` (~45-75s; runs craco). Run it SYNCHRONOUSLY in one shell call — detached/`setsid`/`nohup` builds get killed when the tool's shell session ends, and running two builds at once corrupts the build folder (inconsistent index.html vs chunks / spurious content hashes).
2. `rm -rf backend/static/static && cp -r frontend/build/* backend/static/` (clears old hashed assets but preserves custom root files like `admin-manifest.json`, `feature-graphic.png`, `images/`).
3. `restart_workflow("Start application")` so the backend re-reads `index.html`.

**Why:** without the restart the backend serves the cached old `index.html`. Without copying, the running server never sees the new build.

**Verifying an edit actually landed in the bundle:**
- Pages like `MembersPage.js` are CODE-SPLIT into hashed `chunk.js` files, NOT `main.*.js`. Grepping only `main.*.js` gives false negatives — search ALL of `build/static/js/*.js` (e.g. `grep -rl "text" build/static/js/`).
- terser ESCAPES non-ASCII to `\uXXXX`, so Arabic string literals will NOT match a literal-Arabic grep. Verify using an ASCII substring of the edit instead.
- Server runs on port 5000. Verify served output with `curl -s http://localhost:5000/...`.
