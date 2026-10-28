# Report 18 — LearnQuest Complete Project Security, Environment Configuration, and Production Readiness Audit (2026-10-28)

**Repository:** `E:\progressGameTracker`  
**Branch audited:** `main`  
**Baseline commit:** `a24fa02` (`partial fix 2`)  
**Production frontend:** `https://learn-quest-one.vercel.app`  
**Production backend:** `https://learnquest-hhiv.onrender.com`

This report is the single new audit document for this run. It was written without printing, copying, or reproducing any password, database URI, API key, OAuth secret, session token, cookie, reset token, HMAC secret, or sensitive provider response. Secret comparisons use only safe classifications such as present, absent, empty, invalid, or mismatched.

---

## 0. Scope, execution policy, and `#max` statement

The audit covered the complete repository rather than only authentication:

- Git status, recent history, tracked/untracked files, `.gitignore`, manifests, lockfiles, deployment files, and audit reports 13–17.
- Frontend framework, routing, store, persistence, API client, authentication flows, account screen, learning-data flows, and build configuration.
- Backend startup, readiness, database lifecycle, auth/session/CSRF/CORS/origin logic, account deletion, rate limiting, email, YouTube, error handling, and data validation.
- Every discovered environment variable against the actual environment loader and its consumers.
- Fresh tests, typecheck, lint, build, dependency audit, MongoDB diagnostic, and safe read-only production checks under Node.js `24.22.1`.

No commit, push, reset, clean, stash, branch switch, destructive database action, production secret change, provider setting change, or deployment was performed.

**`#max`:** this run used the strongest available reasoning effort, but the CLI/model metadata available to this agent does not confirm a `#max` reasoning variant. The report therefore does **not** claim that `#max` was active. The model was `DeepSeek V4.1 Flash Free` (`opencode/deepseek-v4.1-flash-free`). No claim is made about an unverified variant.

---

## 1. Executive summary

### 1.1 Severity-ranked findings

| Severity | Finding | Evidence and status |
|---|---|---|
| **Critical — production blocker** | The live Render and Vercel deployments are stale and mutually incompatible. Render serves an older `0.2.0` build with no `/api/ready` or `/api/auth/config`; Vercel serves an older asset and its `/api/*` paths return 404 instead of reaching Render. Authentication, readiness, and recovery cannot work in production until both services are redeployed from the current commit. | Live checks: Render `/api/health` = 200 with `version:"0.2.0"`; Render `/api/ready` and `/api/auth/config` = 404; Vercel root = 200 with `index-RgZDAXlN.js`; Vercel `/api/health`, `/api/ready`, and `/api/auth/config` = 404. Local source version is `0.3.0`; local build asset was `index-BJYYPxXz.js`. |
| **High — external configuration** | Brevo email remains blocked by the previously verified HTTP 401 source-IP authorization failure. Password-reset and email-change messages cannot be delivered until the Brevo API-key IP policy and/or Render egress are aligned. No new email was sent during this audit and no delivery is claimed. | Report 17 evidence; no send attempted here. Brevo request path is otherwise server-side, timeout-bounded, and sanitized. |
| **High — external connectivity** | Local MongoDB diagnostics currently return `TLS_FAILURE` (`ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`, `tls_alert=internal_error`, retryable), with `ping: false`. Production database readiness cannot be verified because the stale backend has no `/api/ready`. This is an external Atlas/network/access condition, not evidence that the source should weaken TLS or credentials. | Diagnostic run under Node 24.22.1 on 2026-10-28: `classification=TLS_FAILURE`, `ping=false`, elapsed ~7.2 s, database name matches `learnquest`. |
| **Medium — fixed** | Production CORS configuration did not reject an extra `CORS_ORIGIN` entry that used HTTP, localhost/private hosts, credentials, or a non-HTTP scheme. A dashboard override could therefore have silently admitted a development-only origin or a plain-text origin. Fixed with startup validation and regression tests. | `backend/src/config/env.ts`; `backend/tests/origin-config.test.ts`. |
| **Medium — fixed** | `NODE_ENV` accepted arbitrary strings and silently coerced anything other than the exact values `production`/`test` to development, so a typo such as `prod` would disable production-only cookie and origin checks. A Render dashboard override to `development` would have the same effect on a public service even though Render normally injects `production`. Fixed with exact-value validation and a `RENDER=true` non-production startup refusal. | `backend/src/config/env.ts` (`nodeEnvValue`, `assertProductionConfig`); `backend/tests/origin-config.test.ts`. |
| **Medium — fixed** | The optimistic-concurrency version baseline had a read/upsert race: a racy `findOne()` could be followed by an unconditional `$set version: 0`, resetting a version another writer had just created. The first-writer fallback could also let two concurrent writers both report version 1. Fixed with insert-and-reread plus a compare-and-set retry. | `backend/src/services/userData.ts`; `backend/tests/account-data-contract.test.ts`. |
| **Low — fixed** | The Account “Refresh account state” control called `listAccountSessions()` and discarded the result, then refreshed only the auth profile, not server-side learning data, and surfaced no error. Fixed to refresh the session/profile and then reload cloud data with visible busy/success/error states. | `frontend/src/features/account/Account.tsx`; `frontend/tests/account-ui.test.tsx`. |
| **Low — residual** | The Google OAuth `state` is unguessable, hashed at rest, single-use, short-lived, PKCE-bound, and nonce-bound, but it is not additionally bound to a browser cookie. A classic login-CSRF/session-fixation-style scenario remains theoretically possible (an attacker-created authorization response could be opened in a victim browser), although the attacker cannot take over the victim’s existing account with it. | Source review of `backend/src/auth/google.ts`; not changed because a cookie-binding redesign needs a deliberate OAuth flow migration and browser tests. |
| **Low — residual** | The “forgot password” response body is identical for known and unknown identifiers, but an eligible account performs more work (token issue + awaited email send) than an unknown identifier. Response timing can therefore remain a weak account-enumeration side channel despite the generic body. Rate limiting and the resend cooldown substantially reduce practical value. | `backend/src/routes/auth.ts` forgot route; not changed because moving delivery off the response path would alter the current token-invalidation-on-failure guarantee and its tests. |
| **Low — residual** | Rate limiters use the default in-memory store. They are authoritative for one Render instance. If the service is scaled horizontally, each instance has its own counters unless a shared store is introduced. | `backend/src/middleware/rateLimit.ts`, `backend/src/routes/auth.ts`. |
| **Low — residual** | Account deletion is a resumable saga with final verification, but an authenticated request that already passed `requireAuth` can theoretically perform a last write after the deletion sweep has verified zero records. The observed risk is narrow and requires precise concurrency; no production deletion was run. | `backend/src/services/accountDeletion.ts`, `backend/src/auth/middleware.ts`; see residual-risk section. |
| **Low — hardening** | The deployed Vercel root does not currently send the source-defined `Referrer-Policy` or `X-Content-Type-Options` headers, and has no CSP. The checked-in `vercel.json` defines the two headers but not a CSP; the live deployment is stale. This should be rechecked after redeploy. | Live header check versus `frontend/vercel.json`. |

### 1.2 What this audit verified

- Report 17’s source fixes are present in the current tree and covered by the current tests:
  - `/api/auth/session` now applies password-version and expired-onboarding revocation rules.
  - 401 responses only clear the UI session when the server code proves session rejection; a wrong current password on re-auth/change does not sign the user out.
  - Reset-success navigation leaves the standalone email-action route and renders the canonical sign-in screen.
- Source cookie topology is production-appropriate: `__Host-` name, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, absolute `Max-Age`, explicit deletion `Expires`.
- Production environment mode now fails closed: an invalid `NODE_ENV`, or a Render runtime (`RENDER=true`) with a non-production mode, refuses startup instead of silently using development defaults.
- All protected learning-data routes derive ownership from the validated server session, not a client-supplied user ID.
- Action tokens are opaque, HMAC-digested at rest, purpose-bound, account/email-bound, single-use via atomic compare-and-set, and invalidated across password/email changes.
- No `.env` file is tracked or present in Git history; `backend/.env` is ignored. The example files contain no real secrets.
- Both packages have zero known dependency vulnerabilities at the configured audit level.

### 1.3 What this audit does not claim

- It does not claim the live production deployment is usable or secure: it is stale and incomplete.
- It does not claim production cookies were inspected in a real browser: the required auth endpoints are absent in the live build.
- It does not claim Brevo delivery works: the last verified provider response was an HTTP 401 source-IP authorization failure, and no new send was attempted.
- It does not claim MongoDB is reachable from the current local environment or from production: local is `TLS_FAILURE`, and production readiness is unavailable in the stale build.
- It does not claim `#max` was active.
- It does not claim the application is unhackable. Residual risks are listed explicitly.

---

## 2. Baseline and preserved work

### 2.1 Git baseline

At the start of this audit:

- Branch: `main`, ahead of `origin/main` by 9 commits.
- HEAD: `a24fa02 partial fix 2`.
- The only untracked file was the audit prompt:
  `LEARNQUEST_COMPLETE_PROJECT_SECURITY_ENV_AUDIT_PROMPT_2026-10-28.txt`.
- No staged or unstaged changes were present before this run’s fixes.

Report 17’s source changes are committed in `a24fa02`; the prior report recorded the earlier baseline `e741852 partial fix 1`. The current tree preserves those changes and adds only the fixes listed in section 5.

### 2.2 Files inspected

The inventory included, among others:

- Root: `README.md`, `HOW_TO_USE_LEARNQUEST.md`, `.gitignore`, `render.yaml`.
- Backend: `package.json`, `package-lock.json`, `.env.example`, `.node-version`, `tsconfig.json`, `eslint.config.js`, all `src/**` modules, and all `tests/**`.
- Frontend: `package.json`, `package-lock.json`, `.env.example`, `vite.config.ts`, `tsconfig.json`, `vercel.json`, `index.html`, all `src/**`, and all `tests/**`.
- Audit archive: `docs/user-doc/audit2/README.md` and reports 13–17.

No unrelated application source was rewritten, no production data was touched, and no deployment configuration was changed.

---

## 3. Architecture and trust boundaries

### 3.1 Repository and runtime shape

- **Frontend:** React 18 + TypeScript + Vite 6. Hash-based route selection in `frontend/src/app/App.tsx`; the main state/auth authority is `frontend/src/app/store.tsx`. Local development persistence uses IndexedDB (`frontend/src/services/persistence/db.ts`); production uses authenticated cloud persistence.
- **Backend:** Express 4 + TypeScript, with MongoDB via the official driver. Startup and lifecycle are in `backend/src/server.ts`; middleware composition is in `backend/src/app.ts`.
- **Data:** `backend/src/services/userData.ts` implements validation, optimistic versioning, import/export, and collection replacement. `backend/src/services/accountDeletion.ts` implements a resumable deletion saga. The active storage layout is selected by `LQ_USER_DATA_STORE` (`legacy` by default; `unified` only after explicit acknowledgement).
- **Auth:** `backend/src/auth/*` implements accounts, Argon2id password hashes, random sessions, CSRF, Google OAuth, action tokens, and middleware. `backend/src/routes/auth.ts` and `backend/src/routes/account.ts` expose the account surface.
- **External services:** Google OAuth/OIDC, YouTube Data API v3, MongoDB Atlas, Brevo transactional email, Render (backend hosting), Vercel (frontend hosting and `/api` rewrite).

### 3.2 Request and trust flow

Production is intended to be same-origin from the browser’s point of view:

```text
Browser
  └─ https://learn-quest-one.vercel.app
       ├─ static React assets
       └─ /api/* rewrite
            └─ https://learnquest-hhiv.onrender.com/api/*
                 └─ Express on Render
                      ├─ MongoDB Atlas
                      ├─ Google OAuth token/JWKS endpoints
                      ├─ YouTube Data API
                      └─ Brevo API
```

Consequences:

- The browser sees a single first-party origin (`learn-quest-one.vercel.app`), so the session cookie is sent to `/api/*`.
- `VITE_API_BASE_URL` must remain empty for this topology. A direct `*.vercel.app` → `*.onrender.com` browser API call would be cross-site for the `SameSite=Lax` cookie and would break authentication.
- Google’s production redirect URI must be the public app-origin callback through the Vercel proxy:
  `https://learn-quest-one.vercel.app/api/auth/google/callback`.
- `TRUST_PROXY_HOPS=2` describes Browser → Vercel edge → Render edge → Express. It must not be increased speculatively; a mismatch can make rate-limit and request-IP handling trust the wrong hop.
- Render’s own `PORT` is platform-supplied. The application must listen on that value, not on a copied local `3001`.

### 3.3 Core security invariants verified

1. The server session is the only authority for identity. No route accepts a client-supplied owner ID as authorization.
2. The raw session token is never stored in the database; only an HMAC digest is stored.
3. Every authenticated mutation requires a per-session CSRF header verified with a timing-safe comparison.
4. Credentialed CORS is exact-origin, never wildcard; production origins are HTTPS/public after this run’s hardening.
5. Email action tokens are opaque, purpose-bound, single-use, and never placed in a server-visible query string.
6. A failed database read or failed cloud save is never presented as an empty account or a successful save.
7. Account deletion removes every account-scoped collection and verifies zero counts before claiming success.

---

## 4. Complete backend/frontend security review

### 4.1 Cookies and sessions

**Cookie construction** — `backend/src/auth/crypto.ts` (`cookieHeader`, `sessionTokenHash`), `backend/src/config/env.ts` (`sessionCookieName`, `cookieSecure`), `backend/src/auth/middleware.ts` (`setSessionCookie`, `clearSessionCookie`).

Production cookie attributes:

| Attribute | Source behavior |
|---|---|
| Name | `__Host-lq_session` in production; `lq_session` outside production. |
| `HttpOnly` | Always present. |
| `Secure` | Present in production; production configuration requires HTTPS origins. |
| `SameSite` | `Lax`. |
| `Path` | `/`. |
| `Domain` | Never set; this is required for the `__Host-` prefix. |
| `Max-Age` | Absolute session lifetime (`SESSION_ABSOLUTE_DAYS`, default 30 days). |
| `Expires` | Explicit future date; deletion uses the Unix epoch. |
| Clearing | `clearSessionCookie()` emits an empty value, `Max-Age=0`, and epoch `Expires` with the same name/path/Secure attributes. |

The source-level cookie topology is correct for the same-origin Vercel proxy. Because the live auth endpoints are absent, this audit could not inspect a real production `Set-Cookie` header after an actual sign-in. That verification remains an owner acceptance test after deployment.

**Session records** — `backend/src/auth/sessions.ts`:

- 32 random bytes, base64url, returned to the client once.
- `tokenHash = HMAC-SHA256(SESSION_SECRET, "session:" + token)` at rest.
- Absolute expiry and idle expiry are both enforced server-side; `touchSession` extends idle expiry only up to the absolute expiry.
- `rotateSession` revokes the presented session before creating a new one on login and onboarding.
- Password changes/resets increment an atomic `passwordVersion`; `requireAuth` and `/api/auth/session` reject a session whose version is stale and revoke it.
- `isGoogleOnboardingSession` binds a pending Google registration session to the Google subject and a 30-minute onboarding deadline.
- `revokeAllSessions` supports cross-device sign-out; password change excludes the current session and then rotates it.
- `listSessions` is scoped by `userId` and filters expired records; the route marks the current session by ID.

**Session-status consistency** — Report 17’s fix is present at `backend/src/routes/auth.ts` (`/session`). It now applies the same password-version and pending-onboarding revocation rules as protected routes. This closes a window where an invalidated session could still render an authenticated shell until the next account request failed.

**Cross-tab behavior** — `frontend/src/app/authSync.ts` sends only a reason and timestamp over `BroadcastChannel`, falling back to a localStorage event. `frontend/src/app/store.tsx` invalidates in-flight epochs and generation counters before clearing local session state. A late cloud load/save cannot repopulate the previous account’s UI after sign-out.

### 4.2 CSRF, CORS, origins, and proxy trust

**CSRF** — `backend/src/auth/middleware.ts` (`requireCsrf`) and `backend/src/auth/sessions.ts` (`verifyCsrf`):

- Token is generated per session with `randomToken(24)`.
- It is returned in the session/login/onboarding/password-change JSON and kept only in frontend memory.
- `safeEqual` uses `crypto.timingSafeEqual`; length mismatch still performs a comparison path and returns false.
- All authenticated state-changing routes use `requireCsrf` (profile, preferences, data writes, import/migration, playlist archive/delete, session revocation, email change, account deletion, logout-all, onboarding, reauth, password change).
- Public token-bearing endpoints (`/account/email/confirm`, `/auth/password/reset`, `/auth/password/reset/validate`) use opaque bearer tokens rather than a session CSRF token.

**CORS** — `backend/src/app.ts` and `backend/src/config/env.ts`:

- `origin: env.corsOrigin`, `credentials: true`, explicit methods/headers.
- Wildcard is rejected.
- `APP_ORIGIN` is always merged into the allowlist.
- Production hardening added in this run: every configured extra origin must be a valid origin-only URL, must not include credentials, must use HTTP(S), and in production must use HTTPS and a public host (not localhost, private IP, `.local`, `.internal`, or metadata host).
- `assertProductionConfig()` now evaluates the allowlist at startup so an invalid value fails before listening.

**Origin check** — `backend/src/auth/middleware.ts` (`requireTrustedOrigin`): when an `Origin` header is present it must normalize to an exact allowlist entry; invalid or foreign origins receive 403 `ORIGIN_NOT_ALLOWED`. When `Origin` is absent, the request is allowed, matching non-browser clients; authenticated mutations are still protected by the CSRF token. This is the intended layered design, not a replacement for CSRF.

**Proxy trust** — `backend/src/app.ts`:

- `app.set('trust proxy', hops)` only when `TRUST_PROXY_HOPS > 0`; default 1, range 0–10.
- Production blueprint uses 2 for Browser → Vercel → Render → Express.
- `clientInfo()` hashes `req.ip` before storing it, so raw IPs are not persisted in session/audit records.
- The exact production hop count could not be re-inspected live because the deployed backend lacks the new endpoints/logging. Do not change it without observing the real proxy chain.

**Residual:** the login endpoint itself is sessionless and has no CSRF token; a cross-site form could attempt login CSRF. The practical impact is limited to signing a victim into an attacker-controlled account, and rate limiting applies. This is reported rather than silently “fixed” with a design change that could break the Vercel proxy.

### 4.3 Google OAuth

`backend/src/auth/google.ts`:

- Authorization code flow with PKCE (`S256`), `nonce`, `state`, and `prompt=select_account`.
- State is stored only as SHA-256 hash; the record is single-use via atomic `findOneAndUpdate`, expires after 10 minutes, and records the intent and optional owner user ID.
- Token exchange uses `GOOGLE_CLIENT_SECRET` only server-side, a 10-second timeout, and the exact configured redirect URI.
- ID token verification uses Google JWKS, issuer/audience/expiry checks in `jose`, plus explicit `nonce`, issuer, audience, expiry, and `email_verified` checks in `validateGoogleClaims`.
- Login and registration intents are distinct: an unknown Google identity arriving through login is never auto-registered.
- Existing email ownership without a linked Google subject returns `LINK_REQUIRED`; the application never auto-links by email string.
- Registration reuses an interrupted pending account only when the Google subject matches.
- The OAuth callback builds redirects from `env.appOrigin`, never from `Host` or `X-Forwarded-Host`.
- The production callback must be registered in Google Cloud Console exactly as configured.

**Residual:** state is not bound to a browser cookie. A stolen/attacker-generated authorization response could be opened in another browser (login CSRF), but it cannot be used to take over an existing account without controlling the Google identity. A full fix would require an additional short-lived browser-binding cookie and a deliberately re-tested OAuth flow; it is an owner decision, not a safe last-minute change.

### 4.4 Account isolation and data authorization

- Every protected route obtains `req.auth.userId` from `requireAuth`, which validates the session and reloads the account.
- `requireOnboarded` rejects pending registration accounts from account data and playlist management.
- `routes/account.ts` scopes reads, writes, exports, migrations, session lists, and deletion by `req.auth.userId`.
- `routes/playlists.ts` scopes archive, restore, summary, and delete by the authenticated user.
- `services/userData.ts` passes `userId` into every query/update and rejects client-supplied `userId`, `ownerId`, or `accountId` fields (`noOwnershipFields`).
- `services/accountDeletion.ts` deletes every account-scoped collection, including legacy per-domain, unified, sessions, action tokens, OAuth states, migrations, state versions, legacy challenges/grants, and playlist deletion jobs, then verifies zero counts.
- Tests cover cross-account access, IDOR attempts, ownership-field rejection, session revocation, and account deletion cascade.

**Residual:** an in-flight authenticated write can theoretically complete after the deletion verification because the write route already holds a validated auth context. The existing saga verifies again after account removal, but narrow interleavings remain. This is a concurrency residual, not a missing ownership check; no live deletion was performed.

### 4.5 Password recovery and email action tokens

`backend/src/auth/actionTokens.ts` and `backend/src/routes/auth.ts` / `routes/account.ts`:

- Opaque 32-byte tokens; only `HMAC-SHA256(EMAIL_ACTION_HMAC_SECRET or legacy OTP_HMAC_SECRET, "email-action:" + token)` is stored.
- Records are purpose-bound (`password_reset` or `email_change`), bound to the account email at issue time, and bound to the target email for a change.
- Read-only validation (`/auth/password/reset/validate`) never consumes a token; the reset form can show expired/invalid/unavailable states without burning a valid link.
- Consumption uses a single atomic `findOneAndUpdate` filter on `tokenHash`, `purpose`, `consumedAt: null`, and server-side `expiresAt > now`.
- Password reset revokes every session, invalidates every outstanding email action for the account, and consumes legacy recovery artifacts.
- Email change verification consumes the token, rechecks account status and account-email binding, updates the email, revokes all sessions, clears the cookie, and notifies the previous address.
- Password change invalidates all outstanding emailed actions and rotates the current session.
- The token is in the URL fragment, never the server-visible query string, so it is not sent to Vercel, Render, logs, or analytics.
- Expiry/resend policy is sourced from `EMAIL_ACTION_TTL_MIN` / `EMAIL_ACTION_RESEND_SEC` with legacy fallbacks.

**Residual:** forgot-password response timing differs between an eligible account and an unknown identifier because token issuance and the awaited provider send happen only for eligible accounts. The body is generic and rate limits apply; this is reported as a low-severity enumeration side channel.

### 4.6 Email pipeline (Brevo)

`backend/src/email/brevo.ts`:

- API key, sender email, and sender name come only from backend environment variables.
- Requests go only to `https://api.brevo.com/v3/smtp/email` with a 10-second AbortController timeout.
- Action URLs are validated against `APP_ORIGIN` in production; foreign hosts are rejected.
- HTML is escaped for dynamic copy; the action URL is escaped in HTML and also included as plain text.
- Provider failures are logged with a status, a short provider code, and a request ID only; response bodies and recipient data are not logged.
- “Accepted” (provider HTTP success) is explicitly not treated as inbox delivery.
- Security notices (password change/reset/email change) are best-effort and never turn a completed security change into a success claim for delivery.

**Current external blocker:** the previously verified Brevo response was HTTP 401 caused by source-IP authorization, not a code bug. No new send was attempted. Sender/domain SPF/DKIM/DMARC and IP authorization remain owner-verified settings.

### 4.7 Account deletion and data lifecycle

`backend/src/services/accountDeletion.ts` implements a resumable saga:

1. Mark account `deleting` with an atomic state transition.
2. Persist a minimal deletion job.
3. Revoke sessions and delete every known account-scoped collection.
4. Verify all data counts are zero.
5. Delete the account document.
6. Verify account/data absence.
7. Remove the job and verify final absence.

A startup sweep resumes jobs left by a crash or transient failure and never deletes an account that is still active. Success is not returned before verification. The cascade includes legacy and unified learning data, sessions, action tokens, OAuth state, migrations, state versions, and deletion jobs. No real account deletion was performed.

### 4.8 YouTube, input validation, errors, and logging

- YouTube calls use fixed Google API endpoints, a validated playlist ID, a 10-second timeout, bounded retries only for 429/5xx/timeouts, and no retry for 400/403/404. The API key is server-side; quota and auth errors are sanitized.
- Request bodies are bounded by `express.json({ limit: min(ACCOUNT_MAX_STATE_BYTES + 256 KiB, 16 MiB) })`.
- Account state is validated by domain-specific limits (`MAX_ITEMS`, per-field bounds) and a total byte cap.
- Error handling never returns stack traces or driver messages; Mongo availability failures become retryable 503 `DATABASE_UNAVAILABLE` with sanitized diagnostics.
- Request IDs are generated per request and returned in `X-Request-Id`; logs contain method, route, status, and sanitized codes only.
- `/api/health` is liveness only; `/api/ready` is readiness. Health explicitly does not imply database readiness.
- `/api/cache` is a public operational counter endpoint. It exposes counts/bytes/API statistics, not cache keys, URLs, titles, or user data. This is low-risk information disclosure; restrict it at the proxy if it is not intended for public use.

### 4.9 Frontend security and quality

- Session tokens, passwords, OAuth secrets, Brevo keys, database URIs, and reset tokens are never written to localStorage, sessionStorage, IndexedDB, or the URL query string.
- The only `VITE_*` variable is `VITE_API_BASE_URL`, which is public build-time configuration and must be empty for the same-origin proxy.
- CSRF token lives only in module memory and is cleared on sign-out, reset/verification exit, account deletion, and session rejection.
- The API client classifies session rejection by server code (`UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `ACCOUNT_UNAVAILABLE`) so a wrong current password on a security form does not sign the user out.
- Reset/verification links are standalone public screens; the token is stripped from browser history immediately after capture; success broadcasts sign-out to other tabs and the exit control performs an in-app state transition rather than a same-document `location.assign`.
- In-flight load/save generations are invalidated before clearing an account, preventing late responses from repopulating authenticated UI.
- Cloud saves are marked “saved” only after the server confirms each collection; conflicts show a reload action, errors show a retry action. A failed read shows an error card, not an empty account.
- Focus-timer recovery uses a short-lived localStorage snapshot (`lq-focus-timer-v1`) including an unfinished note. It is cleared on sign-out, reset, email change, deletion, and clear-all. This is intentional recovery data, not a credential; it remains a residual local-plaintext privacy consideration.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` usage was found in frontend source.
- The Account page is structurally separated from playlist headers/content; the account shell does not show playlist-specific chrome.
- Accessibility features include labelled tabs, keyboard arrow navigation, focus restoration for dialogs/drawers, `aria-live` statuses, and reduced-motion preference handling. No real-browser accessibility audit was run.

### 4.10 Residual-risk register

| Risk | Why it remains | Recommended handling |
|---|---|---|
| OAuth login CSRF / state not browser-bound | State is server-side single-use but not tied to the browser that started the flow. | Consider a short-lived `__Host-` OAuth-binding cookie and re-test both custom-domain and proxy topologies. |
| Forgot-password timing | Eligible accounts do extra work; generic body does not equalize time. | Keep rate limits; if strict anti-enumeration is required, move delivery to an outbox/background worker with a constant-time response path. |
| In-memory rate limiting | Per-instance counters. | Use one Render instance or a shared store before horizontal scaling. |
| Deletion vs in-flight writes | No cross-document transaction; auth context is validated before a write. | Accept narrow race or add a per-user write lock/deletion tombstone if strict guarantees are required. |
| Rollback best-effort | Mongo adapter has no transactions; restore loops can themselves fail. | Keep backups, monitor failures, and retry through the documented recovery paths. |
| Public `/api/cache` counters | Operational metadata is public. | Restrict at edge/proxy if not needed publicly. |
| No frontend CSP | Static app currently has no CSP; source defines only Referrer-Policy/nosniff. | Add a tested CSP after enumerating Vite/React/inline-style requirements; do not guess. |
| Local TypeScript types (`@types/node` 22) vs Node 24 | Runtime is 24.22.1 but type package is v22. | Not a runtime security finding; update types in a planned dependency change. |

---

## 5. Defects fixed in this run

### 5.1 Production CORS allowlist did not fail closed

**Root cause:** `env.corsOrigin` validated paths/queries/fragments and rejected `*`, but it did not validate an extra configured origin’s scheme, credentials, or host. A production dashboard value such as `http://localhost:5173`, `https://127.0.0.1:5173`, a credentialed URL, or a `file:` origin could be accepted into the allowlist. `assertProductionConfig()` also did not evaluate `CORS_ORIGIN` at startup.

**Fix:** `backend/src/config/env.ts` now:

- rejects URL credentials;
- rejects non-HTTP(S) schemes;
- rejects paths/queries/fragments with an explicit message;
- in production, requires HTTPS and a public host (reusing `isLocalOrPrivateHost`);
- evaluates the complete allowlist inside `assertProductionConfig()`.

**Regression tests:** `backend/tests/origin-config.test.ts` — `fails closed for insecure, local, or credentialed extra CORS origins in production`. The test covers HTTP localhost, private IP, path-bearing URL, credentialed URL, `file:` URL, a valid extra public HTTPS origin, and startup validation.

### 5.2 `NODE_ENV` fail-open and Render non-production startup

**Root cause:** `env.nodeEnv` mapped any value other than the exact strings `production` and `test` to `development`, and `productionRuntime()` compared against `production` only. A typo (`prod`, `Production`, or a stray character) therefore silently selected development behavior instead of failing closed: non-`__Host-`/non-Secure cookies, development origin defaults, and skipped production checks. On Render, a dashboard override of `NODE_ENV` to `development` or `test` would have the same effect even though Render normally injects `production`.

**Fix:** `backend/src/config/env.ts` now:

- validates `NODE_ENV` as exactly `development`, `test`, or `production` and throws on any other value;
- refuses to start when `RENDER=true` and the effective mode is not `production`;
- leaves the existing production checks unchanged for a valid production value.

**Regression tests:** `backend/tests/origin-config.test.ts`:

- `rejects an unrecognized NODE_ENV instead of silently using development defaults` — sets `NODE_ENV=prod` and asserts both `env.nodeEnv` and `assertProductionConfig()` throw.
- `refuses to run a Render service in a non-production NODE_ENV` — sets `RENDER=true` with `NODE_ENV=development` and asserts startup is refused.

### 5.3 Optimistic-concurrency version baseline race

**Root cause:** `getStateVersion()` did `findOne()` and, on a miss, an unconditional `updateOne({ userId }, { $set: { version: 0 } }, { upsert: true })`. If another writer created the version document between those calls, the unconditional `$set` reset it to zero. A stale client could then save against a version that should already have advanced. In `reserveVersion()`, the first-writer fallback used an unconditional upsert of `expected + 1`, so two concurrent first writers could both report success at version 1.

**Fix:** `backend/src/services/userData.ts` now:

- creates the missing baseline with `insertOne` and resolves a duplicate-key race by re-reading the winner;
- retries the same compare-and-set `{ userId, version: expected }` after creating the baseline;
- never unconditionally overwrites an existing version.

**Regression tests:** `backend/tests/account-data-contract.test.ts`:

- `never resets an existing state version when the first read raced document creation` — simulates a missed read + duplicate creation and asserts version 7 remains 7.
- `does not let two concurrent first writers both reserve version 1` — simulates a lost CAS plus a stale baseline and asserts `VERSION_CONFLICT`, leaving the winner at version 1.

### 5.4 Account “Refresh account state” did nothing useful

**Root cause:** the control called `s.listAccountSessions()` and discarded the result, then called `s.refreshSession()`. That refreshed only the session/profile payload, not server-side learning data, so a change made on another device was not loaded; failures produced no visible message, and the disabled state was tied to an unrelated save operation.

**Fix:** `frontend/src/features/account/Account.tsx` now calls `refreshSession()` and then `reloadCloudData()`, with busy/success/error states. `reloadCloudData()` uses the existing `loadCloud` path, so a failed read remains an explicit error and cannot be saved back as empty data.

**Regression test:** `frontend/tests/account-ui.test.tsx` — `refreshes the authenticated profile and server-side account data` verifies both calls and the visible success status.

### 5.5 Prior Report 17 fixes retained and re-verified

The current suite still verifies:

- session-status revocation consistency;
- wrong-password responses not triggering global session expiry;
- reset-success navigation to a real sign-in state with the token removed;
- cross-tab sign-out and stale-response invalidation;
- token expiry/replay/account binding and email-change invalidation.

---

## 6. Node.js runtime and dependency baseline

### 6.1 Official release check at execution time

Official sources consulted:

- `https://nodejs.org/en/blog/release`
- `https://nodejs.org/en/blog/release/v24.22.1`

At audit time, the Node.js releases page lists **Node.js 24.22.1 (LTS)** as the latest LTS and **Node.js 26.12.1 (Current)** as the latest Current release. Node.js 24.22.1 was released on **2026-10-21** as a security release and remains the appropriate Node 24 LTS patch for this project. Node.js 22.23.4 is also an LTS release, but this project standardizes on the 24 line.

The official 24.22.1 release notes list:

- High: CVE-2026-106069 and CVE-2026-106072 (TLS non-canonical IP handling), CVE-2026-105482 (DNS null-byte validation), CVE-2026-105483 (TLS IP normalization regression), CVE-2026-111497 (Brotli).
- Medium: CVE-2026-105481 (HTTP agent data guard), CVE-2026-106074 (crypto random caches across snapshots).
- Low: CVE-2026-106073 (permission model in `realpathSync`).
- Dependency/root-certificate updates including c-ares, timezone data, OpenSSL, and undici.

These are Node.js runtime advisories. The project does not include PHP: no PHP runtime, PHP files, Composer manifest, or PHP deployment step was found. PHP-specific CVEs are **not applicable** to this repository and must not be conflated with Node.js advisories.

### 6.2 Runtime declarations

- Local default Node was `v24.11.0`; npm `11.6.1`.
- All mandated QA in this run was executed with **Node.js 24.22.1** by prepending the cached `npx node@24.22.1` binary directory to `PATH`.
- `backend/.node-version` = `24.22.1`.
- Backend `package.json` `engines.node` = `>=24.22.1 <25`.
- Frontend `package.json` `engines.node` = `>=24.22.1 <25` (added in Report 17).
- `render.yaml` sets `NODE_VERSION=24.22.1`.
- Vercel’s Node build/runtime is a project setting; it must be verified as Node 24.x in the Vercel dashboard. A `NODE_VERSION` environment variable in Render does not configure Vercel.

### 6.3 Dependency audit

`npm audit --audit-level=low --json` under Node 24.22.1:

| Package | Total dependencies reported | Vulnerabilities |
|---|---:|---:|
| Backend | 339 | 0 (info 0, low 0, moderate 0, high 0, critical 0) |
| Frontend | 395 | 0 (info 0, low 0, moderate 0, high 0, critical 0) |

No `npm audit fix --force` or dependency downgrade was used. The audit does not prove runtime reachability of every transitive package, but no known advisory was reported by npm at this time.

---

## 7. Full environment-variable audit

### 7.1 Method and presence classification

The actual loader is `backend/src/config/env.ts`. It reads `process.env` through `intEnv`, `intEnvAlias`, `stringEnv`, `secretEnv`, `originEnv`, and direct getters. The only frontend environment variable is `VITE_API_BASE_URL` (`frontend/src/services/api/http.ts`).

`backend/.env` exists locally, is ignored by `.gitignore`, and was not printed. Safe key-level inspection showed:

- Present and non-empty locally: `YOUTUBE_API_KEY`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `APP_ORIGIN`, `API_ORIGIN`, `CACHE_TTL_SEC`, `CACHE_MAX_ENTRIES`, `RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`, `OTP_RATE_LIMIT_PER_15MIN`, `TRUST_PROXY_HOPS`, `MONGODB_URI`, `MONGODB_DB_NAME`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `SESSION_SECRET`, `OTP_HMAC_SECRET`, `OTP_TTL_MIN`, `OTP_RESEND_SEC`, `OTP_MAX_ATTEMPTS`, `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_DAYS`, `REAUTH_WINDOW_MIN`, `ACCOUNT_MAX_STATE_BYTES`.
- Absent locally: `NODE_VERSION`, `EMAIL_ACTION_HMAC_SECRET`, `EMAIL_ACTION_TTL_MIN`, `EMAIL_ACTION_RESEND_SEC`, `EMAIL_ACTION_RATE_LIMIT_PER_15MIN`, `LQ_USER_DATA_STORE`, `LQ_USER_DATA_CUTOVER_ACK`.
- `frontend/.env.example` is tracked and contains only an empty `VITE_API_BASE_URL`; no real `frontend/.env.local` was present.

The absent new `EMAIL_ACTION_*` names are not a source defect: the server accepts the legacy `OTP_HMAC_SECRET`, `OTP_TTL_MIN`, and `OTP_RESEND_SEC` fallbacks. Production should use the dedicated names, as the blueprint does, and should not depend on local legacy values.

### 7.2 Environment matrix

Legend: **Req.** = Required / Conditional / Optional / Legacy / Obsolete / Platform. **Class** = Secret / Public ID / URL / Setting / Sensitive metadata. Code references are at audit time.

#### A. Runtime, network, policy, and storage

| Name | Purpose | Class | Code references | Local development | Render production | Vercel | Req. | Recommended action | Security impact |
|---|---|---|---|---|---|---|---|---|---|
| `NODE_ENV` | Selects production fail-closed behavior, cookie prefix, Secure cookies, and production origin checks. | Setting | `backend/src/config/env.ts` (`nodeEnvValue`, `nodeEnv`, `isProduction`, `originEnv`, `sessionCookieName`, `cookieSecure`, `assertProductionConfig`) | `development` | `production` | Not used | Required in production | Keep exact in Render; never set `development` there. | An unrecognized value now throws instead of defaulting to development; `RENDER=true` with a non-production mode refuses startup. Missing/development values would otherwise disable production checks and use non-`__Host-` non-Secure cookies. |
| `PORT` | HTTP listener port. | Setting | `backend/src/config/env.ts` (`port`), `backend/src/server.ts` (`app.listen`) | `3001` | Render supplies automatically; do not set a manual `3001` override | Not used | Platform | Remove any dashboard `PORT` override; let Render inject it. | A wrong port can fail Render health checks and routing. |
| `NODE_VERSION` | Render runtime pin. | Setting | `render.yaml`; `backend/.node-version`; package `engines` | Not present; local Node is separate | `24.22.1` in blueprint | Vercel project setting, not this Render var | Platform/runtime | Keep `24.22.1`; verify build log after deploy. | Running an unpatched Node line reintroduces the fixed CVEs; a dashboard override can defeat the blueprint. |
| `APP_ORIGIN` | Public frontend origin used for email-action links, OAuth post-login redirects, and production origin validation. | URL | `backend/src/config/env.ts` (`appOrigin`), `backend/src/auth/actionTokens.ts` (`emailActionUrl`), `backend/src/routes/auth.ts` OAuth redirects, `backend/src/email/brevo.ts` (`assertActionUrl`) | `http://localhost:5173` | `https://learn-quest-one.vercel.app` | Not used (build-time API base is separate) | Required in production | Keep exact; must be the Vercel origin, not Render. | A localhost/wrong origin produces unusable or attacker-redirectable reset links and OAuth redirects; production validation is HTTPS/public. |
| `CORS_ORIGIN` | Exact credentialed browser allowlist, merged with `APP_ORIGIN`. | URL | `backend/src/config/env.ts` (`corsOrigin`), `backend/src/app.ts` (`cors`) | `http://localhost:5173` | `https://learn-quest-one.vercel.app` | Not used | Required in production | Keep identical to `APP_ORIGIN` unless a deliberate additional public origin exists. | Wildcards are rejected; the new validation rejects HTTP/localhost/private/credentialed extras in production. |
| `API_ORIGIN` | Public backend origin; default base for `GOOGLE_REDIRECT_URI`. | URL | `backend/src/config/env.ts` (`apiOrigin`, `googleRedirectUri` default) | `http://localhost:3001` | `https://learnquest-hhiv.onrender.com` | Not used | Required in production | Keep exact Render service origin. | A wrong origin breaks default OAuth callback derivation; localhost in production is rejected. |
| `TRUST_PROXY_HOPS` | Number of trusted reverse-proxy hops for `req.ip` and rate limiting. | Setting | `backend/src/config/env.ts` (`trustProxyHops`), `backend/src/app.ts` (`app.set('trust proxy')`) | `0` for direct API; `1` if a local reverse proxy is used | `2` for Browser → Vercel → Render → Express | Not used | Required in production | Keep `2` only while the Vercel `/api` rewrite is the live topology; verify after deploy. | Too high trust permits spoofed client IP/rate-limit buckets; too low collapses all users behind a proxy. |
| `CACHE_TTL_SEC` | Playlist snapshot cache TTL. | Setting | `backend/src/config/env.ts` (`cacheTtlSec`), `backend/src/app.ts` (`createMemoryCache`) | `600` | `600` | Not used | Optional | Keep unless cache policy changes. | Unbounded/stale cache can serve outdated playlist metadata; not a secret. |
| `CACHE_MAX_ENTRIES` | Maximum in-memory cache entries. | Setting | `backend/src/config/env.ts` (`cacheMaxEntries`), `backend/src/cache/memoryCache.ts` | `50` | `50` | Not used | Optional | Keep; size for memory limits. | Too high can exhaust memory; too low causes upstream load. |
| `RATE_LIMIT_PER_MIN` | Per-client-IP API request limit. | Setting | `backend/src/config/env.ts` (`rateLimitPerMin`), `backend/src/middleware/rateLimit.ts` | `30` | `30` | Not used | Optional | Keep `30` unless capacity testing supports another value. | Too high permits abuse; too low breaks normal cloud saves/imports. |
| `AUTH_RATE_LIMIT_PER_MIN` | Login/OAuth limiter maximum. Despite the name, the route uses a 15-minute window. | Setting | `backend/src/config/env.ts` (`authRateLimitPerMin`), `backend/src/routes/auth.ts` (`loginLimiter`) | `20` | `20` | Not used | Optional | Keep `20`; note the unit mismatch. | Too high enables credential stuffing; too low can lock out shared networks. |
| `EMAIL_ACTION_RATE_LIMIT_PER_15MIN` | Reset/verification request limiter per IP per 15 minutes. | Setting | `backend/src/config/env.ts` (`emailActionRateLimitPer15Min`), `backend/src/routes/auth.ts`, `backend/src/routes/account.ts` | Absent; legacy fallback present | `8` | Not used | Optional | Keep `8`; set the new name explicitly. | Too high allows email bombing/provider quota burn; too low blocks legitimate retries. |
| `SESSION_IDLE_HOURS` | Idle session expiration. | Setting | `backend/src/config/env.ts` (`sessionIdleHours`), `backend/src/auth/sessions.ts` | `168` | `168` | Not used | Optional | Keep `168` if one-week idle policy is intended. | Too long expands stolen-session exposure; too short annoys users. |
| `SESSION_ABSOLUTE_DAYS` | Absolute session lifetime. | Setting | `backend/src/config/env.ts` (`sessionAbsoluteDays`), `backend/src/auth/sessions.ts` | `30` | `30` | Not used | Optional | Keep `30`. | Too long expands exposure; rotation/revocation still apply. |
| `REAUTH_WINDOW_MIN` | Recent-auth window for password/email/delete actions. | Setting | `backend/src/config/env.ts` (`reauthWindowMin`), `backend/src/auth/middleware.ts` (`requireRecentAuth`) | `10` | `10` | Not used | Optional | Keep `10`. | Too long weakens step-up proof; too short frustrates users. |
| `EMAIL_ACTION_TTL_MIN` | Reset/email-change link lifetime. | Setting | `backend/src/config/env.ts` (`emailActionTtlMin`), `backend/src/auth/actionTokens.ts` | Absent; legacy `OTP_TTL_MIN` fallback present | `30` | Not used | Required for production policy | Set `30`; after verification remove the legacy `OTP_TTL_MIN` if present. | Longer links increase interception window; shorter links increase failed recovery. |
| `EMAIL_ACTION_RESEND_SEC` | Cooldown before issuing another email-action link. | Setting | `backend/src/config/env.ts` (`emailActionResendSec`), `backend/src/routes/auth.ts`, `backend/src/routes/account.ts` | Absent; legacy `OTP_RESEND_SEC` fallback present | `60` | Not used | Required for production policy | Set `60`; after verification remove the legacy `OTP_RESEND_SEC` if present. | Too short enables email bombing; too long blocks legitimate retries. |
| `ACCOUNT_MAX_STATE_BYTES` | Total account-state byte limit. | Setting | `backend/src/config/env.ts` (`accountMaxStateBytes`), `backend/src/app.ts` body limit, `backend/src/services/userData.ts` | `8388608` | `8388608` | Not used | Optional | Keep 8 MiB unless product requirements change. | Too high increases memory/DoS exposure; too low blocks legitimate history. |
| `LQ_USER_DATA_STORE` | Selects `legacy` per-domain collections or consolidated `lq_user_data`. | Setting | `backend/src/config/env.ts` (`userDataStore`), `backend/src/store.ts` (`domainData`) | Absent → `legacy` default | Leave absent unless the verified current value is `unified`; do not switch modes during this deployment | Not used | Conditional | Preserve the verified production mode. If absent, the code default `legacy` applies; never switch an existing unified deployment without migration evidence. | A silent/wrong switch can make the app read an empty layout; there is no automatic fallback. |
| `LQ_USER_DATA_CUTOVER_ACK` | Explicit acknowledgement required for production `unified` store. | Setting | `backend/src/config/env.ts` (`userDataCutoverAcknowledged`), `assertProductionConfig` | Absent | Unset unless `unified` is deliberately approved | Not used | Conditional | Leave unset for `legacy`; set only after verified migration. | Missing acknowledgement fails production startup when `unified` is selected; setting it prematurely can expose an unverified layout. |

#### B. Secrets and provider identifiers

| Name | Purpose | Class | Code references | Local development | Render production | Vercel | Req. | Recommended action | Security impact |
|---|---|---|---|---|---|---|---|---|---|
| `YOUTUBE_API_KEY` | Server-side YouTube Data API v3 key. | **Secret** | `backend/src/config/env.ts` (`youtubeApiKey`), `backend/src/controllers/playlistController.ts`, `backend/src/services/youtube/youtubeService.ts` | Present in local `.env` | Secret in Render; `sync: false` in blueprint | **Never** | Required for live URL import | Preserve current valid key; rotate only if exposed or restricted incorrectly. Restrict key to YouTube Data API v3. | Leakage permits quota theft; missing key disables URL import but not JSON import. |
| `MONGODB_URI` | Atlas connection string including credentials. | **Secret** | `backend/src/config/env.ts` (`mongodbUri`, `mongodbConfigured`), `backend/src/db/mongo.ts` | Present in local `.env`; not printed | Preserve existing production Atlas URI in Render; `sync: false` | **Never** | Required | Preserve the production URI; do not copy local. Rotate only under a documented credential plan. | Leakage grants database access; wrong URI points at the wrong environment/data. |
| `MONGODB_DB_NAME` | Logical database name. | Sensitive metadata | `backend/src/config/env.ts` (`mongodbDbName`), `backend/src/db/mongo.ts` | Present; diagnostic reports name matches `learnquest` | `learnquest` | Not used | Required | Keep `learnquest`; do not change to a dev database in production. | A dev/prod mix-up can read/write the wrong data or hide real data. |
| `GOOGLE_CLIENT_ID` | OAuth client identifier. | Public ID | `backend/src/config/env.ts` (`googleClientId`), `backend/src/auth/google.ts` | Present | Set from Google Cloud Console (public identifier, backend config) | Not used | Required | Preserve the production client ID; ensure Google Cloud authorized redirect matches. | Wrong ID breaks OAuth; leaked ID alone is not a secret but must match the registered client. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret used in the server-side token exchange. | **Secret** | `backend/src/config/env.ts` (`googleClientSecret`), `backend/src/auth/google.ts` | Present | Preserve existing valid secret in Render; `sync: false` | **Never** | Required | Preserve; rotate only if exposed. | Leakage allows OAuth code/token exchange abuse for the client. |
| `GOOGLE_REDIRECT_URI` | Exact callback Google redirects to. | URL | `backend/src/config/env.ts` (`googleRedirectUri`), `backend/src/auth/google.ts`, Google Cloud Console | `http://localhost:3001/api/auth/google/callback` | `https://learn-quest-one.vercel.app/api/auth/google/callback` | Not used | Required | Set exactly; register the exact URI in Google Cloud Console. | Mismatch breaks sign-in; a localhost/foreign URI in production is rejected or unusable. |
| `BREVO_API_KEY` | Brevo transactional email API key. | **Secret** | `backend/src/config/env.ts` (`brevoApiKey`), `backend/src/email/brevo.ts` | Present | Preserve existing valid key in Render; `sync: false`; align Brevo IP authorization with Render egress | **Never** | Required | Preserve or rotate under a plan; never unrestricted-IP by default. | Leakage permits email sending from the account; IP mismatch currently blocks delivery. |
| `BREVO_SENDER_EMAIL` | Verified sender address. | Sensitive metadata | `backend/src/config/env.ts` (`brevoSenderEmail`), `backend/src/email/brevo.ts` | Present | Actual verified sender configured in Render; `sync: false` | Not used | Required | Keep the verified sender; confirm SPF/DKIM/DMARC and domain verification. | Unverified sender causes provider rejection or poor deliverability. |
| `BREVO_SENDER_NAME` | Visible sender name. | Setting | `backend/src/config/env.ts` (`brevoSenderName`), `backend/src/email/brevo.ts` | `LearnQuest` | `LearnQuest` | Not used | Optional | Keep `LearnQuest`. | Cosmetic; no secret impact. |
| `SESSION_SECRET` | HMAC key for session-token hashes. | **Secret** | `backend/src/config/env.ts` (`sessionSecret`), `backend/src/auth/crypto.ts` (`sessionTokenHash`), `backend/src/auth/sessions.ts` | Present | Preserve an existing valid value or let Render `generateValue` supply it; `generateValue: true` in blueprint | **Never** | Required | Preserve if valid; if absent/placeholder, generate with the command below and paste directly into Render. Rotation signs out all sessions. | Weak/missing value makes session-token hashes forgeable or prevents auth; disclosure permits session attacks. |
| `EMAIL_ACTION_HMAC_SECRET` | HMAC key for reset/email-change tokens. | **Secret** | `backend/src/config/env.ts` (`emailActionHmacSecret`), `backend/src/auth/actionTokens.ts` | **Absent**; legacy `OTP_HMAC_SECRET` fallback present | Prefer the dedicated secret; blueprint `generateValue: true` | **Never** | Required in production | Preserve if valid; otherwise generate a new independent value, verify reset/email-change, then remove the legacy fallback. Rotation invalidates outstanding links. | A shared/weak secret allows action-token forgery; using the same value as sessions violates key separation. |

#### C. Legacy, obsolete, and aliases

| Name | Purpose | Class | Code references | Local development | Render production | Vercel | Req. | Recommended action | Security impact |
|---|---|---|---|---|---|---|---|---|---|
| `OTP_HMAC_SECRET` | Legacy fallback for `EMAIL_ACTION_HMAC_SECRET`. | **Secret** | `backend/src/config/env.ts` (`emailActionHmacSecret`) | Present | Remove only after the dedicated secret is set and verified. | **Never** | Legacy | Migrate to `EMAIL_ACTION_HMAC_SECRET`; do not rely on the fallback for a new deployment. | Sharing one secret across token eras weakens key separation; removing it too early breaks pending links. |
| `OTP_TTL_MIN` | Legacy fallback for `EMAIL_ACTION_TTL_MIN`. | Setting | `backend/src/config/env.ts` (`intEnvAlias` in `emailActionTtlMin`) | Present | Remove after `EMAIL_ACTION_TTL_MIN` is set and verified. | Not used | Legacy | Migrate; production should use the new name. | A stale alias can silently define a different lifetime than the documented policy. |
| `OTP_RESEND_SEC` | Legacy fallback for `EMAIL_ACTION_RESEND_SEC`. | Setting | `backend/src/config/env.ts` (`intEnvAlias` in `emailActionResendSec`) | Present | Remove after the new name is verified. | Not used | Legacy | Migrate; production should use the new name. | A stale alias can cause unexpected cooldown behavior. |
| `OTP_RATE_LIMIT_PER_15MIN` | Legacy fallback for `EMAIL_ACTION_RATE_LIMIT_PER_15MIN`. | Setting | `backend/src/config/env.ts` (`intEnvAlias` in `emailActionRateLimitPer15Min`) | Present | Remove after the new name is set. | Not used | Legacy | Migrate; do not carry both indefinitely. | A stale value can silently override the intended limiter. |
| `OTP_MAX_ATTEMPTS` | No active code reference. | Obsolete | Only referenced by a deployment test assertion that the blueprint must not contain it; not read by `env.ts`. | Present locally | Should not be set | Not used | Obsolete | Remove after confirming no external tooling depends on it. | A false sense of protection: the application does not enforce this setting. |

#### D. Frontend build-time variable

| Name | Purpose | Class | Code references | Local development | Render production | Vercel | Req. | Recommended action | Security impact |
|---|---|---|---|---|---|---|---|---|---|
| `VITE_API_BASE_URL` | Prefix for API requests; empty means same-origin `/api`. | Public build setting | `frontend/src/services/api/http.ts` (`getApiBase`, `apiUrl`), `frontend/.env.example` | Empty / unset (Vite dev proxy `/api` → `localhost:3001`) | Not used; do not add to Render | Empty or unset; rebuild after any change | Required only if using same-site custom domains | Keep empty for the Vercel `/api` rewrite. Any `VITE_*` value is embedded in public JS. | A non-empty direct Render URL makes the session cookie cross-site and breaks auth; never put secrets in `VITE_*`. |

### 7.3 Environment conclusions

- The production blueprint already contains the correct public topology and most policy values.
- The local `.env` is a development/legacy-fallback configuration: it uses `OTP_*` names and does not contain the dedicated `EMAIL_ACTION_*` names. It must not be imported wholesale into Render.
- `OTP_MAX_ATTEMPTS` is obsolete in the current source. Keeping it locally is harmless but misleading; it should not be added to Render.
- The source has no undocumented implicit production defaults for the critical origins: production requires explicit `APP_ORIGIN`, `API_ORIGIN`, `MONGODB_URI`, Google, Brevo, session, and email-action secrets.
- `PORT`, `NODE_VERSION`, and platform-injected values are runtime settings, not application secrets.

---

## 8. Exactly what to configure in Render

This section is the practical production configuration. It describes the current source and intended topology; it does **not** claim the live dashboard already contains these values.

### 8.1 A. Copy-ready non-secret Render environment block

Only copy the lines below. They contain no secrets and no placeholder secret values. Do not add `PORT`; Render supplies it. Do not add `MONGODB_URI`, keys, passwords, client secrets, or sender credentials to this block.

```dotenv
NODE_ENV=production
NODE_VERSION=24.22.1
APP_ORIGIN=https://learn-quest-one.vercel.app
CORS_ORIGIN=https://learn-quest-one.vercel.app
API_ORIGIN=https://learnquest-hhiv.onrender.com
GOOGLE_REDIRECT_URI=https://learn-quest-one.vercel.app/api/auth/google/callback
MONGODB_DB_NAME=learnquest
BREVO_SENDER_NAME=LearnQuest
TRUST_PROXY_HOPS=2
CACHE_TTL_SEC=600
CACHE_MAX_ENTRIES=50
RATE_LIMIT_PER_MIN=30
AUTH_RATE_LIMIT_PER_MIN=20
EMAIL_ACTION_RATE_LIMIT_PER_15MIN=8
SESSION_IDLE_HOURS=168
SESSION_ABSOLUTE_DAYS=30
REAUTH_WINDOW_MIN=10
EMAIL_ACTION_TTL_MIN=30
EMAIL_ACTION_RESEND_SEC=60
ACCOUNT_MAX_STATE_BYTES=8388608
```

Notes:

- `APP_ORIGIN` and `CORS_ORIGIN` should be identical for this same-origin Vercel proxy. `APP_ORIGIN` is the authority for public links and redirects; `CORS_ORIGIN` is the browser allowlist merged with `APP_ORIGIN`.
- `API_ORIGIN` is the Render service origin. It is not the browser-facing origin in this topology; the browser calls the Vercel origin.
- `GOOGLE_REDIRECT_URI` is the public callback through Vercel, not the Render URL, because the browser must receive the session cookie on the Vercel origin.
- `TRUST_PROXY_HOPS=2` is correct only for Browser → Vercel edge → Render edge → Express. Verify after deployment; do not raise it to hide an IP problem.
- `LQ_USER_DATA_STORE` is intentionally **not** in the block. When absent, the code defaults to `legacy`. If the live service is already on `unified`, preserve that verified value; never force an existing unified deployment back to `legacy` or switch a legacy deployment to `unified` without a backed-up, owner-approved migration and `LQ_USER_DATA_CUTOVER_ACK`.
- `NODE_VERSION` is a Render runtime setting. A dashboard variable with the same key can override the blueprint; verify the build log and the effective environment page.
- Render supplies `NODE_ENV=production` automatically for a Node service, and this blueprint also sets it explicitly. Do not override it to `development` or `test`: the backend refuses to start when `RENDER=true` and `NODE_ENV` is not `production`.
- `PORT` is intentionally absent. Render injects it; a manual `3001` override can break routing.

### 8.2 B. Secret checklist

For each secret, decide deliberately. Never paste a value into this report, chat, Git, a screenshot, or a Vercel public variable.

| Secret | Preserve / generate / rotate | Side effects and verification |
|---|---|---|
| `MONGODB_URI` | **Preserve** the existing production Atlas URI. Rotate only under a documented credential-exposure or credential-rotation plan. | Existing connections may briefly reconnect; sessions are unaffected. Keep the database path pointing at `learnquest`. Do not replace with the local development URI. |
| `YOUTUBE_API_KEY` | **Preserve** if valid and properly restricted. **Rotate** if exposed or if Google reports key compromise. | No session impact; live playlist URL imports may fail briefly. Restrict the key to YouTube Data API v3. |
| `GOOGLE_CLIENT_ID` | **Preserve** the production client ID. It is a public identifier, but it must match the Google Cloud client and registered redirect URI. | Wrong ID breaks OAuth; no secret impact from the ID alone. |
| `GOOGLE_CLIENT_SECRET` | **Preserve** if valid. **Rotate** only if exposed or during a planned Google client rotation. | OAuth exchanges fail until Render and Google Cloud are updated. Existing sessions remain valid unless separately revoked. |
| `BREVO_API_KEY` | **Preserve** if valid. **Rotate** only if exposed, and update Brevo IP authorization for Render egress at the same time. | Email delivery may fail until provider and Render agree. No session impact. Do not choose unrestricted IP access as the default. |
| `BREVO_SENDER_EMAIL` | **Preserve** the currently verified sender. | Not a secret, but changing it requires domain/sender verification and SPF/DKIM/DMARC review. |
| `SESSION_SECRET` | **Preserve** a valid existing value. **Generate** a new independent 32+ byte value only if absent, weak, shared, or exposed. | Rotating it invalidates every existing session (and any session-token digest). Users must sign in again. Do not reuse the local value or another service’s key. |
| `EMAIL_ACTION_HMAC_SECRET` | **Preserve** a valid dedicated value. If only `OTP_HMAC_SECRET` exists, **generate a new independent value**, verify reset and email-change end to end, then remove the legacy fallback. | Rotating it invalidates outstanding reset/email-change links. It must differ from `SESSION_SECRET`. |
| `OTP_HMAC_SECRET` | **Legacy only.** Preserve temporarily if it is the only working fallback; remove after the dedicated secret is verified. | Removing it before the replacement works breaks email actions. If it was exposed, the new dedicated secret is the rotation; do not keep using the exposed value. |

Safe local generation command (the output must be captured privately and pasted directly into Render; it is never included in a report or shared log):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Generate independent values for `SESSION_SECRET` and `EMAIL_ACTION_HMAC_SECRET`. Do not reuse one value for sessions, action tokens, API keys, or OAuth.

### 8.3 C. Local versus production table

| Concern | Local development | Production Render | Vercel |
|---|---|---|---|
| App origin | `http://localhost:5173` | `https://learn-quest-one.vercel.app` | The same public app origin; no `VITE_API_BASE_URL` override |
| API origin | `http://localhost:3001` | `https://learnquest-hhiv.onrender.com` | Browser calls `/api` on the app origin; Vercel rewrites to Render |
| Node runtime | Local default currently `24.11.0`; QA used `24.22.1` | `NODE_VERSION=24.22.1` + `.node-version` | Project Node setting must be 24.x; verify in dashboard/build log |
| Database | Local development URI and `learnquest` database; diagnostic currently TLS-fails | Existing production Atlas URI and `learnquest`; never copy local | No database settings |
| Cookies | `lq_session` (non-`__Host-`), Secure off outside production | `__Host-lq_session`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain | No cookie settings; the browser stores the Render-issued cookie on the Vercel origin via the proxy |
| OAuth callback | `http://localhost:3001/api/auth/google/callback` | `https://learn-quest-one.vercel.app/api/auth/google/callback` | Register the exact production callback in Google Cloud Console |
| Email links | `http://localhost:5173/#/...` | `https://learn-quest-one.vercel.app/#/...` | Never configure a localhost link |
| Secrets | `.env` locally, ignored | Render secret fields only; `sync: false`/`generateValue` | **Never** put backend secrets in Vercel |
| Frontend API base | Empty; Vite proxy | Not used | `VITE_API_BASE_URL` empty/unset |
| Email TTL/cooldown | Legacy `OTP_*` fallbacks present | Dedicated `EMAIL_ACTION_TTL_MIN=30`, `EMAIL_ACTION_RESEND_SEC=60` | Not used |

### 8.4 D. Operational checklist

1. **Before changing Render:** confirm the current deploy is the old `0.2.0` build; this explains the missing endpoints. Do not diagnose it as a code bug in `0.3.0`.
2. **Set non-secrets:** add or confirm the lines in section 8.1. Use Render’s environment page, not a bulk `.env` import.
3. **Set secrets:** add `MONGODB_URI`, `YOUTUBE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `SESSION_SECRET`, and `EMAIL_ACTION_HMAC_SECRET` individually. Use `sync: false` values from the blueprint prompt or paste the provider value directly.
4. **Choose Save vs deploy:** environment changes that the Node process reads at startup require a restart/redeploy to take effect. Use **Save and Deploy** (or the equivalent restart/redeploy control) after secret or runtime-env changes. Use a rebuild when `NODE_VERSION`, build commands, dependencies, or blueprint settings changed. Do not use **Save** alone and assume the running process picked up a new secret.
5. **Deploy both sides:** Render must run the current backend `0.3.0`; Vercel must run the current frontend build and the current `vercel.json` rewrite. A backend-only deploy leaves the Vercel `/api` proxy stale and vice versa.
6. **Verify Render liveness:** `GET https://learnquest-hhiv.onrender.com/api/health` returns `ok:true`, expected `version` (currently `0.3.0`), and no secret values.
7. **Verify readiness:** `GET https://learnquest-hhiv.onrender.com/api/ready` returns 200 only after a successful MongoDB ping and index initialization. A 503 is an honest not-ready result; do not treat `/api/health` 200 as database readiness.
8. **Verify config:** `GET https://learnquest-hhiv.onrender.com/api/auth/config` returns configured booleans and a `missing` array. Expect no missing Google/Brevo/session/email-link/database entries for full auth. This endpoint never returns secret values.
9. **Verify proxy:** `GET https://learn-quest-one.vercel.app/api/health` must return the Render JSON, not Vercel `NOT_FOUND`. If it 404s, the Vercel rewrite was not deployed.
10. **Verify Google:** use a non-production test identity and the exact callback; confirm the browser returns to the app origin, not Render, and that sign-in creates a first-party cookie.
11. **Verify email:** after fixing Brevo IP authorization, request one reset for an owner-controlled test account. Treat Brevo HTTP acceptance as acceptance only, not inbox delivery. Confirm SPF/DKIM/DMARC separately.
12. **Verify headers and cookies:** after deploy, inspect the `Set-Cookie` on the real Vercel origin for `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, and expiry. Recheck Vercel’s `Referrer-Policy`/`X-Content-Type-Options` and the `/api` proxy behavior.
13. **Do not** bulk-import local `.env`, paste secrets into Markdown/GitHub/chat, add backend secrets to Vercel, or put a Render URL in `VITE_API_BASE_URL` for this topology.

### 8.5 E. Dashboard versus blueprint overrides

- `render.yaml` is the checked-in non-secret blueprint and declares secret entries with `sync: false`.
- `SESSION_SECRET` and `EMAIL_ACTION_HMAC_SECRET` use `generateValue: true`. Render generates values during blueprint sync; preserve them unless a deliberate rotation is planned.
- Render’s dashboard can override environment values that also exist in the blueprint. After any sync or manual change, open the service’s Environment page and confirm the effective set. Do not assume the YAML value won because it is checked in.
- A dashboard `NODE_VERSION` override can defeat the repository pin. Verify the effective Node version in the deploy/build log.
- A manual `PORT` override can break Render’s routing. Remove it and let Render provide `PORT`.
- The checked-in `.env.example` files are documentation only. They are not deployment inputs.

---

## 9. Vercel versus Render settings matrix

| Setting | Render (backend) | Vercel (frontend) | Notes |
|---|---|---|---|
| `NODE_ENV=production` | Yes (blueprint; Render also injects `production`) | Not applicable | Backend fail-closed behavior depends on it; invalid values and `RENDER=true` with a non-production mode refuse startup. |
| `NODE_VERSION=24.22.1` | Yes (blueprint; verify override) | Not a Render variable; use Vercel project Node 24.x | Both sides must build on a supported patched Node line. |
| `APP_ORIGIN` | Yes: Vercel origin | Not used | Email links/OAuth redirects use this origin. |
| `CORS_ORIGIN` | Yes: same Vercel origin | Not used | Exact credentialed allowlist; no wildcard. |
| `API_ORIGIN` | Yes: Render origin | Not used | Not the browser-facing API base in this topology. |
| `GOOGLE_REDIRECT_URI` | Yes: Vercel callback | Register the exact URI in Google Cloud Console | The callback must be on the origin that stores the cookie. |
| `MONGODB_URI` / `MONGODB_DB_NAME` | Yes / `learnquest` | **Never** | Browser must never see database credentials. |
| `YOUTUBE_API_KEY` | Yes | **Never** | Server-side only. |
| `GOOGLE_CLIENT_SECRET` | Yes | **Never** | Server-side token exchange only. |
| `BREVO_API_KEY` | Yes | **Never** | Server-side only. |
| `SESSION_SECRET` | Yes | **Never** | Server-side HMAC key. |
| `EMAIL_ACTION_HMAC_SECRET` | Yes | **Never** | Server-side HMAC key. |
| `VITE_API_BASE_URL` | Not used | Empty/unset | Empty means same-origin `/api`; Vercel rewrites to Render. |
| `/api` rewrite | Receives proxied requests | `frontend/vercel.json` rewrites `/api/:path*` to Render | Must be deployed with the current frontend. |
| Static headers | Helmet on API responses | `vercel.json` headers for the static app | Live deployment currently lacks the source-defined Referrer-Policy/nosniff; redeploy and recheck. |
| Build/root | Root `backend`, `npm ci && npm run build`, start `npm run start` | Root `frontend`, build `npm run build`, output `dist` | Confirm the Vercel project root is `frontend`; do not deploy the repo root as a static site. |

---

## 10. MongoDB configuration, connectivity, and readiness

### 10.1 Configuration shape

- Production must use the existing production Atlas URI, credentials, and database `learnquest`.
- Local development may use a dedicated development URI/database, but no separate development database/user is assumed to exist. The local diagnostic reported that its configured database name matches `learnquest`.
- The URI is never printed. The diagnostic reports only scheme, option names, credential presence, database-path presence, and safe booleans.
- The application does not fall back to local storage for production accounts. If MongoDB is not configured or not ready, account/auth routes fail closed with `SETUP_REQUIRED` or `DATABASE_UNAVAILABLE`.
- TLS verification is enabled in the driver and in the diagnostic. Do not disable TLS or rejectUnauthorized to “fix” connectivity.

### 10.2 Current diagnostic result

Run under Node 24.22.1:

- Configuration: present.
- Database name matches `learnquest`.
- SRV resolution: succeeded; TXT resolution: succeeded.
- MongoDB ping: **false**.
- Classification: **`TLS_FAILURE`**.
- Driver error: retryable; TLS alert `internal_error` / `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`.
- Elapsed: approximately 7.2 seconds.
- TLS probe attempts (SRV targets and cluster host SNI): all failed at handshake with the same alert.

This differs from Report 17’s earlier local `CONNECTED` result. The current result is reported honestly. The failure is external to the application source: likely Atlas network/access policy, local network interception, or a TLS front-end condition. No Atlas access list or credential was changed. Production readiness is separately unavailable because the Live Render build is old; `/api/ready` 404s.

### 10.3 Readiness behavior in source

- `/api/health` is liveness only: process is up, version, key presence, setup flags, and database snapshot fields in the newer build.
- `/api/ready` returns 503 until the supervisor has a successful ping and index initialization.
- With the production supervisor, `/api/auth`, `/api/account`, and `/api/playlists` fail closed when the database is unready, except `/api/auth/config` (public setup information).
- Errors are sanitized; raw driver hostnames, IPs, and connection-string fragments are not returned or logged.

### 10.4 Data-layer findings

- Account and learning records are keyed by `userId`; queries are scoped at the repository boundary.
- Unique indexes cover account email, Google subject, session token hash, action-token hash, OAuth state hash, migrations, state versions, and per-user data keys.
- The unified layout has unique `(userId, domain, key)` and per-domain/ordering indexes. Legacy remains the default until an explicit cutover.
- Optimistic versioning prevents blind overwrites; the race fixed in this run closes a path that could reset or duplicate the version baseline.
- Import/export validates envelopes and writes all collections through a best-effort rollback. There are no MongoDB transactions in this implementation; partial-failure restoration is best-effort and should be paired with backups.
- Account deletion verifies zero ownership counts before and after account removal; no live deletion was run.

---

## 11. QA execution and actual results

All commands below were run with the cached Node.js `24.22.1` binary directory prepended to `PATH`. The local default Node (`24.11.0`) was not used for the reported QA results.

### 11.1 Backend

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass with **0 errors, 84 warnings** (`@typescript-eslint/no-explicit-any` in existing code; no new error) |
| Build | `npm run build` | Pass (`tsc -p tsconfig.json`) |
| Tests | `npm test` | **22 files / 190 tests passed** |
| Dependency audit | `npm audit --audit-level=low --json` | **0 vulnerabilities** (339 dependencies, all severities 0) |

The backend test count increased from Report 17’s 185 to 190 because this run added five regression tests (one CORS, two `NODE_ENV`/Render, two state-version).

### 11.2 Frontend

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass with **0 errors, 4 warnings** (`react-hooks/exhaustive-deps` in existing components) |
| Build | `npm run build` | Pass; Vite produced `dist/index.html` and asset `index-BJYYPxXz.js` |
| Tests | `npm test` | **41 files / 349 tests passed** |
| Dependency audit | `npm audit --audit-level=low --json` | **0 vulnerabilities** (395 dependencies, all severities 0) |

The frontend test count increased from Report 17’s 348 to 349 because this run added the account-refresh regression test.

### 11.3 Test environment notes

- Backend tests use the in-memory adapter and supertest; they do not touch the production database.
- Frontend tests use jsdom; no Playwright/Cypress package or real-browser suite is present in the repository, so no real-browser test is claimed.
- No test result was treated as proof of live provider behavior, live cookie behavior, or production database readiness.
- No tests were skipped or weakened to obtain a pass. The fixes added constraints and assertions rather than relaxing security checks.

---

## 12. Live Render, Vercel, and provider checks

All checks were read-only. No login, user account, email send, database mutation, or provider setting change was performed.

### 12.1 Render

| Probe | Status | Observed |
|---|---:|---|
| `GET /api/health` | 200 | `{"ok":true,"hasKey":true,"version":"0.2.0",...}`. The old response shape lacks the newer database/readiness fields. |
| `GET /api/ready` | 404 | `{"error":"Not found."}` |
| `GET /api/auth/config` | 404 | `{"error":"Not found."}` |

The health response proves only that an old HTTP process is alive. It does **not** prove auth, MongoDB readiness, email, or the current source version.

### 12.2 Vercel

| Probe | Status | Observed |
|---|---:|---|
| `GET /` | 200 | Old asset `index-RgZDAXlN.js` and old CSS. |
| `GET /api/health` | 404 | Empty body; Vercel-level not found, not the Render JSON. |
| `GET /api/ready` | 404 | Empty body. |
| `GET /api/auth/config` | 404 | Empty body. |

The Vercel `/api` rewrite is not effective in the live deployment. The live static headers also did not match the checked-in `vercel.json`: `Referrer-Policy` and `X-Content-Type-Options` were absent, while `Access-Control-Allow-Origin: *` was present on the public static root. The source config defines the two security headers and the `/api` rewrite; this is stale-deployment evidence, not a source claim that the live headers are correct.

### 12.3 Build/source mismatch

- Current backend source version: `0.3.0` (`backend/src/config/env.ts`, `backend/package.json`).
- Live Render version: `0.2.0`.
- Current local frontend build asset: `index-BJYYPxXz.js`.
- Live Vercel asset: `index-RgZDAXlN.js`.
- Current backend package version: `0.3.0`; current frontend package version: `0.2.0`.

### 12.4 Brevo

- No new email was sent, because the provider had previously returned HTTP 401 due to source-IP authorization and the live backend lacks the current config endpoint.
- The Brevo path is server-side; the API key is never exposed to the browser.
- Provider acceptance is not delivery. SPF/DKIM/DMARC and sender/domain verification remain owner checks.
- The previous 401 is an external configuration issue, not a reason to weaken IP restrictions.

### 12.5 MongoDB

- Local diagnostic: `TLS_FAILURE`, `ping=false`, ~7.2 s, retryable.
- Production: `/api/ready` absent in the stale build; database readiness cannot be verified.
- No Atlas access-list change or credential change was made.
- The live Render process may still be able to reach Atlas, but this audit has no evidence for that claim; do not assume it.

### 12.6 Browser/cookie limitation

No real browser sign-in was attempted against a live account. The live auth endpoints are absent, and using unknown accounts is prohibited. Therefore:

- The source cookie attributes are verified by code/tests.
- A real production `Set-Cookie` through the Vercel proxy is **not** verified.
- The post-deploy acceptance test must include a controlled test account, a real browser, and inspection of the cookie, `/api/health`, `/api/ready`, `/api/auth/config`, and the `/api` proxy.

---

## 13. Secret exposure review (no values reproduced)

### 13.1 Repository hygiene

- `.gitignore` ignores `.env` and `.env.local` recursively and keeps `.env.example` trackable.
- `backend/.env` is present locally, untracked, and ignored.
- `frontend/.env.local` was not present.
- `git ls-files` showed only `backend/.env.example` and `frontend/.env.example`; no real `.env` is tracked.
- `git log --all --name-only -- '*/.env' '.env' '*env*production*'` returned no tracked environment file history.
- `.env.example` files contain blank secret fields and documentation only.
- `render.yaml` contains `sync: false` and `generateValue: true`, not secret values.

### 13.2 Targeted secret-pattern scan

No secret-scanning binary (gitleaks, trufflehog, secretlint, detect-secrets, etc.) was installed, so targeted Git-content checks were used instead. The checks looked for common provider patterns in tracked, non-lockfile files:

- Google API-key prefix matches: none in tracked files.
- Brevo API-key prefix matches: none in tracked files.
- MongoDB connection-string scheme matches: none in tracked non-lockfile source/config.
- Private-key blocks: none in tracked files.

These are pattern checks, not a complete entropy scan. Test fixtures contain intentionally fake credential-like strings in test code; they are not production secrets and are not reproduced here.

### 13.3 Exposure assessment

- No genuine production credential was found committed or tracked in the current repository at audit time.
- The local `.env` contains real/local development values by design; it must remain ignored and must not be copied into Render or Vercel.
- No history rewrite, purge, or credential rotation was performed.
- If any provider later confirms a key was exposed outside this repository, rotate that provider key only, update Render, and verify the affected flow. Do not rotate all secrets blindly.

---

## 14. Prioritized owner actions

### P0 — restore a working, consistent production deployment

1. Redeploy the current backend (`0.3.0`) to Render from commit `a24fa02` plus this run’s uncommitted fixes, after reviewing the diff. Confirm the build uses Node `24.22.1`.
2. Redeploy the current frontend to Vercel with the checked-in `vercel.json` so `/api/*` rewrites to Render and the security headers are applied.
3. Verify in this order:
   - Render `/api/health` returns `0.3.0`.
   - Render `/api/ready` returns 200 (or an honest 503 with a reason).
   - Render `/api/auth/config` returns `configured` booleans and an empty `missing` list for the intended full setup.
   - Vercel `/api/health` returns the same Render JSON, not 404.
   - Vercel root serves the new asset, not `index-RgZDAXlN.js`.
4. Inspect the real `Set-Cookie` after a controlled test sign-in; verify `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, and expiry.
5. Confirm the Google Cloud authorized redirect URI exactly matches `https://learn-quest-one.vercel.app/api/auth/google/callback`.

### P1 — restore email and database verification

6. Fix Brevo API-key source-IP authorization for Render’s egress, or use the provider’s supported authorized-IP mechanism. Do not make the key unrestricted by default.
7. Verify sender/domain authentication (SPF/DKIM/DMARC) and send one controlled reset/email-change test only after authorization is fixed.
8. Resolve the local MongoDB TLS failure for development, or use a separately approved development database/network. Do not disable TLS.
9. Verify production `/api/ready` and one read-only authenticated data load with a controlled test account after Render is redeployed. Do not use unknown accounts.

### P2 — configuration cleanup and hardening

10. Ensure Render uses the dedicated `EMAIL_ACTION_HMAC_SECRET`, `EMAIL_ACTION_TTL_MIN`, `EMAIL_ACTION_RESEND_SEC`, and `EMAIL_ACTION_RATE_LIMIT_PER_15MIN`; then remove `OTP_HMAC_SECRET`, `OTP_TTL_MIN`, `OTP_RESEND_SEC`, `OTP_RATE_LIMIT_PER_15MIN`, and the unused `OTP_MAX_ATTEMPTS` after verification.
11. Keep `SESSION_SECRET` and `EMAIL_ACTION_HMAC_SECRET` independent. Preserve valid values unless a deliberate rotation is required.
12. Confirm no `PORT=3001` dashboard override exists.
13. Keep `VITE_API_BASE_URL` empty/unset in Vercel; never add backend secrets to Vercel.
14. Preserve the verified `LQ_USER_DATA_STORE` mode. If it is absent, the code default is `legacy`; do not switch an existing deployment between legacy and unified without a backed-up, verified migration and the cutover acknowledgement.
15. Recheck the Vercel static headers after redeploy; consider a tested CSP as a separate change, not an unreviewed hotfix.
16. Consider OAuth browser binding and a shared rate-limit store if the deployment is scaled or the threat model requires them.

### P3 — acceptance evidence

17. Record the exact Render and Vercel deployment IDs/commit SHAs, build timestamps, effective Node version, and the results of the acceptance probes.
18. Re-run backend and frontend tests, typecheck, lint, build, and `npm audit` on the deployed source revision.
19. Confirm no `.env` file, secret, or debug output is present in build artifacts or public source maps.

---

## 15. Final Git status

At the end of this audit, before writing this report and updating the index:

```text
 M backend/src/config/env.ts
 M backend/src/services/userData.ts
 M backend/tests/account-data-contract.test.ts
 M backend/tests/origin-config.test.ts
 M frontend/src/features/account/Account.tsx
 M frontend/tests/account-ui.test.tsx
?? LEARNQUEST_COMPLETE_PROJECT_SECURITY_ENV_AUDIT_PROMPT_2026-10-28.txt
```

After creating this report and appending the archive row, the expected additional changes are exactly:

```text
?? docs/user-doc/audit2/18_LEARNQUEST_COMPLETE_PROJECT_SECURITY_ENV_AUDIT_2026-10-28.md
 M docs/user-doc/audit2/README.md
```

No other audit Markdown report or duplicate environment report was created. The final `git status --short --branch` is recorded in the delivery response after the index update.

**No commit, push, reset, clean, stash, branch switch, destructive operation, or production deployment was performed.** No `.env`, secret, database record, or live deployment setting was altered. The working tree changes above are the source fixes and regression tests from this audit, plus the report and index documentation.

---

## 16. Explicit no-deploy / no-commit statement

- No production deployment was performed.
- No Render or Vercel setting was changed.
- No Atlas access list, database credential, or database record was changed.
- No secret was rotated, printed, or copied into this report.
- No email was sent during this audit.
- No real account deletion or migration was run.
- No commit, push, reset, clean, stash, or branch switch was performed.
- The report is documentation only; it does not modify application behavior by itself.

---

## 17. Limitations and audit conclusion

### 17.1 Limitations

- The live services are stale and incomplete; live auth, cookies, readiness, and config could not be exercised end to end.
- The local MongoDB diagnostic is `TLS_FAILURE`; production database readiness is unverified.
- Brevo delivery remains externally blocked by the prior HTTP 401 source-IP authorization; no new provider request was made.
- No real-browser test suite is installed, so browser-level claims are limited to source review, jsdom tests, and post-deploy acceptance instructions.
- No secret scanner was installed; targeted pattern and Git-history checks were used instead.
- `#max` reasoning cannot be confirmed by the available CLI/model metadata.
- The audit is based on the source at the recorded working tree and the live responses at the timestamps above; provider and deployment states can change.

### 17.2 Conclusion

The **source-level** security posture is materially stronger than the live deployment. The authentication/session/CSRF/ownership/action-token design is defensible and now has regression coverage for the session-status, 401 classification, CORS-production, `NODE_ENV`/Render-mode, state-version, and account-refresh defects found in this run. The dominant risk is operational: production is still serving an old build whose frontend and backend cannot complete authentication, and whose `/api` proxy is not deployed. That must be fixed by the owner with a controlled redeploy before any claim of production readiness is valid. The second dominant risk is external email/database configuration, not application code. Do not copy the local `.env` to Render, do not weaken TLS or IP restrictions to force a pass, and verify the real proxy/cookie/readiness behavior after deployment.
