# RENDER DEPLOYMENT FIX — Backend Startup Failure (V8.1)

Date: 2026-10-13. Symptom on live Render service:

```text
> node dist/server.js
Error: Cannot find module '/opt/render/project/src/backend/dist/server.js'
code: MODULE_NOT_FOUND
```

## 1. Root cause

**The live service executed the start step without a successful backend
build, so the git-ignored `dist/` output was never created.** The
repository's build/start agreement is exact (proven below); nothing in the
repo points at the wrong path. Specifically:

- The error path `.../src/backend/dist/server.js` shows Render honors
  `rootDir: backend` at start time and runs `npm run start` → `node
  dist/server.js` (the `>` prefix is npm echoing the script).
- `backend/dist/` is git-ignored and untracked (verified: `git ls-files
  backend/dist` empty), so the file can *only* exist if the build step ran
  `tsc` in `backend/` during that deploy.
- A clean build here emits `dist/server.js` deterministically (twice,
  including once via `npm ci`), and the production entry boots with no
  devDependencies. Hence the live `dist/` absence proves the build step did
  not run or did not run in `backend/` on the failing deploy — i.e. **stale
  Render Dashboard settings** (old/empty Build Command, or Blueprint
  auto-sync off so `render.yaml` edits never applied) or a deploy pinned to
  an older commit/branch without the V8 config. Ruled out repo-side causes:
  tsconfig `rootDir: src` + `outDir: dist` guarantees flat (not
  `dist/src/`) output; no second pipeline or conflicting start command
  exists in the repo.

## 2. Build-output evidence (measured, not inferred)

Clean rebuild from `backend/` (`Remove-Item dist`; `npm install`;
`npm run build`) emitted, among others:

```text
dist/server.js   <-- production entry, exists (Test-Path: True)
dist/app.js
dist/cache/memoryCache.js
dist/config/env.js
dist/controllers/playlistController.js
dist/diagnostics/apiStats.js
dist/middleware/errors.js + rateLimit.js
dist/routes/playlist.js
dist/schemas/playlistSchemas.js
dist/services/youtube/youtubeService.js
dist/types/index.js + dist/utils/playlistId.js
```

`backend/package.json: start = node dist/server.js` points at exactly that
file. Production boot (`node dist/server.js`, plain node, no devDeps)
responded:

```json
{"ok":true,"hasKey":true,"version":"0.2.0","time":"..."}
{"ok":true,"entries":0,"approxBytes":0,"maxEntries":50,"api":{...counters}}
```

from `/api/health` and `/api/cache`. No YouTube calls were made.

## 3. Files changed and why

- `render.yaml`: build `npm install && npm run build` → **`npm ci && npm
  run build`**. The committed `backend/package-lock.json` (verified tracked
  at HEAD `a615bfd`) supports it — trial `npm ci` succeeded, then build +
  18/18 tests + typecheck passed. Deterministic installs fail loudly on
  lock/package drift instead of silently resolving new versions mid-deploy;
  `npm install` retained nowhere in the deploy path.
- `README.md`: one-line deploy snippet updated to the same command.
- Nothing else: no route, env-var, auth, cache, storage, or learning-logic
  changes (per scope).

## 4. Final `render.yaml` (relevant stanza)

```yaml
services:
  - type: web
    name: learnquest-api
    runtime: node
    rootDir: backend
    buildCommand: npm ci && npm run build
    startCommand: npm run start
```

All commands are `backend/package.json` scripts, interpreted relative to
`rootDir: backend`. No `--workspace` flags (they fail outside a workspace
root — the V8 defect this replaces).

## 5. Verification results (actually run, from `backend/`)

| Check | Result |
|---|---|
| `npm ci` from committed lockfile | success (235 pkgs) |
| `npm run build` (`tsc -p tsconfig.json`) | success; `dist/server.js` exists |
| `npm test` | 18/18 pass |
| `npm run typecheck` | clean |
| Prod boot `node dist/server.js` (PORT=3002) | `/api/health {ok:true,hasKey:true}`, `/api/cache` bounded stats |
| Full sequence `npm run build` → `Test-Path dist/server.js` → `npm run start` → health (PORT=3003) | success end to end |
| Frontend impact | none (no shared-config changes; frontend suite 168/168 held at V8) |

## 6. What was verified where

- **Locally verified**: everything in §5, on this machine (Node v24.11.0).
- **Simulated**: the exact Render build/start command sequence with
  `backend/` as working directory (same commands, same order, fresh
  `node_modules` via `npm ci`).
- **NOT verified**: the live Render deploy itself (no dashboard access from
  here) — no live success claimed.

## 7. Manual Render Dashboard actions still required

In the Render Dashboard for service `learnquest-api`:

1. Confirm **Root Directory = `backend`**.
2. Set **Build Command = `npm ci && npm run build`** (or enable Blueprint
   auto-sync so `render.yaml` applies; if auto-sync is on, just redeploy).
3. Set **Start Command = `npm run start`**.
4. Confirm **Branch = `main`** (commit `a615bfd` or later, which contains
   `backend/package-lock.json` — required for `npm ci`).
5. **Clear the build cache** and choose **Manual Deploy → Deploy latest
   commit** (eliminates any cached `node_modules`/stale-image state from
   failed runs).
6. After deploy, open `<service-url>/api/health` and expect
   `{"ok":true,"hasKey":...}` with no `MODULE_NOT_FOUND` in logs.

## Verdict (V8.1)

`PARTIALLY FIXED — DASHBOARD ACTION REQUIRED`

---

## V8.2 follow-up: failure persists — push state and lifecycle re-verified

### Push proof (rules out "fix never deployed" as a repo-side gap)

- Branch `main` is the only branch; remote HEAD = `origin/main` =
  `0850079` = local HEAD (verified via `git fetch` + `git rev-parse`).
  The V8.1 fix **is committed and pushed**.
- `render.yaml`, backend scripts (`build: tsc -p tsconfig.json`,
  `start: node dist/server.js`), tsconfig (`outDir: dist`,
  `rootDir: src`), and `backend/package-lock.json` (lockfileVersion 3 —
  compatible with any Render Node/npm) confirmed present at `origin/main`.
- `backend/dist/` confirmed untracked at HEAD: the file can only appear via
  the build step, so its live absence proves the build step did not run (or
  not in `backend/`) on the failing deploy — not a wrong path in the repo.

### Lifecycle re-verification (this pass, from `backend/`, pushed-code state)

| Check | Result |
|---|---|
| Clean `npm ci` (dist removed first) | success |
| `npm run build` | success; `dist/server.js` exists (13 emitted files, flat — no `dist/src/`) |
| Exact configured command `npm run start` (PORT=3004) | boots; `/api/health {ok:true,hasKey:true}` |
| `npm test` / `npm run typecheck` | 18/18 pass; clean |

No repo changes were required or made for the lifecycle itself: build
output, start script, and execution directory already agree exactly.

### Narrowed cause and what I still cannot see

With the pushed commit proven correct, the remaining possible causes are
all dashboard-side: manual Build/Start commands overriding the Blueprint,
Blueprint auto-sync off (or wrong Blueprint linked), a pinned/stale deploy,
or a poisoned build cache. I have no Render dashboard/API access from this
environment, so I cannot read the effective settings or the Build Logs —
**this limitation is explicit, not assumed.**

### To resolve, provide ONE of the following

1. The service's **Build Logs** of the failing deploy (commit hash shown at
   top, effective root directory, exact build command echoed, `npm ci` and
   `tsc` output, and whether `dist/server.js` was listed); or
2. A screenshot (or copy) of Dashboard → service → **Settings** showing
   Root Directory, Build Command, Start Command, Branch, and whether
   Blueprint auto-sync is on; or
3. Confirmation after performing §7 steps 1–6 above (especially **clearing
   the build cache** and redeploying `0850079`), plus the new deploy's
   health-check result.

### What NOT to do

Do not commit `dist/`, add placeholder files, or rewire the start script:
the configuration is already correct, and workarounds would hide a
dashboard-sync problem while creating a second deployment truth.

## Verdict (V8.2)

`DASHBOARD CONFIGURATION CHANGE REQUIRED`
