# 20 — LearnQuest Render TypeScript Build-Failure Remediation

- **Date:** 2026-10-28
- **Repository:** `E:\progressGameTracker`
- **Branch:** `main`
- **Base revision:** `d77635dd8c9f0d86c25cef032e2c6997c66cbd09` (`Harden LearnQuest for production release`)
- **Scope:** Render dependency installation, TypeScript compilation, source typing, production-build verification, and the exact Render service settings.
- **Production deployment performed:** **No.** No commit, push, deploy, dashboard change, secret rotation, migration, or destructive database operation was performed.

---

## 1. Executive summary

The Render failure was caused by the interaction of two correct settings:

1. The service runs with `NODE_ENV=production`.
2. The build command was `npm ci && npm run build`.

Under `NODE_ENV=production`, npm omits `devDependencies`. The backend keeps the TypeScript compiler and every `@types/*` package in `devDependencies`. As a result, a clean Render build has no `tsc`, no `@types/node`, no `@types/express`, and no `@types/cors`.

The reported compiler errors are the same failure at its next stage. If a compiler is available but the type packages are absent, TypeScript cannot resolve `process`, `Buffer`, `node:*` modules, or Express request types. `AuthedRequest extends Request` then has no usable `Request` base, so `params`, `body`, and `get` appear missing, and Express callback parameters become implicit `any`. The MongoDB diagnostic, migration, inspection, retirement, and server scripts fail for the same reason.

The repair is deliberately small:

- Install build dependencies explicitly on Render with `npm ci --include=dev`.
- Keep `NODE_ENV=production`, `rootDir: backend`, `npm run start`, and `NODE_VERSION=24.22.1`.
- Align `@types/node` with the Node 24 runtime (`^24.19.2`).
- Add a deployment-config regression assertion for the install command.
- Correct the live deployment documentation.

No application route, authorization check, runtime validation, strict compiler option, or runtime dependency was changed. With the corrected install, all 158 errors reproduced during the controlled missing-types experiment disappear, and the backend typechecks and builds cleanly under Node 24.22.1.

**Local verification succeeded. Production deployment did not occur.** The Render service remains on its previously deployed revision until the owner commits, pushes, and deploys this working tree.

---

## 2. Baseline and constraints

The working tree started clean except for the untracked remediation prompt:

```text
?? LEARNQUEST_RENDER_TYPESCRIPT_BUILD_FAILURE_FIX_PROMPT_2026-10-28.txt
```

The pre-existing code was preserved. No reset, clean, stash, branch switch, commit, push, deployment, or production dashboard change was made.

Report 19 recorded a passing local backend build. That pass was real but did not exercise Render's production install semantics: the local QA environment already had devDependencies installed. The missing test was a clean `npm ci` with `NODE_ENV=production`. This report adds that exact reproduction.

The application's production security validation remains intact:

- `NODE_ENV` must be exactly `development`, `test`, or `production`.
- Render (`RENDER=true`) refuses to start in a non-production mode.
- Production origin, cookie, database, OAuth, email, and HMAC checks remain fail-closed.
- No production value was changed to make the build pass.

---

## 3. Actual service layout and Render configuration found in source

There is no root `package.json`, no npm workspace, and no root lockfile. The backend is an independent npm package.

| Item | Source configuration |
|---|---|
| Render service | `learnquest-api` |
| Runtime | Node |
| Root directory | `backend` (`rootDir: backend`) |
| Package manager | npm |
| Lockfile | `backend/package-lock.json`, lockfile version 3 |
| Original build command | `npm ci && npm run build` |
| Start command | `npm run start` |
| Start target | `node dist/server.js` |
| Health check | `/api/health` (liveness only; readiness is `/api/ready`) |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.22.1` |
| `PORT` | Not set; Render supplies it |
| Backend engine | `>=24.22.1 <25` |
| `.node-version` | `24.22.1` |

Because Render applies `rootDir: backend` before running build and start commands, the commands must **not** contain `cd backend`. Adding `cd backend` while the root directory is already `backend` would look for `backend/backend`.

The Render dashboard itself was not accessible. The values above are the repository blueprint values and are marked dashboard-unverified where applicable.

---

## 4. Demonstrated root cause

### 4.1 Exact Render-equivalent install

From `backend`, with the production environment used by Render:

```powershell
$env:NODE_ENV='production'
npm ci
```

Observed result:

```text
added 101 packages, and audited 102 packages
tsc present: False
@types/node present: False
@types/express present: False
```

The subsequent configured build:

```powershell
$env:NODE_ENV='production'
npm run build
```

failed with:

```text
> learnquest-backend@0.3.0 build
> tsc -p tsconfig.json

'tsc' is not recognized as an internal or external command,
operable program or batch file.
EXIT=1
```

This is the clean first failure surface: the compiler itself is absent.

### 4.2 The reported TypeScript errors reproduced

A compiler can still be present through a cached/global/partially installed toolchain while the type packages are omitted. To isolate that case without changing source, only `backend/node_modules/@types` was temporarily renamed and the local compiler was run with the unchanged `tsconfig.json`:

```powershell
$env:NODE_ENV='production'
Rename-Item node_modules\@types node_modules\@types.__disabled__
npm run typecheck
```

Result: **158 TypeScript errors**, reproducing every category in the Render failure report:

```text
src/config/env.ts(9,15): error TS2580: Cannot find name 'process'.
src/auth/crypto.ts(20,14): error TS2580: Cannot find name 'Buffer'.
src/app.ts(4,28): error TS2307: Cannot find module 'node:crypto'.
src/app.ts(1,21): error TS7016: Could not find a declaration file for module 'express'.
src/routes/playlists.ts(28,65): error TS7006: Parameter 'res' implicitly has an 'any' type.
src/routes/playlists.ts(30,30): error TS2339: Property 'params' does not exist on type 'AuthedRequest'.
src/routes/playlists.ts(42,48): error TS2339: Property 'body' does not exist on type 'AuthedRequest'.
src/auth/middleware.ts(122,24): error TS2339: Property 'get' does not exist on type 'AuthedRequest'.
src/scripts/diagnoseMongo.ts(2,33): error TS2307: Cannot find module 'node:dns'.
src/scripts/migrateUserData.ts(2,27): error TS2307: Cannot find module 'node:fs/promises'.
src/scripts/inspectUserData.ts(65,26): error TS2580: Cannot find name 'process'.
src/server.ts(10,16): error TS2580: Cannot find name 'process'.
```

`@types` was then restored and the unchanged compiler configuration was rerun:

```text
TYPECHECK_EXIT=0
```

No source edit was made between the 158-error run and the zero-error run. This is the controlled proof that the route and script errors are downstream effects of missing declarations, not independent source defects.

### 4.3 Why `AuthedRequest` appeared broken

`backend/src/auth/middleware.ts` already declares:

```ts
export interface AuthedRequest extends Request {
  auth?: AuthContext;
}
```

That contract is correct. It extends the real Express `Request`. When `@types/express` is absent, `Request` cannot be resolved, so the compiler has no `params`, `body`, `get`, `headers`, or response/next contextual types to inherit. The middleware handlers and route callbacks are already typed with `Request`, `Response`, `NextFunction`, and `AuthedRequest`; they did not need `any`, `@ts-ignore`, broad assertions, or a rewrite.

The same explanation covers the diagnostic, migration, inspection, retirement, and server scripts. They are inside `src/**/*` and remain fully typechecked.

### 4.4 Compiler configuration audit

`backend/tsconfig.json` was not changed:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

Findings:

- `strict: true` is preserved.
- There is no `types` or `typeRoots` override suppressing Node or Express declarations.
- `include: ["src/**/*"]` covers routes, middleware, scripts, and `server.ts`.
- No script was excluded to hide an error.
- `skipLibCheck` is pre-existing and was not changed.
- TypeScript 5.9.3 is present in `devDependencies` through `^5.6.0`.
- `@types/express` 4.17.25 and `@types/cors` are present and match Express 4.22.3.
- `@types/node` was the only version mismatch: it tracked Node 22 while the engine and Render runtime require Node 24.

---

## 5. Changes made

Five tracked project files changed in the repair, plus this new report and the audit archive index. No runtime source file changed.

| File | Change | Reason |
|---|---|---|
| `render.yaml` | Build command changed to `npm ci --include=dev && npm run build`; explanatory comment added | Forces build-only dependencies to install while `NODE_ENV=production` remains set. |
| `backend/package.json` | `@types/node` changed from `^22.0.0` to `^24.19.2` | Aligns Node declarations with the Node 24 runtime required by `engines` and `.node-version`. |
| `backend/package-lock.json` | Regenerated for the `@types/node` change | Keeps the correct lockfile authoritative. |
| `backend/tests/deployment-config.test.ts` | Added assertions for `rootDir: backend`, the `--include=dev` build command, and `npm run start` | Prevents the production install regression from returning unnoticed. |
| `README.md` | Corrected the live Render build command and documented why `--include=dev` is required | Keeps operator-facing deployment instructions consistent with `render.yaml`. |

### 5.1 What did not change

- No change to `backend/src/routes/playlists.ts`.
- No change to `backend/src/auth/middleware.ts`.
- No change to `backend/tsconfig.json`.
- No change to `NODE_ENV`; it remains `production`.
- No change to `PORT`; Render continues to supply it.
- No production dependency was moved, removed, or added.
- No security validation, input validation, authorization check, or runtime behavior changed.
- No `any`, `@ts-ignore`, `@ts-expect-error`, lint disable, test skip, or compiler strictness reduction was introduced.
- No root package, workspace, alternate lockfile, or `.npmrc` was invented.
- No dependency pruning was added. The runtime still imports only production code from `dist`; leaving build tooling in the build slug is not required at runtime but is safer than an unproven prune step.

---

## 6. Dependency and lockfile details

### 6.1 Build-critical packages

| Package | Manifest range | Locked version | Role |
|---|---|---|---|
| `typescript` | `^5.6.0` | `5.9.3` | Compiler used by `npm run build` and `npm run typecheck` |
| `@types/node` | `^24.19.2` (was `^22.0.0`) | `24.19.2` (was `22.20.5`) | Node globals and `node:*` modules, including the scripts |
| `@types/express` | `^4.17.21` | `4.17.25` | Express request/response/middleware types |
| `@types/cors` | `^2.8.17` | Present | CORS middleware types |
| `@types/supertest` | `^6.0.2` | Present | HTTP test types |
| `tsx` | `^4.19.0` | Present | TypeScript script runner |
| `vitest` | `^4.1.12` | `4.1.12` | Test runner |
| `eslint` / `typescript-eslint` | `^10.13.0` / `^8.72.1` | Present | Lint gate |

### 6.2 Lockfile delta

Only the Node type package subtree changed:

```text
@types/node   22.20.5 -> 24.19.2
undici-types   6.21.0 -> 7.24.6
```

The lockfile remains version 3 and remains `backend/package-lock.json`. No production dependency version changed.

The dependency alignment was validated under the pinned runtime before being adopted. The backend typecheck and production build both pass with `@types/node` 24.19.2.

### 6.3 Install semantics

`npm ci --include=dev` is the supported npm pattern for this case. It installs the locked production and development dependency graph while `NODE_ENV=production` remains in effect. The command was verified with the repository's actual lockfile; no ad hoc install or alternate lockfile was used.

For completeness, npm config resolution showed that the CLI `--include=dev` countermands the production omission, including when `NPM_CONFIG_PRODUCTION` or `NPM_CONFIG_OMIT` is present. No such variable is documented as part of this service, but the build command is robust to the common npm production settings.

---

## 7. Verification environment

The repository requires Node `>=24.22.1 <25`. The machine's default `node` was 24.11.0, which correctly produced an engine warning during the reproduction. Final validation used the official Node 24.22.1 Windows x64 distribution downloaded from `nodejs.org`.

| Item | Value |
|---|---|
| Runtime | Node `v24.22.1` |
| npm | `11.19.1` |
| Archive | `node-v24.22.1-win-x64.zip` |
| SHA-256 expected | `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5` |
| SHA-256 actual | `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5` |
| Checksum source | Official `SHASUMS256.txt` for v24.22.1 |

The checksum matched before the archive was used. The local machine's default Node remains 24.11.0; this does not affect Render, which is pinned to 24.22.1.

---

## 8. Exact verification commands and fresh results

### 8.1 Backend

All final backend checks were run under Node 24.22.1.

```powershell
# Clean production install with build dependencies
$env:NODE_ENV='production'
npm ci --include=dev

# Strict compiler check, no emit
$env:NODE_ENV='production'
npm run typecheck

# Lint
$env:NODE_ENV='production'
npm run lint

# Test suite (vitest selects test mode; build environment is not required here)
npm test

# Production build
$env:NODE_ENV='production'
npm run build
```

| Check | Result |
|---|---|
| Clean install | **PASS**; 277 packages added; 0 vulnerabilities; `tsc`, `@types/node` 24.19.2, and `@types/express` 4.17.25 present |
| `npm run typecheck` | **PASS**, exit 0 |
| `npm run lint` | **PASS**, 0 errors, 86 warnings (pre-existing `no-explicit-any` style warnings) |
| `npm test` | **PASS**, 25 test files / 201 tests |
| `npm run build` | **PASS**, exit 0; `backend/dist/server.js` emitted (4,482 bytes) |
| `npm audit --audit-level=low` | **PASS**, 0 vulnerabilities |

No test was skipped or weakened. The test count matches the Report 19 baseline.

### 8.2 Frontend regression check

The backend fix does not alter frontend configuration, but the frontend was revalidated under the same runtime because the repository ships both applications.

| Check | Result |
|---|---|
| Clean install (`npm ci --include=dev`) | **PASS**, 0 vulnerabilities |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS**, 0 errors, 4 pre-existing `react-hooks/exhaustive-deps` warnings |
| `npm test` | **PASS**, 42 test files / 351 tests |
| `npm run build` | **PASS**; 2,253 modules transformed; `dist/index.html`, `assets/index-BJYYPxXz.js` (418.02 kB), `assets/index-3B-2hnD2.css` |
| `npm audit --audit-level=low` | **PASS**, 0 vulnerabilities |

No frontend source or configuration file changed.

### 8.3 Diff and repository hygiene

```text
git diff --check
DIFF_CHECK_EXIT=0
```

Only Git's expected LF/CRLF conversion notices appeared. There were no whitespace errors.

### 8.4 Compiled-server smoke test

The production artifact was started directly, matching the configured start target, with sanitized test configuration only:

- Working directory outside the repository so no real `.env` was loaded.
- `DOTENV_CONFIG_PATH` pointed at an empty file.
- `NODE_ENV=test`.
- `PORT=43123` for the local smoke test only.
- `MONGODB_URI`, Google values, Brevo values, session/HMAC secrets, YouTube key, origin overrides, and `RENDER` removed from the process environment.
- No production credentials and no database connection were used.

Observed:

```text
LearnQuest API listening on :43123 (CORS: http://localhost:5173)
LearnQuest setup required - missing: MONGODB_URI, SESSION_SECRET, ...
MongoDB is not configured. Auth and account data endpoints are disabled.

GET /api/health -> 200
{"ok":true,"liveness":true,"ready":false,...,"version":"0.3.0","setupRequired":true}

GET /api/auth/config -> 200
{"nodeEnv":"test","authEnabled":false,"setupRequired":true,...,"userDataStore":"legacy"}
```

The process was stopped after the probe. This verifies that the compiled entry point exists, starts, binds a port, and serves liveness/config without a database or production secrets. It does **not** verify production MongoDB, OAuth, email, or a live deployment.

---

## 9. Exact Render settings

### 9.1 Required values

| Setting | Exact value |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start` |
| Start target | `node dist/server.js` |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.22.1` |
| `PORT` | **Do not set.** Render supplies it. |
| Health Check Path | `/api/health` |
| Package manager | npm |
| Lockfile | `backend/package-lock.json` |

Do not run `cd backend` in the commands while Root Directory is `backend`. Do not change `NODE_ENV` to `development` or `test` to work around the install problem; that would disable production origin/cookie behavior and is explicitly rejected by `assertProductionConfig` when `RENDER=true`.

### 9.2 If the dashboard overrides the blueprint

`render.yaml` is the source of truth, but Render dashboard values can override a Blueprint. The owner must check the live service:

1. Confirm **Root Directory** is `backend`.
2. Confirm **Build Command** is exactly `npm ci --include=dev && npm run build`, not the old `npm ci && npm run build`.
3. Confirm **Start Command** is `npm run start`.
4. Confirm **NODE_ENV** is `production`.
5. Confirm **NODE_VERSION** is absent or `24.22.1`.
6. Confirm no production `PORT` override such as `3001`.
7. Remove any `NPM_CONFIG_PRODUCTION`, `NPM_CONFIG_OMIT=dev`, or similar setting if present. The new command already handles the normal production case.
8. Deploy the revision containing these changes.

If the service root were the repository root instead of `backend`, the equivalent commands would be:

```text
cd backend && npm ci --include=dev && npm run build
cd backend && npm run start
```

That is not the repository's documented layout. The preferred fix is to keep Root Directory `backend` and use the commands in Section 9.1 exactly.

No dashboard value was changed during this work.

---

## 10. Remaining blockers and limitations

### 10.1 Deployment blocker

The local production build is now reproducible and successful. **No production deployment occurred.** Until the owner commits/pushes this working tree and triggers a Render deploy, the live service remains on its previous revision.

A successful local build is not evidence of a successful deployment. Post-deploy verification must still show the current version and routes.

### 10.2 Dashboard verification

The Render dashboard and Blueprint sync state were not accessible. The repository settings are verified; the live dashboard values are not. In particular, an old dashboard build command or a dashboard-level `NODE_VERSION` override would supersede `render.yaml`.

### 10.3 Existing external blockers from Report 19

These were not changed by this build repair:

- Brevo source-IP authorization, sender/domain verification, and a controlled delivery test remain owner actions.
- Production Google OAuth client registration and the exact redirect URI remain owner-verified items.
- Production MongoDB identity/readiness remains to be confirmed after deployment.
- The Vercel project root, Node version, `/api` rewrite, and deployed asset revision remain to be confirmed after deployment.
- Existing production secrets must be preserved; none was read, printed, or rotated.

### 10.4 Non-blocking warnings

- `supertest@6.3.4` and `superagent@8.1.2` emit deprecation warnings. The test suite passes and `npm audit` reports 0 vulnerabilities. This repair did not upgrade them because that is unrelated to the build failure.
- npm 11.19.1 emitted an `allowScripts` notice for `esbuild`'s postinstall. The frontend build and tests completed successfully, so the binary path was functional. No install-script policy was changed.
- The local default Node is 24.11.0; final validation used the pinned 24.22.1 distribution. Render remains pinned to 24.22.1.

---

## 11. Security and secret handling

- No secret, database URI, password, token, or private key was printed, copied into this report, or written to a new file.
- The smoke test used only synthetic local settings and no database.
- Production `NODE_ENV`, security checks, fail-closed behavior, origin validation, cookie policy, and authorization code were preserved.
- The only dependency change is a compile-time type package; no runtime dependency or trust boundary changed.
- `git diff --check` passed.

---

## 12. Final Git status

At the completion of this report:

```text
 M README.md
 M backend/package-lock.json
 M backend/package.json
 M backend/tests/deployment-config.test.ts
 M docs/user-doc/audit2/README.md
 M render.yaml
?? LEARNQUEST_RENDER_TYPESCRIPT_BUILD_FAILURE_FIX_PROMPT_2026-10-28.txt
?? docs/user-doc/audit2/20_LEARNQUEST_RENDER_TYPESCRIPT_BUILD_FAILURE_REMEDIATION_2026-10-28.md
```

`docs/user-doc/audit2/README.md` is updated in place to index this report.

No commit, push, deploy, reset, clean, stash, branch switch, secret rotation, migration, or production dashboard change was performed.

---

## 13. Bottom line

- **Root cause:** `NODE_ENV=production` made `npm ci` omit the TypeScript compiler and `@types/*` build dependencies. The reported route, `process`/`Buffer`, and script errors were the resulting missing-declaration cascade.
- **Fix:** `npm ci --include=dev && npm run build`, with `NODE_ENV=production` unchanged.
- **Source typing:** `AuthedRequest extends Request` was already correct. No `any`, suppression, or strictness reduction was added. Under a complete install, the unchanged source typechecks with zero errors.
- **Dependencies:** `@types/node` aligned to Node 24 (`24.19.2`); lockfile updated; no production dependency changed.
- **Local verification:** backend 201 tests, frontend 351 tests, both builds pass, 0 vulnerabilities, compiled-server smoke test returns 200 under sanitized test configuration.
- **Deployment:** not performed. The owner must deploy the current revision and verify Render/Vercel afterward.
