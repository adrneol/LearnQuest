# Report 19 - LearnQuest Final Release Remediation, Environment Reconciliation, and Release QA (2026-10-28)

**Repository:** `E:\progressGameTracker`  
**Branch:** `main`  
**Baseline HEAD:** `a24fa02` (`partial fix 2`)  
**Report date:** 2026-10-28  
**Scope owner:** final pre-release remediation after Reports 15-18

## 0. Execution policy and `#max` statement

The strongest available model exposed to this run was `opencode/deepseek-v4.1-flash-free` (DeepSeek V4.1 Flash Free). The harness did not expose a `#max` reasoning variant, and no CLI or model metadata confirmed that a `#max` mode was active. I therefore **do not claim** that `#max` was used or confirmed. The work was performed at the highest practical effort available in this invocation.

No commit, push, reset, clean, stash, branch switch, deployment, Render/Vercel dashboard change, production secret rotation, live account deletion, migration, collection cleanup, or other destructive live database operation was performed. The only production-facing operations were read-only HTTP probes and read-only MongoDB diagnostics.

---

## 1. Executive release-readiness verdict

**Code-side remediation and local QA: PASS for the reviewed working tree.**  
**Production release: NO-GO until the owner performs the deployment and external verification steps below.**

The working tree now contains the remediation for the confirmed source defects from Reports 15-18:

- account deletion is fenced and drains already-admitted writers before its sweep;
- imports/restores use a MongoDB transaction and fail closed instead of relying on best-effort rollback;
- Google OAuth state is bound to the initiating browser through a short-lived HttpOnly flow cookie;
- security-sensitive rate limits use a shared MongoDB-backed atomic store and fail closed;
- a restrictive CSP and browser security headers are defined for the Vercel-hosted frontend;
- TTL housekeeping and the earlier CORS, `NODE_ENV`, optimistic-version, and account-refresh fixes remain in place.

The required local environment file, `backend/.env`, was reconciled without printing secret values. It now contains all 29 active application keys plus the five retained legacy compatibility keys. A new local-only email-action HMAC secret was generated directly into the file, and the existing session and legacy OTP secrets were preserved.

The release is still blocked by external and owner-controlled items:

1. **The live deployments are stale and mutually incompatible.** Render still reports `version:"0.2.0"` and returns 404 for `/api/ready` and `/api/auth/config`; Vercel still serves the old `index-RgZDAXlN.js` asset and returns 404 for `/api/health`. The current source is `0.3.0`.
2. **Brevo delivery remains externally blocked** by the previously verified HTTP 401 source-IP authorization failure. No email was sent during this audit and no delivery is claimed.
3. **The local MongoDB identity is not the restricted development identity.** The local URI username is present but is not `learnquest_dev_user`, the path and configured database are both `learnquest`, and the local read-only diagnostic connected successfully. Do not use this local configuration for development writes or destructive work until the owner creates/verifies a restricted `learnquest_dev` identity.
4. **Production Google OAuth registration and Render/Vercel dashboard values cannot be confirmed from this repository.** The source blueprint values are documented, but the live dashboards and Google Cloud Console still require owner verification after deployment.

No source-affecting blocker from the remediation scope remains known and reproducible after the fixes and tests below. The remaining blockers are deployment, external-provider configuration, and owner data-boundary actions, not a green field to declare production ready.

---

## 2. Baseline and repository/environment files inspected

### 2.1 Git baseline

| Item | Observed |
|---|---|
| Branch | `main` |
| HEAD | `a24fa02` (`partial fix 2`) |
| Remote | `origin https://github.com/adrneol/LearnQuest.git` |
| Relation to remote | `main` is **9 commits ahead** of `origin/main` |
| Working tree | Modified tracked files plus new untracked source/test/documentation files; no staged files |
| Commit/push/deploy performed | **No** |
| Branch switch, reset, clean, stash | **No** |

The existing Report 18 working-tree changes and the earlier Reports 15-18 files were treated as user work and preserved.

### 2.2 Audit and source material read

- `LEARNQUEST_FINAL_RELEASE_REMEDIATION_ENV_AUDIT_PROMPT_2026-10-28.txt`
- `docs/user-doc/audit2/README.md` (single archive index)
- Reports 15, 16, 17, and 18 under `docs/user-doc/audit2/`
- The complete current Git diff and untracked files
- Backend configuration, startup, database adapters, auth, sessions, OAuth, action tokens, account routes, deletion, learning-data services, rate limiting, maintenance, email adapter, tests, and scripts
- Frontend API client, auth/account UI, build configuration, Vercel configuration, and tests
- `render.yaml`, `frontend/vercel.json`, `.gitignore`, backend/frontend `.env.example`, `backend/.node-version`, package manifests and lockfiles
- The real active environment loader and the actual local environment file

### 2.3 Which environment file the backend actually loads

`backend/src/config/env.ts` begins with:

```ts
import 'dotenv/config';
```

The backend therefore loads `.env` from its process working directory, which is `backend/` for the documented `npm run dev` / `npm start` commands. The active local file is `backend/.env`.

Additional checks:

- root `.env` does **not** exist;
- `frontend/.env.local` does **not** exist;
- `frontend/.env.example` exists and documents only `VITE_API_BASE_URL`;
- `backend/.env.example` is the safe template;
- `backend/.env` is untracked and ignored by `.gitignore` (`backend/.env` matched `.gitignore:13:.env`);
- no real `.env` path appears in reachable Git history output;
- no real `.env` file is tracked.

### 2.4 Local runtime and package baseline

| Item | Observed |
|---|---|
| Local default Node | `v24.11.0` |
| Local npm | `11.6.1` |
| QA Node used | `v24.22.1` via the official `node@24.22.1` package and PATH prepend |
| Backend engines | `>=24.22.1 <25` |
| Frontend engines | `>=24.22.1 <25` |
| Backend runtime pin | `backend/.node-version` = `24.22.1` |
| Render blueprint Node | `NODE_VERSION=24.22.1` |
| Frontend production version | `0.2.0` |
| Backend production version | `0.3.0` |

The local default Node was not used for the final QA runs; everything in the QA tables below was executed under `v24.22.1`.

---

## 3. Confirmed defects from Reports 15-18 and current status

| # | Defect from Reports 15-18 | Current status | Evidence / disposition |
|---|---|---|---|
| 1 | Live Render and Vercel deployments were stale and mutually incompatible; auth, readiness, and recovery could not work live. | **Still present - external/deployment blocker** | Render `/api/health` reports `0.2.0`; `/api/ready` and `/api/auth/config` return 404. Vercel serves old asset `index-RgZDAXlN.js`; `/api/health` returns 404. Current source is `0.3.0`. |
| 2 | Brevo email was blocked by HTTP 401 source-IP authorization. | **Still present - external provider blocker** | No live send was attempted in this audit. The Brevo request path remains server-side, timeout-bounded, and sanitized. A provider acceptance or delivery claim would be unsupported. |
| 3 | Local MongoDB development identity and database boundary were inconsistent with the restricted `learnquest_dev_user` / `learnquest_dev` setup. | **Still present - owner action** | The local URI has a username, but it is **not** `learnquest_dev_user`; the URI path and `MONGODB_DB_NAME` both resolve to `learnquest`. The read-only diagnostic connected and pinged successfully. No local data was written. |
| 4 | Account deletion could race an already-authenticated write and falsely report completion. | **Fixed in source** | Account write leases, a non-PII deletion fence, writer drain, collection coverage, and final verification were added. Two new deletion-race tests pass. |
| 5 | Import/restore used best-effort rollback and could leave partial data. | **Fixed in source** | MongoDB session transactions and an in-memory transaction equivalent were added; imports fail closed with `ATOMICITY_UNAVAILABLE` when no transaction capability exists. Three import-integrity tests pass. |
| 6 | OAuth state was not bound to the initiating browser. | **Fixed in source** | A random 32-byte `__Host-lq_oauth`/`lq_oauth` HttpOnly cookie is issued at start; only its SHA-256 digest is stored with the state; completion requires the digest, expiration, and atomic single-use consumption. Tests cover missing, mismatched, valid, and replayed bindings. |
| 7 | Security-sensitive rate limiting used process-local counters. | **Fixed for login, OAuth, reset, and email-action endpoints** | A MongoDB-backed atomic fixed-window limiter stores only hashed keys with Date TTLs and fails closed when the store is unavailable. The generic `/api` limiter remains process-local and is recorded as residual risk. |
| 8 | No frontend CSP and incomplete security headers. | **Fixed in source; not live-verified** | `frontend/vercel.json` now defines CSP plus `X-Frame-Options`, HSTS, Permissions-Policy, Referrer-Policy, and nosniff. Static configuration tests pass. The live Vercel deployment still lacks the headers because it is stale. |
| 9 | Forgot-password response time could differ for eligible and unknown accounts. | **Residual low-risk timing observation** | Public body/status is generic; shared rate limit and resend cooldown apply. No artificial sleep or expensive attacker-controlled work was added. Exact constant-time response equalization would require an outbox/background delivery design and remains future hardening, not a release blocker by itself. |
| 10 | Generic `/api` rate limiter was process-local. | **Residual low-risk** | Security-sensitive auth/email endpoints now share a Mongo-backed limiter. The broad `/api` limiter remains per-process; a multi-instance deployment can still multiply the broad request budget. Documented for owner capacity decisions. |
| 11 | Public `/api/cache` operational counters. | **Residual low-risk** | Not changed; these are non-account operational metadata. Owner may restrict at the edge if concerned. |
| 12 | Local `@types/node` 22 with Node 24 runtime. | **Residual development-only** | Not a runtime security finding and not changed in this pass; an update should be planned and tested. |
| 13 | Production CORS allowlist could accept insecure/local/credentialed extra origins. | **Fixed in prior Report 18 work and retained** | `backend/src/config/env.ts` now validates the complete merged allowlist, including HTTPS/public/no-credentials in production. Tests pass. |
| 14 | `NODE_ENV` accepted arbitrary strings and Render could run non-production. | **Fixed in prior Report 18 work and retained** | Exact-value validation and `RENDER=true` non-production refusal are present. Tests pass. |
| 15 | Optimistic state-version baseline race could reset a version. | **Fixed in prior Report 18 work and retained** | Insert-and-reread plus compare-and-set retry remain in `backend/src/services/userData.ts`; regression tests pass. |
| 16 | Account "Refresh account state" did not reload cloud data and hid failures. | **Fixed in prior Report 18 work and retained** | It now refreshes the profile and cloud data with busy/success/error states. Frontend tests pass. |
| 17 | Report 17 session-status, cross-tab logout, reset navigation, and token-binding fixes. | **Retained and re-tested** | Full backend and frontend suites pass; no regression was observed. |
| 18 | Production Google redirect registration and Render/Vercel dashboard settings. | **Owner verification outstanding** | The repository blueprint specifies the intended values. Dashboard and Google Cloud Console state cannot be read from source and were not changed. |

No test was weakened, skipped, or converted to a fake success to obtain these results. A search of the test trees found no `.skip`, `.only`, or `.todo` usages.

---

## 4. Root cause, targeted code fix, and regression evidence

### 4.1 Account deletion concurrency and zero-residue lifecycle

**Root cause.** `requireAuth` validated the account before a route performed its mutation. Account deletion could mark the account and sweep collections after that validation while a request still held a stale "active" context and wrote afterward. The prior service had a resumable job and final counts, but no writer-admission barrier.

**Fix.** `backend/src/auth/writeLease.ts` now makes the account document the cross-instance admission authority:

1. A writer atomically increments `writeLease` only while `status: 'active'`.
2. Deletion atomically changes the account to `deleting`, which prevents new leases.
3. Deletion writes a minimal non-PII fence (`lq_account_fences`: opaque `userId`, timestamps, Date TTL), then waits for all admitted leases to drain.
4. The sweep covers the centralized `ACCOUNT_SCOPED_COLLECTIONS` list: all legacy learning-data collections, the consolidated `lq_user_data` collection, sessions, action tokens, legacy challenges/reset grants, OAuth states, migrations, state versions, playlist deletion jobs, and the account-deletion job.
5. A stale/crashed lease is recovered after the heartbeat window; a late write is rejected by the account status and/or cleaned by the fence.
6. Final completion is not reported until account-scoped counts, the account document, and the job all verify zero.
7. Startup and fifteen-minute maintenance sweeps resume pending deletions and purge expired security records.

Sensitive account mutations now run through `withAccountWriteLease`: profile/preferences, learning-data collection writes, import/migrate, playlist archive/delete, email verification, email-change issuance, password reset, password change, reauthentication, login/session rotation, OAuth account association, and onboarding completion.

**Residual boundary.** The fence is deliberately short-lived (one hour) and non-PII. In the extreme case where a process is paused longer than the lease-staleness window and then resumes after deletion, its post-completion late write is still fenced and is removed by the writer's fenced purge or a later startup/maintenance sweep. This is a bounded anti-resurrection mechanism, not a claim of a distributed transaction across every legacy collection.

**Regression evidence.**

- `backend/tests/account-deletion.test.ts`:
  - drains an admitted writer, rejects new writers after `deleting`, and confirms the writer's record is swept;
  - recovers a stale writer lease and proves the startup fence sweep removes crash residue while retaining only the non-PII fence.
- Full deletion/session/data suites pass under Node 24.22.1.

### 4.2 Import and restore atomicity

**Root cause.** The adapter had no transaction primitive. `replaceAllUserState` reserved a version and then wrote collection-by-collection, attempting a best-effort restore if a later write failed. If a restore also failed, partial data could remain.

**Fix.**

- `DbAdapter` has an optional atomic `transaction()`.
- The MongoDB adapter starts a session and uses `withTransaction`; every collection adapter created inside the transaction carries that session.
- The in-memory test adapter snapshots collections and restores them on failure, so failure-path tests exercise real rollback semantics.
- `replaceUserCollection`, `replaceAllUserState`, and playlist archive now require transaction support and fail closed with HTTP 503 `ATOMICITY_UNAVAILABLE` when it is unavailable.
- Migration idempotency records are written through `afterWrite` inside the same transaction as the restored data.
- The version baseline is created before the transaction to avoid a duplicate-key insert aborting an otherwise valid transaction; version reservation inside the transaction is compare-and-set.

The read-only MongoDB topology check reports `hasSetName: true` and `isWritablePrimary: true`, consistent with a transaction-capable Atlas replica set. No write or transaction was executed against the shared database.

**Regression evidence.** `backend/tests/import-integrity.test.ts` has three tests:

1. a simulated mid-import write failure leaves every collection and version intact;
2. an idempotency-marker failure rolls back both the data and the marker, while a successful marker commits with the data;
3. an adapter without transaction support returns `ATOMICITY_UNAVAILABLE` and preserves the previous state.

### 4.3 OAuth browser binding

**Root cause.** State was hashed, single-use, expiring, PKCE-bound, and nonce-bound, but a state copied to another browser could theoretically be presented there.

**Fix.**

- `/api/auth/google/start` creates a random 32-byte browser binding and sets a short-lived HttpOnly, Secure-in-production, SameSite=Lax, Path=/, host-only OAuth cookie (`__Host-lq_oauth` in production, `lq_oauth` locally).
- Google state storage now includes `browserHash = sha256(binding)`. The raw binding is never stored.
- The callback requires the cookie and atomically consumes the state with `stateHash`, `browserHash`, `usedAt: null`, and a server-side expiry filter.
- Failure clears the OAuth binding cookie; success sets the session cookie and clears the binding cookie with `res.append`, preserving both Set-Cookie headers.
- Callback redirects remain on the configured `APP_ORIGIN`; no forwarded-host value is trusted.

**Regression evidence.** The OAuth tests cover:

- a valid start/callback completes and produces a session;
- a callback with no binding is rejected without a session;
- a callback with a mismatched binding is rejected;
- the same state replayed after success is rejected;
- the failed attempts do not consume the state, so the initiating browser can still complete;
- the OAuth cookie has `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, and no `Domain` attribute.

**Residual.** Only one OAuth binding cookie name is used. Starting two OAuth flows in different tabs of the same browser makes the most recent binding cookie authoritative; the older tab must restart. This is a usability limitation, not a bypass of state validation.

### 4.4 Shared security-sensitive rate limiting

**Root cause.** `express-rate-limit` used its default per-process memory store. Multiple Render instances would each enforce a separate quota.

**Fix.** `backend/src/middleware/sharedRateLimit.ts` implements an atomic fixed-window limiter in MongoDB:

- key = SHA-256 digest of `scope:identity:windowStart`;
- one atomic `findOneAndUpdate` upsert increments the counter;
- only hashed keys, scope, window metadata, and a Date `expireAt` are stored;
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, and `Retry-After` headers are returned;
- the store failure path returns HTTP 503 `RATE_LIMIT_UNAVAILABLE` and `retryable: true`, rather than falling back to a process-local counter;
- auth password login, OAuth start/callback, password-reset validation/submission, forgot-password, and email-change endpoints use the shared limiter.

The generic `/api` limiter remains process-local and is listed as residual risk. The focused shared-limiter tests use two logical app instances against one store, verify a shared window, verify digest-only storage and Date expiry, and verify fail-closed behavior on a simulated store outage.

### 4.5 CSP and browser security headers

**Root cause.** The static frontend had no CSP and the live deployment was missing even the source-defined Referrer-Policy and nosniff headers.

**Fix.** `frontend/vercel.json` now defines:

- `default-src 'self'`
- `script-src 'self' https://www.youtube.com`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: blob: https://i.ytimg.com https://img.youtube.com https://*.ytimg.com`
- `font-src 'self' data:`
- `connect-src 'self'`
- `frame-src https://www.youtube.com https://www.youtube-nocookie.com`
- `media-src 'self' https://www.youtube.com`
- `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`
- `worker-src 'self' blob:`, `upgrade-insecure-requests`

It also adds `X-Frame-Options: DENY`, HSTS, Permissions-Policy, Referrer-Policy, and nosniff. The policy was derived from the actual Vite output, YouTube IFrame API/player requirements, and thumbnail hosts; no `unsafe-eval` or script wildcard was added.

**Regression evidence.** `frontend/tests/security-headers.test.ts` asserts the policy and the isolation headers. This is a static configuration test, not a browser run. The live Vercel deployment still lacks the new headers until redeployed.

### 4.6 TTL hardening and maintenance

New security records now carry BSON Date `expireAt` fields, and MongoDB TTL indexes were added for sessions, action tokens, OAuth states, account fences, and rate-limit windows. Because legacy records used ISO-string `expiresAt` fields that MongoDB TTL cannot expire, `backend/src/services/securityMaintenance.ts` removes expired legacy sessions, action tokens, OAuth states, and rate-limit windows. Startup and fifteen-minute maintenance sweeps invoke it. Tests cover Date TTL presence and legacy cleanup.

---

## 5. Complete environment-variable inventory

### 5.1 Active application variables (29)

Presence below is for the real local `backend/.env`; no value is reproduced. "Secret" means the value must never be logged, committed, or sent to the browser.

| Key | Purpose / class | Local | Render production | Source references |
|---|---|---|---|---|
| `NODE_ENV` | Selects production fail-closed behavior, cookie prefix/Secure, and production origin checks. Setting. | `development` | `production` required | `backend/src/config/env.ts`, `backend/src/server.ts` |
| `PORT` | HTTP listener port. Platform setting. | `3001` | Supplied by Render; do not set local `3001` | `backend/src/config/env.ts`, `backend/src/server.ts` |
| `APP_ORIGIN` | Public frontend origin for email links, OAuth redirects, and origin validation. URL. | `http://localhost:5173` | `https://learn-quest-one.vercel.app` | `env.ts`, `actionTokens.ts`, `routes/auth.ts`, `email/brevo.ts` |
| `CORS_ORIGIN` | Exact credentialed browser origin allowlist. URL list. | `http://localhost:5173` | `https://learn-quest-one.vercel.app` | `env.ts`, `app.ts`, `auth/middleware.ts` |
| `API_ORIGIN` | Public backend origin and default base for the OAuth callback. URL. | `http://localhost:3001` | `https://learnquest-hhiv.onrender.com` | `env.ts`, `auth/google.ts` |
| `TRUST_PROXY_HOPS` | Number of trusted reverse-proxy hops for `req.ip`. Setting. | `1` (Vite proxy) | `2` (browser -> Vercel -> Render -> Express) | `env.ts`, `app.ts` |
| `CACHE_TTL_SEC` | Playlist snapshot cache TTL. Setting. | `600` | `600` | `env.ts`, `app.ts`, cache |
| `CACHE_MAX_ENTRIES` | Cache entry cap. Setting. | `50` | `50` | `env.ts`, `memoryCache.ts` |
| `RATE_LIMIT_PER_MIN` | Broad per-IP API limit. Setting. | `30` | `30` | `env.ts`, `middleware/rateLimit.ts` |
| `AUTH_RATE_LIMIT_PER_MIN` | Login/OAuth limiter maximum (15-minute window in the route). Setting. | `20` | `20` | `env.ts`, `routes/auth.ts` |
| `EMAIL_ACTION_RATE_LIMIT_PER_15MIN` | Reset/verification limiter maximum. Setting. | `8` | `8` | `env.ts`, `routes/auth.ts`, `routes/account.ts` |
| `ACCOUNT_MAX_STATE_BYTES` | Account-state/import byte cap. Setting. | `8388608` | `8388608` | `env.ts`, `app.ts`, `services/userData.ts` |
| `YOUTUBE_API_KEY` | Server-side YouTube Data API v3 key. **Secret.** | Present | Preserve existing valid value | `env.ts`, YouTube service/controller |
| `MONGODB_URI` | Atlas connection string including credentials. **Secret.** | Present | Preserve existing production URI | `env.ts`, `db/mongo.ts` |
| `MONGODB_DB_NAME` | Logical database name. Sensitive metadata. | `learnquest` | `learnquest` | `env.ts`, `db/mongo.ts` |
| `LQ_USER_DATA_STORE` | Selects `legacy` or `unified` learning-data layout. Setting. | `legacy` | Preserve confirmed mode; default is `legacy` | `env.ts`, `store.ts` |
| `GOOGLE_CLIENT_ID` | OAuth client identifier. Public identifier. | Present | Preserve active Google client | `env.ts`, `auth/google.ts` |
| `GOOGLE_CLIENT_SECRET` | OAuth token-exchange secret. **Secret.** | Present | Preserve existing valid value | `env.ts`, `auth/google.ts` |
| `GOOGLE_REDIRECT_URI` | Exact OAuth callback URL. URL. | `http://localhost:3001/api/auth/google/callback` | `https://learn-quest-one.vercel.app/api/auth/google/callback` | `env.ts`, `auth/google.ts` |
| `BREVO_API_KEY` | Brevo transactional-email API key. **Secret.** | Present | Preserve existing valid value; align IP authorization | `env.ts`, `email/brevo.ts` |
| `BREVO_SENDER_EMAIL` | Verified sender address. Sensitive metadata. | Present | Preserve verified sender | `env.ts`, `email/brevo.ts` |
| `BREVO_SENDER_NAME` | Visible sender name. Setting. | `LearnQuest` | `LearnQuest` | `env.ts`, `email/brevo.ts` |
| `SESSION_SECRET` | HMAC key for session-token hashes. **Secret.** | Present | Preserve valid value or let Render generate on first creation | `env.ts`, `auth/crypto.ts`, `auth/sessions.ts` |
| `EMAIL_ACTION_HMAC_SECRET` | HMAC key for email-action tokens. **Secret.** | Present (newly generated local-only) | Preserve valid value or generate independently | `env.ts`, `auth/actionTokens.ts` |
| `SESSION_IDLE_HOURS` | Idle-session lifetime. Setting. | `168` | `168` | `env.ts`, `auth/sessions.ts` |
| `SESSION_ABSOLUTE_DAYS` | Absolute session lifetime. Setting. | `30` | `30` | `env.ts`, `auth/sessions.ts` |
| `REAUTH_WINDOW_MIN` | Recent-auth window for sensitive changes. Setting. | `10` | `10` | `env.ts`, `auth/middleware.ts` |
| `EMAIL_ACTION_TTL_MIN` | Reset/email-change link lifetime. Setting. | `30` | `30` | `env.ts`, `auth/actionTokens.ts` |
| `EMAIL_ACTION_RESEND_SEC` | Email-action resend cooldown. Setting. | `60` | `60` | `env.ts`, `routes/auth.ts`, `routes/account.ts` |

### 5.2 Retained legacy compatibility variables (5)

These exist in the local file but are not part of the active production configuration. The dedicated variables above take precedence whenever they are set.

| Key | Class | Local | Production action | Source behavior |
|---|---|---|---|---|
| `OTP_HMAC_SECRET` | Legacy secret fallback | Present | Preserve only while it is the only working email-action key; remove after the dedicated key is verified | `env.emailActionHmacSecret` falls back only when `EMAIL_ACTION_HMAC_SECRET` is empty |
| `OTP_TTL_MIN` | Legacy alias | Present | Remove after `EMAIL_ACTION_TTL_MIN` is verified | `intEnvAlias` fallback only |
| `OTP_RESEND_SEC` | Legacy alias | Present | Remove after `EMAIL_ACTION_RESEND_SEC` is verified | `intEnvAlias` fallback only |
| `OTP_RATE_LIMIT_PER_15MIN` | Legacy alias | Present | Remove after `EMAIL_ACTION_RATE_LIMIT_PER_15MIN` is verified | `intEnvAlias` fallback only |
| `OTP_MAX_ATTEMPTS` | Obsolete | Present | Do not add to Render; remove from local when convenient | No active code reference; only a test asserts it is absent from the blueprint |

### 5.3 Deployment/frontend-only variables

| Key | Class | Local | Production destination | Notes |
|---|---|---|---|---|
| `NODE_VERSION` | Runtime pin | Not present | Render blueprint/runtime; Vercel project Node setting | Not read by application code; `24.22.1` in `render.yaml` and `backend/.node-version` |
| `LQ_USER_DATA_CUTOVER_ACK` | Conditional production acknowledgement | Not present | Render only if deliberately selecting `unified` after a verified migration | Literal `lq-data-to-user-data-v1`; absent is correct for `legacy` |
| `VITE_API_BASE_URL` | Public frontend build setting | Empty/unset | Vercel project; never Render | Empty keeps same-origin `/api` through the Vercel rewrite; any `VITE_*` value is public |
| `RENDER` | Platform signal | Not present | Render sets it automatically | Used only to refuse non-production `NODE_ENV` on Render; never set manually |

**Inventory conclusion:** 29 active application keys are present; five legacy keys are retained; total local file assignments = 34. `NODE_VERSION`, `LQ_USER_DATA_CUTOVER_ACK`, and `VITE_API_BASE_URL` are correctly absent from the backend local file for this mode.

---

## 6. Before/after key-presence comparison (no values)

| Metric | Before | After | Change |
|---|---:|---:|---|
| Assignments in `backend/.env` | 29 | 34 | +5 |
| Active application keys present | 24 | 29 | +5 |
| Retained legacy keys | 5 | 5 | 0 |
| Missing active keys | 5 | 0 | -5 |
| Duplicate keys | 0 | 0 | 0 |
| Malformed assignment lines | 0 | 0 | 0 |
| Local-only secrets generated | 0 | 1 | +1 |
| Existing values corrected | 0 | 0 | 0 |
| Empty active keys | 0 | 0 | 0 |

The five added active keys are:

1. `EMAIL_ACTION_HMAC_SECRET` (local-only secret generated)
2. `EMAIL_ACTION_TTL_MIN=30`
3. `EMAIL_ACTION_RESEND_SEC=60`
4. `EMAIL_ACTION_RATE_LIMIT_PER_15MIN=8`
5. `LQ_USER_DATA_STORE=legacy`

No duplicate or malformed lines were produced. All 34 assignments have non-empty values. The file has 39 lines including comments and separators.

External-credential status is unchanged and reported in Sections 9, 11, and 19. The local file is complete for the current code path but not safe for local writes until the MongoDB development boundary is corrected.

---

## 7. Exact changes to the local `.env` and `.env.example` (no secret values)

### 7.1 `backend/.env`

- Added `EMAIL_ACTION_HMAC_SECRET` with a newly generated local-only value.
- Added `EMAIL_ACTION_TTL_MIN=30`.
- Added `EMAIL_ACTION_RESEND_SEC=60`.
- Added `EMAIL_ACTION_RATE_LIMIT_PER_15MIN=8`.
- Added `LQ_USER_DATA_STORE=legacy`.
- Preserved all existing keys and values, including the existing `SESSION_SECRET`, `OTP_HMAC_SECRET`, database URI, Google credentials, Brevo credentials, and YouTube key.
- Did not remove the legacy `OTP_*` keys. The dedicated names take precedence, so there is no ambiguous effective value.
- Did not change `MONGODB_URI`, `MONGODB_DB_NAME`, `GOOGLE_REDIRECT_URI`, origins, or ports.
- Did not add `NODE_VERSION` or `LQ_USER_DATA_CUTOVER_ACK`; both are correctly absent for this local mode.

The file is not tracked:

```text
.gitignore:13:.env    backend/.env
git ls-files --error-unmatch backend/.env
  error: pathspec 'backend/.env' did not match any file(s) known to git
```

### 7.2 `backend/.env.example`

- Added the Render `PORT` caution.
- Added a commented `NODE_VERSION=24.22.1` runtime note.
- Clarified that the OAuth/action secrets must be unique per environment and never reused.
- Added commented legacy aliases `OTP_TTL_MIN`, `OTP_RESEND_SEC`, and `OTP_RATE_LIMIT_PER_15MIN` as migration-only documentation.
- Contains no real secret values; all secret fields remain blank.
- Contains 29 active assignment names. The legacy aliases are comments, not effective values.

### 7.3 Other environment files

- Root `.env`: absent.
- `frontend/.env.local`: absent.
- `frontend/.env.example`: only `VITE_API_BASE_URL`; documented as empty for same-origin `/api`.
- No real environment file is tracked or reachable in Git history.

The read-only local `configStatus()` check under Node 24.22.1 reported `nodeEnv=development`, `authEnabled=true`, `setupRequired=false`, `missing=[]`, `cookieSecure=false`, `userDataStore=legacy`, and `emailActionTtlMin=30`. This confirms the local schema parses and all active provider keys are present; it does **not** establish production readiness.

---

## 8. Local-only secrets generated and non-logging confirmation

| Item | Result |
|---|---|
| Generated key | `EMAIL_ACTION_HMAC_SECRET` |
| Generator | Node.js `node:crypto` cryptographic random bytes, base64url encoding |
| Entropy | 48 random bytes |
| Validator | Meets the current `secretEnv` minimum of 32 characters |
| Writer | Direct write into `backend/.env`; no terminal echo |
| Distinctness | Verified distinct from `SESSION_SECRET` and `OTP_HMAC_SECRET` |
| Existing secrets | `SESSION_SECRET` and `OTP_HMAC_SECRET` preserved, not rotated |
| Production secrets created | None |
| Production values copied locally | None |
| Local values copied to production | None |
| Consequence | Pending local email-action links signed with the old/absent dedicated key are invalidated; users can request new local links. This is harmless outside production. |
| Confirmation | Outputs from the generation and inspection commands contained key names/presence only, never the value. No secret value appears in this report or in the generated docs. |

The local generated secret was not used in tests and was not placed in `.env.example`, source, logs, or the frontend build.

---

## 9. Production secrets: preserve or generate independently

Never copy the generated local value to Render. The owner should generate separate production values privately and set them in the Render dashboard.

| Secret | Action | Notes / side effects |
|---|---|---|
| `MONGODB_URI` | **Preserve** existing production Atlas URI | Do not replace with the local URI. Rotate only under a credential-exposure plan. |
| `GOOGLE_CLIENT_SECRET` | **Preserve** if valid | Rotate only with a planned Google client rotation. Existing sessions remain valid unless separately revoked. |
| `BREVO_API_KEY` | **Preserve** if valid | Align Brevo source-IP authorization with Render egress. Do not disable IP restrictions as a default fix. |
| `YOUTUBE_API_KEY` | **Preserve** if valid and restricted to YouTube Data API v3 | Rotate only if exposed or misconfigured. |
| `SESSION_SECRET` | **Preserve** valid existing; generate independently only if missing/weak/exposed | Rotation signs out all sessions. Render blueprint uses `generateValue: true`; verify the dashboard value was not inadvertently replaced. |
| `EMAIL_ACTION_HMAC_SECRET` | **Preserve** valid existing; generate independently only if missing/weak/exposed | Dedicated key must differ from `SESSION_SECRET`. Rotation invalidates outstanding reset/email-change links. |
| `OTP_HMAC_SECRET` | Legacy only | Preserve temporarily only if it is the only working fallback. Remove after the dedicated key is verified. Do not keep using an exposed legacy value. |
| `OTP_TTL_MIN`, `OTP_RESEND_SEC`, `OTP_RATE_LIMIT_PER_15MIN` | Do not configure in production after new keys are verified | Legacy fallbacks only. |
| `OTP_MAX_ATTEMPTS` | Do not set | No active code reference. |

If a production secret must be generated, the owner can run a separate invocation for each key and paste the output directly into Render without including it in any file, shell transcript, report, or ticket:

```text
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url') + '\n')"
```

Run that command separately for `SESSION_SECRET` and `EMAIL_ACTION_HMAC_SECRET`. Do not reuse a value across keys or environments.

Legacy action-token migration semantics:

- New links are signed with `EMAIL_ACTION_HMAC_SECRET` when it is set.
- Old links signed with `OTP_HMAC_SECRET` are not verifiable once the dedicated key is active; there is no broad dual-key fallback because that would weaken purpose/account binding.
- Expected production consequence: outstanding reset/email-change links become invalid and must be re-requested. Issue a new link after changing the key and verify it end-to-end.
- If production currently has only `OTP_HMAC_SECRET`, set the dedicated secret, verify a new link, and only then remove the legacy value.

---

## 10. Render/Vercel configuration matrix and exact Render checklist

### 10.1 Exactly what to configure in Render - final release checklist

Legend: **Verified in source** means the repository blueprint/schema was inspected; **dashboard unverified** means Render's actual dashboard was not accessible and must be checked by the owner.

| Key | Required? | Verified non-secret production setting / source | Preserve existing dashboard value? | Local counterpart / why different | If missing or wrong | Test/evidence | Dashboard verified? |
|---|---|---|---|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Yes, preserve exact | Local `development`; production must enable Secure/`__Host-` cookies and fail-closed checks | Production checks and cookie security can be disabled | `origin-config.test.ts` | Dashboard unverified |
| `PORT` | Platform | Omit manual override; Render supplies it | Do not force `3001` | Local `3001` is development only | Health checks/listener can bind the wrong port | `render.yaml` contract; live health | Dashboard unverified |
| `NODE_VERSION` | Platform/runtime | `24.22.1` | Keep, but inspect dashboard override | Local default is `24.11.0`; QA used `24.22.1` | Unpatched runtime; build/runtime mismatch | Official Node index; `.node-version`; `render.yaml` | Dashboard unverified |
| `APP_ORIGIN` | Yes | `https://learn-quest-one.vercel.app` | Preserve exact public frontend origin | Local `http://localhost:5173` | Broken email links/OAuth redirects; production origin validation fails | `env.ts`, `origin-config.test.ts` | Dashboard unverified |
| `CORS_ORIGIN` | Yes | `https://learn-quest-one.vercel.app` | Preserve exact, no extra insecure origins | Local `http://localhost:5173`; local HTTP is deliberate | Browser API calls rejected or an unsafe origin admitted | `origin-config.test.ts` | Dashboard unverified |
| `API_ORIGIN` | Yes | `https://learnquest-hhiv.onrender.com` | Preserve exact backend origin | Local `http://localhost:3001` | Default callback and origin validation can break | `env.ts`, deployment tests | Dashboard unverified |
| `TRUST_PROXY_HOPS` | Yes | `2` for browser -> Vercel -> Render -> Express | Preserve while this topology is live | Local `1` for Vite proxy -> backend | Spoofable client IP or all clients sharing one bucket | `render.yaml`; origin/proxy tests | Dashboard unverified |
| `CACHE_TTL_SEC` | Optional | `600` | Keep unless policy changes | `600` | Stale or over-fresh playlist metadata | Source; cache tests | Dashboard unverified |
| `CACHE_MAX_ENTRIES` | Optional | `50` | Keep; size for memory | `50` | Memory pressure or extra upstream load | Source; cache tests | Dashboard unverified |
| `RATE_LIMIT_PER_MIN` | Optional | `30` | Keep unless capacity-tested | `30` | Abuse exposure or normal requests throttled | Source; limiter tests | Dashboard unverified |
| `AUTH_RATE_LIMIT_PER_MIN` | Optional | `20` | Keep | `20` | Credential-stuffing exposure or shared-network lockout | `auth.ts`; limiter tests | Dashboard unverified |
| `EMAIL_ACTION_RATE_LIMIT_PER_15MIN` | Optional | `8` | Keep | `8` | Email bombing/quota burn or lockout | `auth.ts`, `account.ts`; tests | Dashboard unverified |
| `ACCOUNT_MAX_STATE_BYTES` | Optional | `8388608` | Keep | `8388608` | Oversized imports consume memory; too low rejects valid data | `app.ts`, `userData.ts`; tests | Dashboard unverified |
| `YOUTUBE_API_KEY` | Required for URL import | **Secret**; preserve existing valid key, restricted to YouTube Data API v3 | **Yes** | Present locally; never in browser | URL imports fail; quota theft if exposed | YouTube adapter/tests; live API not called | Dashboard/secret unverified |
| `MONGODB_URI` | Yes | **Secret**; preserve existing production Atlas URI | **Yes** | Local URI points at `learnquest`, not the restricted dev identity; do not copy | No accounts/cloud data; wrong database risk | Read-only diagnostic; `render.yaml` | Dashboard/secret unverified |
| `MONGODB_DB_NAME` | Yes | `learnquest` | Preserve for production | Local is also `learnquest`; owner must isolate local to `learnquest_dev` | Wrong database selection | Diagnostic `database.matches=true` | Dashboard unverified |
| `LQ_USER_DATA_STORE` | Conditional | Preserve the confirmed production mode. Do not switch to `unified` without a verified migration. Source default is `legacy`. | **Yes** | Local `legacy` | App can read an empty/wrong layout; no automatic fallback | `store.ts`, unified-store tests | Dashboard/mode unverified |
| `GOOGLE_CLIENT_ID` | Yes | Public identifier; preserve active production client | **Yes** | Present locally | OAuth broken or wrong client | Google tests; live exchange not executed | Dashboard unverified |
| `GOOGLE_CLIENT_SECRET` | Yes | **Secret**; preserve existing valid value | **Yes** | Present locally; never copy | OAuth code exchange fails | Google tests; live exchange not executed | Dashboard/secret unverified |
| `GOOGLE_REDIRECT_URI` | Yes | `https://learn-quest-one.vercel.app/api/auth/google/callback` | Preserve exact registered URI | Local `http://localhost:3001/api/auth/google/callback` | OAuth mismatch; binding cookie may be on the wrong origin | `env.ts`; OAuth tests | Dashboard/Google Console unverified |
| `BREVO_API_KEY` | Yes | **Secret**; preserve existing valid key, aligned with Brevo IP authorization | **Yes** | Present locally; never copy | Recovery/email-change unavailable | Email adapter tests; live send not performed | Dashboard/secret unverified |
| `BREVO_SENDER_EMAIL` | Yes | Verified sender address; preserve | **Yes** | Present locally; value not reproduced | Provider rejects sender | `brevo.ts`; provider not tested live | Dashboard unverified |
| `BREVO_SENDER_NAME` | Optional | `LearnQuest` | Keep | `LearnQuest` | Cosmetic only | `brevo.ts` | Dashboard unverified |
| `SESSION_SECRET` | Yes | **Secret**; preserve valid existing value or generate independently | **Yes** | Present locally; newly generated value only for email actions, not sessions | Auth unavailable or session hashes forgeable/weak | Session/auth tests | Dashboard/secret unverified |
| `EMAIL_ACTION_HMAC_SECRET` | Yes | **Secret**; preserve valid existing value or generate independently | **Yes; never copy local value** | Newly generated local value; must differ from production | Reset/email-change links invalid or forgeable | Action-token/reset tests | Dashboard/secret unverified |
| `EMAIL_ACTION_TTL_MIN` | Policy | `30` | Keep tested policy | Local `30` | Wrong expiry window | Reset-token tests | Dashboard unverified |
| `EMAIL_ACTION_RESEND_SEC` | Policy | `60` | Keep tested policy | Local `60` | Email bombing or blocked retries | Auth/account tests | Dashboard unverified |
| `SESSION_IDLE_HOURS` | Policy | `168` | Keep intended policy | Local `168` | Session exposure or premature logout | Session tests | Dashboard unverified |
| `SESSION_ABSOLUTE_DAYS` | Policy | `30` | Keep intended policy | Local `30` | Session exposure or premature logout | Session tests | Dashboard unverified |
| `REAUTH_WINDOW_MIN` | Policy | `10` | Keep intended policy | Local `10` | Weaker step-up proof or user friction | Middleware/account tests | Dashboard unverified |
| `OTP_HMAC_SECRET` | Legacy | Do not add for a new deployment; if present, remove only after dedicated key verified | Conditional | Present locally | Stale fallback or breakage if removed too early | Action-token tests | Dashboard unverified |
| `OTP_TTL_MIN` / `OTP_RESEND_SEC` / `OTP_RATE_LIMIT_PER_15MIN` | Legacy | Do not set after migration | No | Present locally but ignored by dedicated keys | Silent stale policy | `env.ts` alias tests | Dashboard unverified |
| `OTP_MAX_ATTEMPTS` | Obsolete | Do not set | No | Present locally | False sense of enforcement | Deployment-config test | Dashboard unverified |
| `LQ_USER_DATA_CUTOVER_ACK` | Conditional | Unset unless `LQ_USER_DATA_STORE=unified` after verified migration | No | Absent | Production refuses unified mode if missing | `env.ts` | Dashboard unverified |
| `VITE_API_BASE_URL` | Vercel build | Empty/unset | N/A for Render | Frontend `.env.example` | Direct Render URL makes cookies cross-site | `http.ts`, Vercel rewrite | Vercel unverified |

#### Copy-ready non-secret Render block

Do not paste secret values into this block.

```dotenv
NODE_ENV=production
NODE_VERSION=24.22.1
APP_ORIGIN=https://learn-quest-one.vercel.app
CORS_ORIGIN=https://learn-quest-one.vercel.app
API_ORIGIN=https://learnquest-hhiv.onrender.com
GOOGLE_REDIRECT_URI=https://learn-quest-one.vercel.app/api/auth/google/callback
MONGODB_DB_NAME=learnquest
BREVO_SENDER_NAME=LearnQuest
CACHE_TTL_SEC=600
CACHE_MAX_ENTRIES=50
RATE_LIMIT_PER_MIN=30
AUTH_RATE_LIMIT_PER_MIN=20
EMAIL_ACTION_RATE_LIMIT_PER_15MIN=8
TRUST_PROXY_HOPS=2
SESSION_IDLE_HOURS=168
SESSION_ABSOLUTE_DAYS=30
REAUTH_WINDOW_MIN=10
EMAIL_ACTION_TTL_MIN=30
EMAIL_ACTION_RESEND_SEC=60
ACCOUNT_MAX_STATE_BYTES=8388608
# LQ_USER_DATA_STORE: preserve the confirmed production mode; source default is legacy.
# Do not set LQ_USER_DATA_CUTOVER_ACK unless unified was deliberately migrated and verified.
# Do not set PORT or VITE_API_BASE_URL in Render.
```

#### Secret/provider checklist (set privately, never in this document)

```text
MONGODB_URI                 preserve the existing production Atlas URI
GOOGLE_CLIENT_ID            preserve the active public client id
GOOGLE_CLIENT_SECRET        preserve the valid client secret
YOUTUBE_API_KEY             preserve the restricted server-side key
BREVO_API_KEY               preserve the valid key and align source-IP authorization
BREVO_SENDER_EMAIL          preserve the verified sender
SESSION_SECRET              preserve or independently generate
EMAIL_ACTION_HMAC_SECRET    preserve or independently generate a different value
```

### 10.2 Origin, port, proxy, and OAuth explanation

- **`APP_ORIGIN`** is the public frontend origin used by email links, OAuth post-login redirects, and production origin validation. It must be the Vercel origin, not the Render API origin.
- **`CORS_ORIGIN`** is the exact credentialed browser allowlist used by the API's CORS middleware and origin guard. It is not a redirect target. It is the same public Vercel origin in this single-frontend topology, but its purpose is different.
- **`API_ORIGIN`** is the public backend origin. It is the default base for `GOOGLE_REDIRECT_URI` when that variable is absent and the Render service origin in the blueprint.
- Browser requests should use the **same-origin Vercel `/api` proxy**. Vercel rewrites `/api/*` to `https://learnquest-hhiv.onrender.com/api/*`. This keeps the session cookie first-party on the Vercel hostname.
- The production **`GOOGLE_REDIRECT_URI`** must be `https://learn-quest-one.vercel.app/api/auth/google/callback`, because the OAuth browser-binding cookie is set on the frontend origin. The exact URI must also be registered in Google Cloud Console.
- Local `localhost` origins are valid only for local development. Because cookies are host-scoped rather than port-scoped, the local callback on `localhost:3001` can share the localhost binding cookie with a frontend on `localhost:5173`. Production uses different hostnames and therefore must use the proxy callback.
- **`VITE_API_BASE_URL`** should be empty/unset for the Vercel proxy. A direct Render URL would make the session cookie cross-site and is not the supported topology.
- **`PORT`** is supplied by Render. Do not set production `PORT=3001`; that is only the local default.
- **`TRUST_PROXY_HOPS=2`** matches browser -> Vercel -> Render -> Express. Do not increase it without a verified topology change. Do not set it to a guessed value.
- Render owns the backend environment; Vercel owns only the static frontend build and rewrite/header configuration. Google Cloud owns the OAuth client and exact redirect registration. Atlas owns the database users/network access. Brevo owns the sender/IP authorization. No backend secret belongs in Vercel.

### 10.3 Vercel and Google Cloud checklist

| Layer | Required setting | Verification |
|---|---|---|
| Vercel project | Root directory `frontend`; build `npm run build`; output `dist` | Dashboard unverified; inspect project settings after deploy |
| Vercel Node | Supported Node 24.x (prefer `24.22.1`) | Build log/dashboard unverified |
| Vercel env | `VITE_API_BASE_URL` empty/unset | Check project environment; empty means same-origin `/api` |
| Vercel rewrite | `/api/:path*` -> `https://learnquest-hhiv.onrender.com/api/:path*` | Source `frontend/vercel.json`; live `/api` currently 404 |
| Vercel headers | CSP, Referrer-Policy, nosniff, X-Frame-Options, HSTS, Permissions-Policy | Source/test only; live headers absent until redeploy |
| Google Cloud | Authorized origin `https://learn-quest-one.vercel.app`; exact callback `https://learn-quest-one.vercel.app/api/auth/google/callback`; local callback for development if used | Console unverified |
| Atlas | Production URI/db `learnquest`; restricted local `learnquest_dev` identity | Production dashboard unverified; local identity mismatch documented |
| Brevo | Verified sender/domain and IP authorization for Render egress | Provider dashboard unverified; prior live 401 |

### 10.4 Local versus production side-by-side

| Concern | Local development | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| App origin | `http://localhost:5173` | `https://learn-quest-one.vercel.app` |
| API origin | `http://localhost:3001` | `https://learnquest-hhiv.onrender.com` |
| Browser API path | Vite `/api` proxy | Vercel same-origin `/api` rewrite |
| `TRUST_PROXY_HOPS` | `1` for Vite proxy | `2` for Vercel -> Render -> Express |
| Node | Local default `24.11.0`; QA `24.22.1` | `NODE_VERSION=24.22.1` (dashboard verification required) |
| Database | URI path/config `learnquest`; **not** the restricted dev identity | Production Atlas URI, db `learnquest` |
| Cookies | `lq_session` / `lq_oauth`; Secure off outside production | `__Host-lq_session` / `__Host-lq_oauth`; HttpOnly, Secure, SameSite=Lax, Path=/, no Domain |
| Google callback | `http://localhost:3001/api/auth/google/callback` | `https://learn-quest-one.vercel.app/api/auth/google/callback` |
| Session/action secrets | Independent local values | Independent production values; preserve existing valid values |
| Frontend API base | Empty; Vite dev proxy | Empty; Vercel rewrite |
| Email links | Localhost, usable only in development | HTTPS `APP_ORIGIN`; production builder rejects other origins |

### 10.5 MongoDB development/production boundary

The local URI shape is `mongodb+srv://[redacted]@<atlas-host>/learnquest`; the credential and host are intentionally omitted. Safe inspection established:

- a username is present;
- the username is **not** `learnquest_dev_user`;
- the URI path database is `learnquest`;
- `MONGODB_DB_NAME` is also `learnquest`;
- the path and configured database agree;
- the read-only diagnostic connected, pinged, and reported a replica-set topology.

This means the local configuration currently points at the same database name as production and does **not** use the restricted development identity. No local data mutation was executed. The owner must create/verify a restricted Atlas user for `learnquest_dev`, update the local URI and `MONGODB_DB_NAME` to that database manually, and confirm the identity before using local writes or destructive tests. Do not change only the database name while reusing an unknown user, and do not run destructive tests against `learnquest`.

---

## 11. Google OAuth, MongoDB, YouTube, and Brevo verification

| Provider | Configuration evidence | Live verification performed? | Limitations / owner action |
|---|---|---|---|
| Google OAuth | Client ID/secret and redirect URI are present; OAuth service validates PKCE, nonce, issuer, audience, expiry, verified email, state, and browser binding | **No live Google exchange** | Register the exact production callback in Google Cloud Console; complete a real sign-in after deployment. The tests use deterministic fakes for the provider. |
| MongoDB | URI/db configured; read-only diagnostic `CONNECTED`; ping true; `hasSetName: true`; `isWritablePrimary: true` | **Read-only only** | Production readiness cannot be checked while live Render lacks `/api/ready`. Local identity is not the restricted dev user. No writes/index creation/cleanup were performed. |
| YouTube Data API | Server-side key present; service reads it from env; no frontend exposure found in the built bundle | **No live API request** | Validate quota, API restriction, and live playlist import after deploy. Missing key disables URL import but not JSON import. |
| Brevo | API key/sender present; adapter uses server-side HTTPS, 10-second timeout, sanitized diagnostics, and no automatic retry | **No send; no delivery claim** | Prior HTTP 401 source-IP authorization remains. Align Brevo IP authorization with Render egress and perform one controlled send to an owner-controlled recipient. API acceptance is not inbox delivery. |

---

## 12. Session, cookie, CSRF, CORS, and OAuth threat analysis

### 12.1 Cookies and sessions

| Property | Session cookie | OAuth binding cookie |
|---|---|---|
| Production name | `__Host-lq_session` | `__Host-lq_oauth` |
| Local name | `lq_session` | `lq_oauth` |
| HttpOnly | Yes | Yes |
| Secure | Production only | Production only |
| SameSite | `Lax` | `Lax` |
| Path | `/` | `/` |
| Domain | Never set (`__Host-` requirement) | Never set (`__Host-` requirement) |
| Lifetime | Absolute session lifetime (`SESSION_ABSOLUTE_DAYS`, default 30 days), idle cap (`SESSION_IDLE_HOURS`, default 168 hours) | 10 minutes |
| Clearing | Empty value, `Max-Age=0`, epoch `Expires` | Empty value, `Max-Age=0`, epoch `Expires` |

Sessions rotate on password/Google sign-in, are revoked on logout/password reset/password change/email change, and carry a password version to close the verify-then-create race. `requireAuth` rejects non-active accounts. `touchSession` never extends the absolute expiry. Session status responses and stale frontend requests were retained from Report 17 tests.

### 12.2 CSRF and CORS

- Authenticated mutations require the session CSRF token in `X-CSRF-Token`; the session cookie is HttpOnly.
- `SameSite=Lax` mitigates cross-site cookie sending, while the explicit CSRF token and origin check remain authoritative.
- CORS uses an exact origin allowlist with credentials; wildcard origins are rejected. Production rejects HTTP, localhost/private, credentialed, path/query/fragment, and non-HTTP(S) extra origins.
- `requireTrustedOrigin` rejects a supplied `Origin` outside the allowlist. Requests without an Origin (server-to-server/read-only clients) are not automatically authenticated by this check; session/CSRF still apply to protected mutations.
- `TRUST_PROXY_HOPS=2` must match the verified topology; too-high trust could permit spoofed IPs and too-low trust could collapse users into one limiter bucket.

### 12.3 OAuth threat analysis

- **Login CSRF:** state is unguessable, hashed at rest, expiring, and single-use; the browser binding digest prevents a state copied to another browser from completing.
- **Replay:** atomic `findOneAndUpdate` with `usedAt: null` and expiry consumes the state before token exchange.
- **Code interception:** PKCE verifier and nonce are server-side; ID token signature, issuer, audience, nonce, and expiry are checked.
- **Redirect injection:** callback redirects use `APP_ORIGIN`; forwarded host headers are not trusted.
- **Cookie topology:** production callback must be on the frontend origin proxied through `/api`; a direct Render callback would not receive the frontend-origin binding cookie.
- **Residual:** one binding cookie per browser means a newly started flow supersedes an older tab's flow. This is safe but requires the older tab to restart.

### 12.4 Residual threat register after remediation

| Residual | Severity | Why it remains | Mitigation / owner action |
|---|---|---|---|
| Forgot-password timing | Low | Eligible accounts perform token/email work while unknown identifiers return early | Generic body/status, shared rate limit, cooldown; outbox/constant-time path is future hardening |
| Generic `/api` limiter process-local | Low | Only security-sensitive endpoints were converted to the shared store | Keep one instance or plan a shared limiter for the broad API before horizontal scaling |
| Public `/api/cache` counters | Low | Operational metadata remains public | Restrict at edge if not needed |
| `@types/node` 22 | Development-only | Runtime is Node 24; type package was not upgraded in this pass | Plan a tested dependency update |
| Extreme paused-writer deletion window | Low | A stale lease can be reset after the heartbeat window; late writes are fenced and cleaned, not transactionally prevented across every legacy collection | Keep the fence/maintenance sweeps; monitor deletion failures; do not claim cross-collection distributed transactions |
| Provider retention | External | Google, Brevo, and Atlas may retain their own logs/copies outside the application's deletion sweep | Review provider retention policies separately |
| Production live headers/OAuth | External | Stale deployment prevents live verification | Redeploy and recheck |

No claim of complete invulnerability is made.

---

## 13. Account deletion and data-import integrity results

### 13.1 Account deletion

The deletion path now:

1. verifies the authenticated account, recent auth, password/Google proof, exact confirmation phrase, CSRF, and origin;
2. atomically marks the account `deleting`;
3. publishes the non-PII fence;
4. drains already-admitted writer leases;
5. deletes every account-scoped collection, including all legacy learning collections and the unified collection;
6. verifies zero counts while preserving the account marker/job for resumability;
7. deletes the account document;
8. verifies absence again;
9. removes the job last and verifies final absence.

Covered collections include `lq_data_*` for every `USER_COLLECTIONS` entry, `lq_user_data`, sessions, action tokens, legacy challenges/reset grants, OAuth states, migrations, state versions, playlist deletion jobs, and the account-deletion job. The only retained record is the non-PII `lq_account_fences` row containing the opaque account ID and timestamps, with a one-hour Date TTL and startup residue sweep.

Tests prove the drain barrier, rejection of new writers after `deleting`, late-write removal, stale-lease recovery, and no account/data/job residue after success. No production account was deleted or modified.

### 13.2 Import/restore

- Full account import and migration use a MongoDB transaction.
- The version reservation and all collection rewrites commit or roll back together.
- The migration idempotency marker commits with the data.
- If the adapter cannot provide a transaction, the operation returns HTTP 503 `ATOMICITY_UNAVAILABLE` and leaves the prior state unchanged.
- The read-only topology check is consistent with Atlas transaction support, but no live write transaction was executed against the shared database.
- Playlist permanent deletion retains its existing resumable ordered job/saga; it is not represented as a single transaction. Its failure markers and completion job remain the recovery mechanism.

### 13.3 Data-safety conclusion

No production data, live account, database collection, or migration was altered. All failure-path import tests ran against the in-memory adapter. The local database was contacted read-only only. The local `learnquest` database-name mismatch is a blocker for safe local development, not evidence of a production mutation.

---

## 14. Node.js official source/version and dependency audit evidence

### 14.1 Official Node release check

At execution time, `https://nodejs.org/dist/index.json` and the official Node release page (`https://nodejs.org/en/blog/release`) reported:

| Release | Date | LTS | npm |
|---|---|---|---|
| `v26.12.1` | 2026-10-21 | No (Current) | 11.20.0 |
| `v24.22.1` | 2026-10-20 | **Krypton (LTS)** | 11.19.1 |
| `v24.22.0` | 2026-10-14 | Krypton (LTS) | 11.19.1 |

`https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt` also resolves to `node-v24.22.1-*` artifacts. The selected runtime is therefore the current appropriate Node 24 LTS patch at the time of this audit.

QA was executed with `v24.22.1` and `npm 11.6.1`. The machine's default `node` is `v24.11.0`; it was not used for final QA. Package engines require `>=24.22.1 <25`, and `backend/.node-version` pins `24.22.1`.

### 14.2 Dependency audit

| Package | Dependencies reported | info | low | moderate | high | critical | Exit |
|---|---:|---:|---:|---:|---:|---:|---:|
| Backend | 339 | 0 | 0 | 0 | 0 | 0 | 0 |
| Frontend | 395 | 0 | 0 | 0 | 0 | 0 | 0 |

Both commands were `npm audit --audit-level=low --json` under Node 24.22.1. No `npm audit fix --force` was run and no dependency was updated in this pass.

### 14.3 Runtime limitations

- The local default Node is older than the required patched LTS; owner/developer should update the local default or continue using the pinned QA runtime.
- Render's actual runtime cannot be verified while the deployment is stale; the blueprint and `.node-version` both specify `24.22.1`.
- Vercel's project Node setting was not readable and remains owner verification.
- `@types/node` is still v22 dev-only; this does not change the runtime version.

---

## 15. Actual full and targeted test counts and results

All commands were run under Node `v24.22.1` with npm `11.6.1`.

### 15.0 Stage A-E coverage

| Stage | Coverage exercised | Result |
|---|---|---|
| A - Configuration/startup | Environment parsing/status, exact `NODE_ENV`, production origin/CORS validation, Render non-production refusal, deployment configuration, OAuth cookie contract | PASS via full suite and targeted config/deployment tests |
| B - Core backend | Auth/authorization, OAuth binding/replay, sessions/expiry/revocation, email-action expiry/single-use, CSRF/CORS, shared rate limiting, account isolation, deletion, versioning, import atomicity, email adapter, Mongo readiness | PASS via 101 targeted tests plus full suite |
| C - Core frontend | Sign-in/recovery, reset navigation, cross-tab logout, stale-response handling, account refresh, learning-data save/error surfaces, security-header configuration | PASS via 13 targeted tests plus full suite |
| D - Whole application | Full backend/frontend suites, typechecks, lint, production builds, dependency audit, Node 24.22.1 check, source secret scan, diff check, read-only live probes | PASS except live deployment remains stale; see Sections 16-18 |
| E - Final regression/data safety | Full suite rerun after fixes, no skipped/weakened tests, diff review, secret review, no live mutation, final working-tree inspection | PASS; no production data altered |

No real-browser E2E harness was present or run; browser interaction remains an owner acceptance step after deployment.

### 15.1 Full backend suite

```text
Test Files  25 passed (25)
Tests       201 passed (201)
Duration    30.91s
```

### 15.2 Full frontend suite

```text
Test Files  42 passed (42)
Tests       351 passed (351)
Duration    83.58s
```

### 15.3 Targeted remediation suites

| Suite | Files | Tests | Result | Duration |
|---|---:|---:|---|---:|
| Backend: import integrity, shared rate limit, security maintenance, account deletion, multiuser/OAuth, origin/config, deployment config, reset-token expiry | 8 | 101 | 101 passed | 12.08s |
| Frontend: security headers and account UI | 2 | 13 | 13 passed | 7.86s |

### 15.4 Comparison with Report 18 baseline

| Suite | Report 18 | Report 19 | Change |
|---|---:|---:|---:|
| Backend files | 22 | 25 | +3 |
| Backend tests | 190 | 201 | +11 |
| Frontend files | 41 | 42 | +1 |
| Frontend tests | 349 | 351 | +2 |

New/updated coverage includes transaction rollback and marker atomicity, stale/admitted deletion writers, deletion fence recovery, OAuth binding/replay, shared limiter instance/window/fail-closed behavior, expiry sweeps, CSP headers, version-baseline races, and account refresh.

### 15.5 Test integrity

- No `.skip`, `.only`, or `.todo` test usage was found in either test tree.
- No test was deleted or weakened to obtain a pass.
- Provider calls in tests are deterministic fakes; no live Brevo, Google, or YouTube request was made.
- No real-browser E2E harness was present or run. No browser verification is claimed.

---

## 16. Typecheck, lint, production build, and diff-check results

| Check | Result |
|---|---|
| Backend `npm run typecheck` | **PASS** |
| Frontend `npm run typecheck` | **PASS** |
| Backend `npm run lint` | **0 errors, 86 warnings** (existing `no-explicit-any` style warnings; no errors) |
| Frontend `npm run lint` | **0 errors, 4 warnings** (existing `react-hooks/exhaustive-deps` warnings; no errors) |
| Backend `npm run build` | **PASS** (`tsc -p tsconfig.json`) |
| Frontend `npm run build` | **PASS**; Vite transformed 2253 modules and emitted `dist/index.html`, `assets/index-BJYYPxXz.js`, and `assets/index-3B-2hnD2.css` |
| `git diff --check` | **Exit 0**; only Git LF/CRLF conversion warnings, no whitespace errors |
| `npm audit` backend | **Exit 0, 0 vulnerabilities** |
| `npm audit` frontend | **Exit 0, 0 vulnerabilities** |

The backend warning count increased from 84 to 86 with the new code; these are lint warnings, not errors, and do not fail the gate. No lint rule was disabled to obtain the result.

---

## 17. MongoDB connectivity and provider evidence, limitations

### 17.1 Read-only MongoDB diagnostic

```text
classification: CONNECTED
connected: true
ping: true
retryable: false
database.expected: learnquest
database.matches: true
uri.scheme: mongodb+srv
uri.credentials: present (not printed)
elapsedMs: 4272
runtime: v24.22.1
```

A separate read-only `hello` topology check returned:

```text
isWritablePrimary: true
hasSetName: true
transactionCapable: true
```

No database write, index creation, migration, collection cleanup, or live account operation was performed. The diagnostic URI, username, password, host, and database user are not reproduced in this report.

### 17.2 Limitations

- The local URI uses a production-named database (`learnquest`) and an identity that is not the restricted development user. This is an owner data-boundary blocker.
- Production `/api/ready` is 404 because Render is stale, so live production database readiness is unverified.
- The transaction-capable topology is confirmed, but the live transaction path was not exercised against the shared database.
- Brevo, Google, and YouTube live provider calls were not made. Provider acceptance/delivery is not claimed.

---

## 18. Current public Render/Vercel version and route status

Read-only probes on 2026-10-28:

| Probe | Status | Observed |
|---|---|---|
| `GET https://learnquest-hhiv.onrender.com/api/health` | 200 | `{"ok":true,"hasKey":true,"version":"0.2.0",...}` |
| `GET https://learnquest-hhiv.onrender.com/api/ready` | 404 | `{"error":"Not found."}` |
| `GET https://learnquest-hhiv.onrender.com/api/auth/config` | 404 | `{"error":"Not found."}` |
| `GET https://learn-quest-one.vercel.app/` | 200 | Old asset `index-RgZDAXlN.js` |
| `GET https://learn-quest-one.vercel.app/api/health` | 404 | Vercel `NOT_FOUND` page; not the Render JSON response |
| Vercel root headers | Inspected | `Access-Control-Allow-Origin: *`; HSTS present; no CSP, Referrer-Policy, nosniff, X-Frame-Options, or Permissions-Policy |

The source build is backend `0.3.0` and frontend asset `index-BJYYPxXz.js`. Neither matches the live versions. The Vercel `/api` rewrite and new CSP/header configuration are source-only until the frontend is redeployed, and the Render backend must be deployed from the current revision for `/api/ready`, `/api/auth/config`, OAuth, and account routes to exist.

No production account, reset flow, email send, or destructive operation was attempted. Live authentication cannot be meaningfully claimed until both services are redeployed.

---

## 19. Precise owner-side blockers before push/deploy

### P0 - Deployment and live acceptance

1. Review the working-tree diff and the new report.
2. Commit and push the reviewed changes (this audit did not).
3. Ensure Render builds the **backend** root from the current commit, with `NODE_ENV=production`, `NODE_VERSION=24.22.1`, no `PORT` override, and the secret/config values above.
4. Ensure Vercel builds the **frontend** root with Node 24.x, `VITE_API_BASE_URL` empty/unset, and the `/api` rewrite and headers from `frontend/vercel.json`.
5. Redeploy both services from the same reviewed revision.
6. Verify:
   - `https://learnquest-hhiv.onrender.com/api/health` reports `0.3.0`;
   - `https://learnquest-hhiv.onrender.com/api/ready` and `/api/auth/config` exist;
   - `https://learn-quest-one.vercel.app/api/health` reaches Render;
   - the Vercel HTML references the new build asset;
   - root response headers contain the CSP and the other configured headers.
7. Perform real-browser acceptance with an owner-controlled test account: Google start/callback, password login, reset link, email-change link, cloud reload, playlist/import flow, and a test-account deletion. Do not delete a real user.

### P1 - External provider and data-boundary actions

8. Brevo: align the API-key source-IP authorization with Render egress; confirm sender/domain verification; perform one controlled send to an owner-controlled address. Do not disable IP restrictions by default.
9. Local MongoDB: create/verify a restricted `learnquest_dev_user` with `readWrite` on `learnquest_dev`, update the local URI and `MONGODB_DB_NAME` manually, and confirm with a read-only diagnostic. Do not use local writes against `learnquest`; do not construct credentials from guesses.
10. Google Cloud Console: register `https://learn-quest-one.vercel.app/api/auth/google/callback` exactly and confirm the authorized origin. Verify the local callback only if local OAuth is needed.
11. Render dashboard: inspect every key, especially `NODE_ENV`, `NODE_VERSION`, `PORT`, `GOOGLE_REDIRECT_URI`, `TRUST_PROXY_HOPS`, `LQ_USER_DATA_STORE`, the two HMAC secrets, and legacy `OTP_*` values. Preserve valid existing secrets; do not copy local values.
12. Vercel project: confirm root/build/output/Node and environment values. Do not add backend secrets.

### P2 - Residual hardening

13. Decide whether to move forgot-password delivery to an outbox/background path for stricter timing equalization.
14. Decide whether the broad `/api` limiter needs shared storage before horizontal scaling.
15. Plan an `@types/node` 24 upgrade and any resulting type fixes.
16. Recheck production headers/CSP in a real browser and monitor the new deletion fence/maintenance jobs.

---

## 20. Prioritized final-release checklist

### Must pass before calling production released

- [ ] Reviewed working tree and Report 19; no unintended files.
- [ ] Commit/push by owner (not performed by this audit).
- [ ] Render backend deployed from current commit; health version `0.3.0`.
- [ ] Render `/api/ready` and `/api/auth/config` return the expected responses.
- [ ] Vercel frontend deployed from current commit; new asset served.
- [ ] Vercel `/api/health` reaches Render, not a Vercel 404.
- [ ] Live CSP/security headers present.
- [ ] Real Google sign-in completes with browser binding.
- [ ] Password login, reset validation/submission, and email-change link work for an owner-controlled account.
- [ ] Brevo source-IP authorization fixed and one controlled send accepted.
- [ ] Local Mongo development identity restricted and verified before any local writes.
- [ ] Production secrets independent from local; no local secret copied.
- [ ] No secret in Git, build output, browser bundle, report, or logs.

### Should pass before scaling

- [ ] Shared broad `/api` limiter or a single-instance deployment decision.
- [ ] Outbox/timing hardening for forgot-password if strict enumeration resistance is required.
- [ ] `@types/node` alignment.
- [ ] Provider retention and quota review.
- [ ] Monitor deletion fence/deletion job failures and maintenance sweep logs.

### Final acceptance evidence to retain

- [ ] Backend full suite: 25 files / 201 tests pass.
- [ ] Frontend full suite: 42 files / 351 tests pass.
- [ ] Typechecks and builds pass under Node 24.22.1.
- [ ] `npm audit` both packages: 0 vulnerabilities.
- [ ] `git diff --check` exit 0.
- [ ] Live Render/Vercel version and header evidence after deploy.
- [ ] Owner-controlled provider acceptance evidence.

---

## 21. Final Git status and no-commit/no-deploy proof

At the time this report was written, the working tree was still entirely uncommitted. The final `git status --short --branch` was:

```text
## main...origin/main [ahead 9]
 M backend/.env.example
 M backend/src/auth/actionTokens.ts
 M backend/src/auth/crypto.ts
 M backend/src/auth/google.ts
 M backend/src/auth/middleware.ts
 M backend/src/auth/sessions.ts
 M backend/src/config/env.ts
 M backend/src/db/adapter.ts
 M backend/src/db/memoryAdapter.ts
 M backend/src/db/mongo.ts
 M backend/src/routes/account.ts
 M backend/src/routes/auth.ts
 M backend/src/routes/playlists.ts
 M backend/src/server.ts
 M backend/src/services/accountDeletion.ts
 M backend/src/services/userData.ts
 M backend/src/store.ts
 M backend/tests/account-data-contract.test.ts
 M backend/tests/account-deletion.test.ts
 M backend/tests/deployment-config.test.ts
 M backend/tests/multiuser.test.ts
 M backend/tests/origin-config.test.ts
 M docs/user-doc/audit2/README.md
 M frontend/src/features/account/Account.tsx
 M frontend/tests/account-ui.test.tsx
 M frontend/vercel.json
?? LEARNQUEST_COMPLETE_PROJECT_SECURITY_ENV_AUDIT_PROMPT_2026-10-28.txt
?? LEARNQUEST_FINAL_RELEASE_REMEDIATION_ENV_AUDIT_PROMPT_2026-10-28.txt
?? backend/src/auth/writeLease.ts
?? backend/src/middleware/sharedRateLimit.ts
?? backend/src/services/securityMaintenance.ts
?? backend/tests/import-integrity.test.ts
?? backend/tests/security-maintenance.test.ts
?? backend/tests/shared-rate-limit.test.ts
?? docs/user-doc/audit2/18_LEARNQUEST_COMPLETE_PROJECT_SECURITY_ENV_AUDIT_2026-10-28.md
?? docs/user-doc/audit2/19_LEARNQUEST_FINAL_RELEASE_REMEDIATION_ENV_AUDIT_2026-10-28.md
?? frontend/tests/security-headers.test.ts
```

No file is staged. Changed/untracked work includes:

- backend environment template, config, auth, OAuth, sessions, action tokens, database adapters, routes, services, server, store, and tests;
- frontend Account refresh, Vercel security headers, and tests;
- new backend `writeLease.ts`, `sharedRateLimit.ts`, `securityMaintenance.ts`, and regression tests;
- this Report 19 and the existing Report 18 plus the archive-index update.

No staging, commit, push, reset, clean, stash, branch switch, deployment, Render/Vercel setting change, production secret rotation, live account deletion, database migration, collection cleanup, or destructive live database operation occurred. The only production interactions were read-only HTTP probes and read-only MongoDB connectivity/topology checks. The local database was contacted read-only; no local write was executed.

The generated local secret remains only in the ignored `backend/.env`; it is not reproduced here. No secret value was printed during environment reconciliation or QA. The final delivery is ready for the owner's manual review and commit/deploy decision, not an automatic release.
