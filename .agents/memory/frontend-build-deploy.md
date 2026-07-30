---
name: frontend build & deploy to backend/static
description: How the React (CRA/craco) frontend is built and served, and how to verify edits landed in the bundle
---

# Frontend build & deploy

The React frontend is PRE-BUILT and served by the FastAPI backend from `backend/static/`. `backend/main.py` reads `backend/static/index.html` into memory at startup, so a frontend source edit is NOT live until you: rebuild, copy build output into `backend/static/`, and restart the `Start application` workflow.

**Build MUST go through craco** (`yarn build` / `npx craco build`). Running `npx react-scripts build` directly fails with `Can't resolve '@/lib/utils'` — the `@` path alias lives in craco.config.js and jsconfig paths, which plain react-scripts ignores.

**Rebuild steps (from project root):**
1. `cd frontend && DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=4096 yarn build` (~45-75s; runs craco). Run it SYNCHRONOUSLY in one shell call — detached/`setsid`/`nohup` builds get killed when the tool's shell session ends, and running two builds at once corrupts the build folder (inconsistent index.html vs chunks / spurious content hashes).
2. `rm -rf backend/static/static && cp -r frontend/build/* backend/static/` (clears old hashed assets but preserves custom root files like `admin-manifest.json`, `feature-graphic.png`, `images/`).
3. `restart_workflow("Start application")` so the backend re-reads `index.html`.

**Why:** without the restart the backend serves the cached old `index.html`. Without copying, the running server never sees the new build.

**If the foreground build keeps getting KILLED at tool boundaries → run it as a temporary managed WORKFLOW.** On some sessions the synchronous foreground `craco build` exceeds the bash tool's max timeout (build ~150s) and returns -1 (killed), while `&`/`nohup`/`setsid`-detached builds get reaped when a tool call returns. Memory/OOM is NOT the cause. The reliable fix: managed workflows persist across tool boundaries (like the app's own children). Create a one-off console workflow via `configureWorkflow({name:"Build frontend", command:"cd frontend && rm -rf node_modules/.cache build && CI=false GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/craco build", outputType:"console", autoStart:true})`, then poll cheaply with short bash calls for `frontend/build/static/js/` to fill (do NOT use long `sleep`/`timeout -1` loops — they cascade a kill). When done: verify bundle, `rm -rf backend/static && cp -r frontend/build backend/static`, `restart_workflow("Start application")`, then `removeWorkflow("Build frontend")`.

**Two service-worker files exist — only `/sw.js` is registered.** `frontend/src/index.js` registers `/sw.js` (`CACHE_NAME = gcsp-academy-vNN`), which PRECACHES the app icons (`/images/icon-192/512`) and logo cache-first. The legacy `frontend/public/service-worker.js` (gcsp-academy-v2) is NOT registered — bumping it does nothing. When you replace icons/logo/manifest assets, bump `sw.js` `CACHE_NAME` (vNN→vNN+1) so the old precached assets are purged on activate, else users (and even the PWA install prompt, which fetches through the SW) keep the stale icon.

**Do NOT poll a backgrounded build with `pgrep -f "craco build"`:** the poll loop's OWN shell command line contains the substring `craco build` (inside the pgrep pattern), so `pgrep -f` matches that shell and ALWAYS reports "running" — the loop never detects completion and you end up launching multiple concurrent builds that race and emit a STALE chunk (same content hash, edit missing). Run the build in the FOREGROUND of one bash call instead and read its exit code; the established working pattern is a single synchronous foreground `craco build` (let the bash tool time out if needed — a true foreground build survives the tool timeout, but `&`-backgrounded builds get SIGKILLed when the tool call returns normally). If you must check process liveness, track the real PID file or grep the build LOG for `Compiled`/`build folder is ready`, never `pgrep` a pattern that appears in your own command.

**Verifying an edit actually landed in the bundle:**
- Pages like `MembersPage.js` are CODE-SPLIT into hashed `chunk.js` files, NOT `main.*.js`. Grepping only `main.*.js` gives false negatives — search ALL of `build/static/js/*.js` (e.g. `grep -rl "text" build/static/js/`).
- terser ESCAPES non-ASCII to `\uXXXX`, so Arabic string literals will NOT match a literal-Arabic grep. Verify using an ASCII substring of the edit instead.
- Server runs on port 5000. Verify served output with `curl -s http://localhost:5000/...`.

**Stale "update not showing" after deploy → bump the Service Worker cache:**
- `frontend/public/sw.js` caches static JS/CSS **cache-first**, so a deployed code change can still be served stale from Cache Storage. When deployed bundle is verified correct but the user still sees old UI, bump `CACHE_NAME` (e.g. `gcsp-academy-vN` → `vN+1`), then rebuild+redeploy.
- **Why it works:** changing the SW byte content triggers a SW update on next load; the `activate` handler deletes every cache whose name !== `CACHE_NAME`, purging stale precache + hashed chunks, and `skipWaiting`+`clients.claim` take over so fresh assets are fetched (may self-heal after one reload).
- The legacy `frontend/public/service-worker.js` (gcsp-academy-v2) is NOT registered — only `/sw.js` is (via `frontend/src/index.js`). Ignore the legacy file.
